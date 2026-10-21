/* ==========================================================================
   Dimension — the pointer
   --------------------------------------------------------------------------
   A real arrow, drawn by the shell, that turns into the thing you're about
   to click. Near a button it leaps onto it and morphs into a highlight
   wrapped around it (the iPad pointer idea), slides from one button to the
   next while you move along a row of them, and pours back into an arrow when
   you leave.

     arrow       locked to the pointer. Chrome's predicted pointer events are
                 used to win back most of the frame a drawn cursor runs behind
                 the hardware one.
     highlight   a rounded shape on a real spring (position, size and radius
                 each integrate with velocity), so a jump between targets is
                 one continuous motion and can be redirected mid-flight.
     I-beam,     drawn over text fields and window edges, with the arrow
     resize      hidden.

   Only small targets snap (a button, an icon, a tray item): a big card or a
   wide list row keeps the arrow, since you need to see where in it you are.
   An element can opt out with `data-cursor="arrow"` or in with
   `data-cursor="snap"`.

   Apps inside iframes draw their own native cursor; the moment the pointer
   crosses into a frame this one hides and hands over, and comes back when
   it leaves.
   ========================================================================== */

type AetherCursorState =
	| "default"
	| "text"
	| "resize"
	| "grabbing"
	| "disabled";

interface DimSpringChannel {
	v: number;
	u: number;
}

class AetherCursor {
	/** anura.settings key that gates the whole feature. Defaults to true. */
	static readonly SETTING_KEY = "custom-cursor";

	static instance: AetherCursor | null = null;

	static init(): AetherCursor {
		if (!AetherCursor.instance) AetherCursor.instance = new AetherCursor();
		AetherCursor.instance.refresh();
		return AetherCursor.instance;
	}

	static async setEnabled(on: boolean) {
		try {
			if (typeof anura !== "undefined" && anura?.settings)
				await anura.settings.set(AetherCursor.SETTING_KEY, on);
		} catch (e) {
			console.warn("AetherCursor: could not persist setting", e);
		}
		AetherCursor.init();
	}

	/** How far outside a target the pointer gets pulled onto it, in px. */
	static readonly REACH = 10;
	/** Highlight padding around a target. */
	static readonly PAD = 4;
	/** Bigger than this, and a target keeps the arrow instead. */
	static readonly MAX_W = 220;
	static readonly MAX_H = 140;

	static readonly SNAP_SEL =
		"button, a[href], summary, select, [role=button], [role=tab]," +
		"[role=menuitem], [role=switch], [role=link], [role=option]," +
		'input[type="checkbox"], input[type="radio"], input[type="button"],' +
		'input[type="submit"], input[type="color"], label.aether-switch,' +
		".dock-item, .tray-item, .windowButton, #launcher .app, .widget-chip," +
		".aether-switch, .aether-check, [data-aether-interactive]," +
		'[data-cursor="snap"]';

	static readonly TEXT_SEL =
		'input:not([type]), input[type="text"], input[type="search"], input[type="url"],' +
		'input[type="email"], input[type="password"], input[type="number"],' +
		'input[type="tel"], input[type="date"], input[type="time"], textarea,' +
		'[contenteditable=""], [contenteditable="true"]';

	root: HTMLDivElement;
	private arrow: HTMLDivElement;
	private hl: HTMLDivElement;
	private beam: HTMLDivElement;
	private resize: HTMLDivElement;

	private px = -100;
	private py = -100;
	private shownX = -100;
	private shownY = -100;
	private state: AetherCursorState = "default";
	private lastTarget: Element | null = null;
	private snapEl: HTMLElement | null = null;
	private pressed = false;
	private grabbing = false;

	/** The highlight's springs: centre, size, corner radius. */
	private sx: DimSpringChannel = { v: -100, u: 0 };
	private sy: DimSpringChannel = { v: -100, u: 0 };
	private sw: DimSpringChannel = { v: 10, u: 0 };
	private sh: DimSpringChannel = { v: 10, u: 0 };
	private sr: DimSpringChannel = { v: 5, u: 0 };
	private raf = 0;
	private lastT = 0;

