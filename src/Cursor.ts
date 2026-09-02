/* ==========================================================================
   Aether — custom cursor
   --------------------------------------------------------------------------
   A minimal two-part pointer: a hard 5px dot that tracks 1:1, and a soft ring
   that lags a few frames behind it. The ring is the only thing that
   interpolates, so the cursor still feels "attached" to the hand — the trail
   reads as material inertia rather than input lag.

   Everything here is deliberately defensive:

   * `anura` may not exist yet when this script evaluates (it is a plain
     <script>, not a module), so nothing touches `anura.*` at eval time.
   * The custom cursor is switched off entirely on coarse pointers. A dot that
     teleports around under a finger is worse than no cursor at all.
   * Apps render inside iframes. The cursor element lives in the top document
     and stops receiving pointermove the instant the pointer crosses into a
     frame, which would leave a dot frozen on the border. We detect that and
     hand control back to the native cursor (which the iframe's own document
     draws for us) until the pointer comes back out.

   Styling lives in Cursor.css; this file only owns geometry and state.
   ========================================================================== */

type AetherCursorState =
	| "default"
	| "interactive"
	| "text"
	| "resize"
	| "grabbing"
	| "disabled";

class AetherCursor {
	/** anura.settings key that gates the whole feature. Defaults to true. */
	static readonly SETTING_KEY = "custom-cursor";

	/** Single live instance; `init()` is idempotent. */
	static instance: AetherCursor | null = null;

	/**
	 * Create (or return) the cursor. Safe to call before `anura` exists — the
	 * setting is re-read lazily on every `refresh()`.
	 */
	static init(): AetherCursor {
		if (!AetherCursor.instance) {
			AetherCursor.instance = new AetherCursor();
		}
		AetherCursor.instance.refresh();
		return AetherCursor.instance;
	}

	/**
	 * Flip the feature on/off and persist it to anura.settings. Used by the
	 * Settings app / Control Center toggle.
	 */
	static async setEnabled(on: boolean) {
		try {
			if (typeof anura !== "undefined" && anura?.settings) {
				await anura.settings.set(AetherCursor.SETTING_KEY, on);
			}
		} catch (e) {
			console.warn("AetherCursor: could not persist setting", e);
		}
		AetherCursor.init();
	}

	// ---- elements ---------------------------------------------------------
	root: HTMLDivElement;
	private dot: HTMLSpanElement;
	private ring: HTMLSpanElement;

	// ---- geometry ---------------------------------------------------------
	private px = -100; // raw pointer
	private py = -100;
	private dx = -100; // dot (near-instant)
	private dy = -100;
	private rx = -100; // ring (trailing)
	private ry = -100;

	// ---- runtime ----------------------------------------------------------
	private raf = 0;
	private watchdog = 0;
	private running = false;
	private mounted = false;
	private active = false;
	private lastMoveAt = 0;
	private lastTarget: Element | null = null;
	private state: AetherCursorState = "default";
	private pressed = false;
	private grabbing = false;
	/** Suppressed because the pointer is over an iframe / off-window. */
	private suppressed = true;
	private reducedMotion = false;

	private coarseQuery: MediaQueryList | null = null;
	private motionQuery: MediaQueryList | null = null;

	private constructor() {
		this.root = document.createElement("div");
		this.root.id = "aether-cursor";
		this.root.setAttribute("aria-hidden", "true");
		this.root.dataset.state = "default";

		this.ring = document.createElement("span");
		this.ring.className = "aether-cursor-ring";

		this.dot = document.createElement("span");
		this.dot.className = "aether-cursor-dot";

		this.root.append(this.ring, this.dot);

		try {
			this.coarseQuery = window.matchMedia("(pointer: coarse)");
			this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
			this.reducedMotion = this.motionQuery.matches;
			this.motionQuery.addEventListener("change", (e) => {
				this.reducedMotion = e.matches;
			});
			this.coarseQuery.addEventListener("change", () => this.refresh());
		} catch {
			/* matchMedia is ancient enough that this should never fire */
		}

		this.bind();
	}

	// =======================================================================
	// enable / disable
	// =======================================================================

	/** True when the setting allows it AND the device has a fine pointer. */
	get shouldRun(): boolean {
		if (this.coarseQuery?.matches) return false;
		let want: unknown = true;
		try {
			if (typeof anura !== "undefined" && anura?.settings?.has) {
				if (anura.settings.has(AetherCursor.SETTING_KEY)) {
					want = anura.settings.get(AetherCursor.SETTING_KEY);
				}
			}
		} catch {
			want = true;
		}
		return want !== false;
	}

	/** Re-read settings / media queries and mount or unmount accordingly. */
	refresh() {
		if (this.shouldRun) this.enable();
		else this.disable();
	}