	private active = false;
	private mounted = false;
	private suppressed = true;
	private reduced = false;
	private lastMoveAt = 0;
	private watchdog = 0;
	private watchdogChecked = false;
	private hitPending = false;
	private coarseQuery: MediaQueryList | null = null;

	private constructor() {
		const div = (cls: string, html = "") => {
			const d = document.createElement("div");
			d.className = cls;
			d.innerHTML = html;
			return d;
		};
		this.root = document.createElement("div");
		this.root.id = "aether-cursor";
		this.root.setAttribute("aria-hidden", "true");
		this.root.dataset.state = "default";
		this.hl = div("dc-hl");
		this.arrow = div(
			"dc-arrow",
			'<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3.2 2.4v16.9l4.3-4 2.9 6.5 2.9-1.3-2.8-6.3h5.9z" fill="#fff" stroke="#111" stroke-width="1.35" stroke-linejoin="round"/></svg>',
		);
		this.beam = div("dc-beam");
		this.resize = div(
			"dc-resize",
			'<svg width="26" height="26" viewBox="0 0 26 26"><path d="M2.5 13 7 8.5V11.4h12V8.5l4.5 4.5L19 17.5v-2.9H7v2.9z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>',
		);
		this.root.append(this.hl, this.beam, this.resize, this.arrow);

		try {
			this.coarseQuery = matchMedia("(pointer: coarse)");
			const motion = matchMedia("(prefers-reduced-motion: reduce)");
			this.reduced = motion.matches;
			motion.addEventListener("change", (e) => (this.reduced = e.matches));
			this.coarseQuery.addEventListener("change", () => this.refresh());
		} catch {
			/* ancient engine */
		}
		this.bind();
	}

	/* ---- on / off -------------------------------------------------------- */

	get shouldRun(): boolean {
		if (this.coarseQuery?.matches) return false;
		try {
			if (anura?.settings?.has?.(AetherCursor.SETTING_KEY))
				return anura.settings.get(AetherCursor.SETTING_KEY) !== false;
		} catch {
			/* anura not up yet */
		}
		return true;
	}

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
		this.suppress(true);
		this.startWatchdog();
	}

	disable() {
		if (!this.active) return;
		this.active = false;
		this.unsnap(true);
		this.stopLoop();
		clearInterval(this.watchdog);
		this.watchdog = 0;
		this.root.classList.add("aether-cursor-off");
		document.body?.classList.remove("aether-cursor-active");
	}

	/* ---- input ------------------------------------------------------------ */

	private bind() {
		const opts = { passive: true, capture: true } as const;
		document.addEventListener("pointermove", (e) => this.onMove(e), opts);
		document.addEventListener(
			"pointerdown",
			(e) => {
				if (!this.active) return;
				if (e.pointerType !== "mouse") return this.suppress(true);
				this.pressed = true;
				this.grabbing = !!(e.target as Element | null)?.closest?.(
					".title, .titleContent, [data-aether-grab]",
				);
				this.onMove(e);
				this.paintState();
			},
			opts,
		);
		const release = () => {
			if (!this.active) return;
			this.pressed = false;
			this.grabbing = false;
			this.paintState();
		};
		document.addEventListener("pointerup", release, opts);
		document.addEventListener("pointercancel", release, opts);
		document.addEventListener(
			"pointerout",
			(e) => {
				if (!e.relatedTarget) this.suppress(true);
			},
			opts,
		);
		window.addEventListener("blur", () => {
			const el = document.activeElement;
			if (!el || AetherCursor.isFrame(el)) this.suppress(true);
		});
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) this.suppress(true);
		});
		window.addEventListener("touchstart", () => this.suppress(true), {
			passive: true,
		});
		// Things move under a still pointer: the target may be gone.
		window.addEventListener("scroll", () => this.queueHitTest(), opts);
		window.addEventListener("wheel", () => this.queueHitTest(), opts);
	}

	private onMove(e: PointerEvent) {
		if (!this.active) return;
		if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen")
			return this.suppress(true);
		this.px = e.clientX;
		this.py = e.clientY;
		this.lastMoveAt = performance.now();
		this.watchdogChecked = false;

		// Draw where the pointer is about to be, not where it was: Chrome
		// predicts the next few milliseconds of motion. Capped, so a bad
		// guess can't throw the arrow somewhere it isn't.
		let x = this.px;
		let y = this.py;
		const predicted = (e as any).getPredictedEvents?.() as
			| PointerEvent[]
			| undefined;
		const p = predicted?.[0];
		if (p && !this.reduced) {
			const dx = p.clientX - x;
			const dy = p.clientY - y;
			if (Math.hypot(dx, dy) < 24) {
				x += dx * 0.75;
				y += dy * 0.75;
			}
		}
		if (this.suppressed) this.suppress(false);
		this.place(x, y);

		const target = (e.target as Element | null) ?? null;
		if (target !== this.lastTarget) {
			this.lastTarget = target;
			this.state = this.resolveState(target);
			this.paintState();
		}
		this.queueHitTest();
		if (this.snapEl) this.startLoop();
	}

	private place(x: number, y: number) {
		this.shownX = x;
		this.shownY = y;
		const t = `translate3d(${x}px, ${y}px, 0)`;
		this.arrow.style.transform = t;
		this.beam.style.transform = t;
		this.resize.style.transform = t;
	}

	/* ---- what's under it -------------------------------------------------- */

	private static isFrame(el: Element | null): boolean {
		const t = el?.tagName;
		return t === "IFRAME" || t === "FRAME" || t === "OBJECT" || t === "EMBED";
	}

	private resolveState(target: Element | null): AetherCursorState {
		if (!target?.closest) return "default";
		if (
			target.closest("[disabled], [aria-disabled='true'], fieldset[disabled]")
		)
			return "disabled";
		const edge = target.closest(".resize-edge, .resize-corner");
		if (edge) {
			this.root.dataset.dir = AetherCursor.resizeDir(edge);
			return "resize";
		}
		delete this.root.dataset.dir;
		if (target.closest(AetherCursor.TEXT_SEL)) return "text";
		try {
			const c = getComputedStyle(target).cursor;
			if (c === "text" || c === "vertical-text") return "text";
			if (c.endsWith("-resize") || c === "col-resize" || c === "row-resize") {
				this.root.dataset.dir =
					c.startsWith("ew") ||
					c === "col-resize" ||
					c === "e-resize" ||
					c === "w-resize"
						? "ew"
						: c.startsWith("ns") ||
							  c === "row-resize" ||
							  c === "n-resize" ||
							  c === "s-resize"
							? "ns"
							: c.startsWith("nwse") || c === "nw-resize" || c === "se-resize"
								? "nwse"
								: "nesw";
				return "resize";
			}
			if (c === "grabbing" || c === "move") return "grabbing";
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

	/** One hit test per frame at most, however fast the events come. */
	private queueHitTest() {
		if (this.hitPending || !this.active || this.suppressed) return;
		this.hitPending = true;
		requestAnimationFrame(() => {
			this.hitPending = false;
			this.findSnap();
		});
	}

	private static snappable(el: Element | null): HTMLElement | null {
		const t = el?.closest?.(AetherCursor.SNAP_SEL) as HTMLElement | null;
		if (!t || t.closest('[data-cursor="arrow"], #aether-cursor')) return null;
		if (t.matches("[disabled], [aria-disabled='true']")) return null;
		if (!t.matches('[data-cursor="snap"]')) {
			const r = t.getBoundingClientRect();
			if (r.width > AetherCursor.MAX_W || r.height > AetherCursor.MAX_H)
				return null;
			if (r.width < 6 || r.height < 6) return null;
		}
		return t;
	}

	/**
	 * Is there something to snap to? Directly under the pointer first; then a
	 * few points around it, so the pull starts a little before you arrive.
	 * Once snapped, it holds on until you're clearly past the edge, so it
	 * doesn't flicker along the boundary.
	 */
	private findSnap() {
		if (this.state === "text" || this.state === "resize" || this.grabbing) {
			this.unsnap();
			return;
		}
		const at = (x: number, y: number) => {
			try {
				return document.elementFromPoint(x, y);
			} catch {
				return null;
			}
		};
		const under = at(this.px, this.py);
		if (AetherCursor.isFrame(under)) return this.unsnap();
		let best = AetherCursor.snappable(under);

		if (!best) {
			const R = AetherCursor.REACH;
			let bestD = Infinity;
			const around: Array<[number, number]> = [
				[R, 0],
				[-R, 0],
				[0, R],
				[0, -R],
			];
			for (const [ox, oy] of around) {
				const t = AetherCursor.snappable(at(this.px + ox, this.py + oy));
				if (!t) continue;
				const r = t.getBoundingClientRect();
				const d = Math.hypot(
					Math.max(r.left - this.px, 0, this.px - r.right),
					Math.max(r.top - this.py, 0, this.py - r.bottom),
				);
				if (d < bestD) {
					bestD = d;
					best = t;
				}
			}
		}

		if (!best && this.snapEl?.isConnected) {
			const r = this.snapEl.getBoundingClientRect();
			const H = AetherCursor.REACH + 6;
			if (
				this.px > r.left - H &&
				this.px < r.right + H &&
				this.py > r.top - H &&
				this.py < r.bottom + H &&
				under &&
				!AetherCursor.snappable(under) &&
				!under.closest(AetherCursor.TEXT_SEL)
			)
				best = this.snapEl;
		}

		if (best) this.snap(best);
		else this.unsnap();
	}

	private snap(el: HTMLElement) {
		if (el === this.snapEl) return;
		const fresh = !this.snapEl;
		this.snapEl = el;
		if (fresh) {
			// It grows out of the arrow's tip, so the arrow visibly becomes it.
			this.sx = { v: this.shownX, u: 0 };
			this.sy = { v: this.shownY, u: 0 };
			this.sw = { v: 12, u: 0 };
			this.sh = { v: 12, u: 0 };
			this.sr = { v: 6, u: 0 };
		}
		this.root.classList.add("is-snapped");
		this.startLoop();
	}

	private unsnap(now = false) {
		if (!this.snapEl) return;
		this.snapEl = null;
		this.root.classList.remove("is-snapped");
		if (now) {
			this.hl.style.opacity = "";
			return;
		}
		// The highlight pours back into the arrow, then the loop parks.
		this.startLoop();
	}

	private paintState() {
		const s: AetherCursorState = this.grabbing ? "grabbing" : this.state;
		if (this.root.dataset.state !== s) this.root.dataset.state = s;
		this.root.classList.toggle("is-pressed", this.pressed);
	}

	/* ---- the spring --------------------------------------------------------- */

	private startLoop() {
		if (this.raf || !this.active) return;
		this.lastT = performance.now();
		this.raf = requestAnimationFrame((t) => this.tick(t));
	}

	private stopLoop() {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	/**
	 * Semi-implicit Euler on a damped spring. `response` is the period in
	 * seconds and `damping` the ratio, as in AetherMotion.spring(): the jump
	 * onto a target overshoots a hair, the return is critically damped.
	 */
	private static step(
		c: DimSpringChannel,
		target: number,
		dt: number,
		response: number,
		damping: number,
	) {
		const k = Math.pow((2 * Math.PI) / response, 2);
		const d = (4 * Math.PI * damping) / response;
		c.u += (-k * (c.v - target) - d * c.u) * dt;
		c.v += c.u * dt;
	}

	private tick(t: number) {
		this.raf = 0;
		if (!this.active) return;
		const dt = Math.min(1 / 30, Math.max(1 / 240, (t - this.lastT) / 1000));
		this.lastT = t;

		let tx = this.shownX;
		let ty = this.shownY;
		let tw = 12;
		let th = 12;
		let tr = 6;
		const el = this.snapEl;
		if (el && !el.isConnected) this.unsnap();
		if (this.snapEl) {
			const r = this.snapEl.getBoundingClientRect();
			const P = AetherCursor.PAD;
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			// It leans a little toward the pointer, so it feels held.
			tx = cx + (this.px - cx) * 0.12;
			ty = cy + (this.py - cy) * 0.12;
			tw = r.width + P * 2;
			th = r.height + P * 2;
			let radius = 10;
			try {
				radius =
					parseFloat(getComputedStyle(this.snapEl).borderTopLeftRadius) || 10;
			} catch {
				/* as is */
			}
			tr = Math.min(Math.min(tw, th) / 2, radius + P);
		}

		const snapped = !!this.snapEl;
		const [resp, damp] = this.reduced
			? [0.01, 1]
			: snapped
				? [0.3, 0.74]
				: [0.22, 1];
		const S = AetherCursor.step;
		S(this.sx, tx, dt, resp, damp);
		S(this.sy, ty, dt, resp, damp);
		S(this.sw, tw, dt, resp, damp);
		S(this.sh, th, dt, resp, damp);
		S(this.sr, tr, dt, resp, damp);

		const w = Math.max(0, this.sw.v);
		const h = Math.max(0, this.sh.v);
		const hl = this.hl.style;
		hl.width = w + "px";
		hl.height = h + "px";
		hl.borderRadius = Math.max(0, this.sr.v) + "px";
		hl.transform = `translate3d(${this.sx.v - w / 2}px, ${this.sy.v - h / 2}px, 0)`;

		const moving =
			Math.abs(this.sx.v - tx) +
				Math.abs(this.sy.v - ty) +
				Math.abs(this.sw.v - tw) +
				Math.abs(this.sh.v - th) >
				0.3 ||
			Math.abs(this.sx.u) + Math.abs(this.sy.u) + Math.abs(this.sw.u) > 2;
		// Snapped, it keeps tracking (the target can move, the pointer leans
		// it); free, it parks once it's back under the arrow.
		if (snapped || moving)
			this.raf = requestAnimationFrame((n) => this.tick(n));
	}

	/* ---- iframes and leaving the window ----------------------------------- */

	/**
	 * Hidden: our cursor goes and the native one comes back (the body loses
	 * `cursor: none`), so there's never a moment with no cursor at all.
	 */
	private suppress(on: boolean) {
		if (this.suppressed === on) return;
		this.suppressed = on;
		this.root.classList.toggle("aether-cursor-hidden", on);
		document.body?.classList.toggle("aether-cursor-active", !on && this.active);
		if (on) {
			this.unsnap(true);
			this.stopLoop();
		}
	}

	/**
	 * pointermove stops arriving the moment the pointer is over an iframe, so
	 * a stale timestamp with a frame under the last position means hand over.
	 */
	private startWatchdog() {
		if (this.watchdog) return;
		this.watchdog = window.setInterval(() => {
			if (!this.active || document.hidden || this.suppressed) return;
			if (this.watchdogChecked) return;
			if (performance.now() - this.lastMoveAt < 140) return;
			this.watchdogChecked = true;
			let over: Element | null = null;
			try {
				over = document.elementFromPoint(this.px, this.py);
			} catch {
				over = null;
			}
			if (over === null || AetherCursor.isFrame(over)) this.suppress(true);
			else this.findSnap();
		}, 160);
	}
}

/* Same lexical-vs-global caveat as Widgets.tsx — expose the property form. */
(globalThis as any).AetherCursor = AetherCursor;