	enable() {
		if (this.active) return;
		this.active = true;
		if (!this.mounted) {
			(document.body || document.documentElement).appendChild(this.root);
			this.mounted = true;
		}
		this.root.classList.remove("aether-cursor-off");
		// Stays suppressed until the pointer actually moves in the top document,
		// so we never paint a dot at 0,0 on load.
		this.suppress(true);
		this.startWatchdog();
	}

	disable() {
		if (!this.active) return;
		this.active = false;
		this.stopLoop();
		this.stopWatchdog();
		this.root.classList.add("aether-cursor-off");
		document.body?.classList.remove("aether-cursor-active");
	}

	/** Tear down completely (listeners stay — the class is a singleton). */
	destroy() {
		this.disable();
		if (this.mounted) {
			this.root.remove();
			this.mounted = false;
		}
		AetherCursor.instance = null;
	}

	// =======================================================================
	// events
	// =======================================================================

	private bind() {
		const opts = { passive: true, capture: true } as const;

		document.addEventListener(
			"pointermove",
			(e: PointerEvent) => this.onMove(e),
			opts,
		);
		document.addEventListener(
			"pointerdown",
			(e: PointerEvent) => {
				if (!this.active) return;
				// A touch/pen contact means this is not a mouse session.
				if (e.pointerType !== "mouse") {
					this.suppress(true);
					return;
				}
				this.pressed = true;
				this.grabbing = !!(e.target as Element | null)?.closest?.(
					".title, .titleContent, [data-aether-grab]",
				);
				this.onMove(e);
				this.applyState();
			},
			opts,
		);
		const release = () => {
			if (!this.active) return;
			this.pressed = false;
			this.grabbing = false;
			this.applyState();
		};
		document.addEventListener("pointerup", release, opts);
		document.addEventListener("pointercancel", release, opts);

		// Pointer left the top-level document entirely (browser chrome, another
		// monitor, an iframe in some engines).
		document.addEventListener(
			"pointerout",
			(e: PointerEvent) => {
				if (!e.relatedTarget) this.suppress(true);
			},
			opts,
		);
		document.addEventListener(
			"mouseleave",
			(e: MouseEvent) => {
				if (e.target === document || e.target === document.documentElement) {
					this.suppress(true);
				}
			},
			opts,
		);

		// Focus moving into a frame is the most reliable iframe-entry signal.
		window.addEventListener("blur", () => {
			const el = document.activeElement;
			if (!el || AetherCursor.isFrame(el)) this.suppress(true);
		});
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) this.suppress(true);
		});
		// Any touch at all: this is a touch session, stand down.
		window.addEventListener("touchstart", () => this.suppress(true), {
			passive: true,
		});
	}

	private onMove(e: PointerEvent) {
		if (!this.active) return;
		if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") {
			this.suppress(true);
			return;
		}
		this.px = e.clientX;
		this.py = e.clientY;
		this.lastMoveAt = performance.now();

		if (this.suppressed) {
			// First move back into our document — teleport, don't fly in.
			this.dx = this.rx = this.px;
			this.dy = this.ry = this.py;
			this.suppress(false);
		}

		const target = (e.target as Element | null) ?? null;
		if (target !== this.lastTarget) {
			this.lastTarget = target;
			this.state = this.resolveState(target);
			this.applyState();
		}
		this.startLoop();
	}

	// =======================================================================
	// state resolution
	// =======================================================================

	private static isFrame(el: Element | null): boolean {
		if (!el) return false;
		const t = el.tagName;
		return t === "IFRAME" || t === "FRAME" || t === "OBJECT" || t === "EMBED";
	}

	private static readonly TEXT_SEL =
		'input:not([type]), input[type="text"], input[type="search"], input[type="url"],' +
		'input[type="email"], input[type="password"], input[type="number"],' +
		'input[type="tel"], input[type="date"], input[type="time"], textarea,' +
		'[contenteditable=""], [contenteditable="true"]';

	private static readonly INTERACTIVE_SEL =
		"a[href], button, summary, select, label, [role=button], [role=tab]," +
		"[role=menuitem], [role=switch], [role=link], [role=option]," +
		'input[type="checkbox"], input[type="radio"], input[type="range"],' +
		'input[type="button"], input[type="submit"], input[type="color"],' +
		".dock-item, .menubar-item, .windowButton, .launcher-item," +
		".aether-switch, .aether-check, .aether-slider, [data-aether-interactive]";

	private resolveState(target: Element | null): AetherCursorState {
		if (!target || !target.closest) return "default";

		if (
			target.closest(
				"[disabled], [aria-disabled='true'], .disabled, fieldset[disabled]",
			)
		) {
			return "disabled";
		}

		const resizer = target.closest(".resize-edge, .resize-corner");
		if (resizer) {
			this.root.dataset.dir = AetherCursor.resizeDir(resizer);
			return "resize";
		}
		delete this.root.dataset.dir;

		if (target.closest(AetherCursor.TEXT_SEL)) return "text";
		if (target.closest(AetherCursor.INTERACTIVE_SEL)) return "interactive";

		// Last resort: trust whatever cursor the author asked for. Only runs on
		// a target change, never per frame.
		try {
			const c = getComputedStyle(target).cursor;
			if (c === "pointer") return "interactive";
			if (c === "text" || c === "vertical-text") return "text";
			if (c.endsWith("-resize") || c === "col-resize" || c === "row-resize") {
				this.root.dataset.dir =
					c.startsWith("ew") || c === "col-resize"
						? "ew"
						: c.startsWith("ns") || c === "row-resize"
							? "ns"
							: c.startsWith("nwse")
								? "nwse"
								: "nesw";
				return "resize";
			}
			if (c === "grab" || c === "grabbing" || c === "move") return "grabbing";
			if (c === "not-allowed" || c === "no-drop") return "disabled";
		} catch {
			/* detached node */
		}
		return "default";
	}

	private static resizeDir(el: Element): string {
		const c = el.classList;
		if (c.contains("top-left") || c.contains("bottom-right")) return "nwse";
		if (c.contains("top-right") || c.contains("bottom-left")) return "nesw";
		if (c.contains("left") || c.contains("right")) return "ew";
		return "ns";
	}

	private applyState() {
		const s: AetherCursorState = this.grabbing ? "grabbing" : this.state;
		if (this.root.dataset.state !== s) this.root.dataset.state = s;
		this.root.classList.toggle("is-pressed", this.pressed);
	}

	// =======================================================================
	// suppression (iframes / off-window)
	// =======================================================================

	/**
	 * When suppressed we hide our element *and* drop `cursor: none` from the
	 * body, so there is never a moment where neither cursor is visible.
	 */
	private suppress(on: boolean) {
		if (this.suppressed === on) return;
		this.suppressed = on;
		this.root.classList.toggle("aether-cursor-hidden", on);
		document.body?.classList.toggle("aether-cursor-active", !on && this.active);
		if (on) this.stopLoop();
	}

	/**
	 * Cheap 160ms poll. pointermove stops arriving the moment the pointer is
	 * over an iframe, so a stale timestamp plus an iframe under the last known
	 * position is our signal to get out of the way.
	 */
	private startWatchdog() {
		if (this.watchdog) return;
		this.watchdog = window.setInterval(() => {
			if (!this.active || document.hidden) return;
			const stale = performance.now() - this.lastMoveAt > 140;
			if (!stale) return;
			let over: Element | null = null;
			try {
				over = document.elementFromPoint(this.px, this.py);
			} catch {
				over = null;
			}
			if (AetherCursor.isFrame(over) || over === null) this.suppress(true);
		}, 160);
	}

	private stopWatchdog() {
		if (this.watchdog) {
			clearInterval(this.watchdog);
			this.watchdog = 0;
		}
	}

	// =======================================================================
	// animation
	// =======================================================================

	private startLoop() {
		if (this.running || !this.active || this.suppressed) return;
		this.running = true;
		this.raf = requestAnimationFrame(() => this.tick());
	}

	private stopLoop() {
		this.running = false;
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private tick() {
		if (!this.running || !this.active) return this.stopLoop();

		if (this.reducedMotion) {
			this.dx = this.rx = this.px;
			this.dy = this.ry = this.py;
		} else {
			// Dot is essentially locked to the pointer; only the ring trails.
			this.dx += (this.px - this.dx) * 0.62;
			this.dy += (this.py - this.dy) * 0.62;
			this.rx += (this.px - this.rx) * 0.19;
			this.ry += (this.py - this.ry) * 0.19;
		}

		this.dot.style.transform = `translate3d(${this.dx}px, ${this.dy}px, 0) translate(-50%, -50%)`;
		this.ring.style.transform = `translate3d(${this.rx}px, ${this.ry}px, 0) translate(-50%, -50%)`;

		const settled =
			Math.abs(this.px - this.rx) < 0.12 && Math.abs(this.py - this.ry) < 0.12;
		if (settled) {
			// Snap to exact and park the loop — no idle rAF burn.
			this.dx = this.rx = this.px;
			this.dy = this.ry = this.py;
			this.dot.style.transform = `translate3d(${this.px}px, ${this.py}px, 0) translate(-50%, -50%)`;
			this.ring.style.transform = `translate3d(${this.px}px, ${this.py}px, 0) translate(-50%, -50%)`;
			this.stopLoop();
			return;
		}
		this.raf = requestAnimationFrame(() => this.tick());
	}
}

/* Same lexical-vs-global caveat as Widgets.tsx — expose the property form. */
(globalThis as any).AetherCursor = AetherCursor;
