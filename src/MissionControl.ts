/**
 * Aether — Mission Control, Show Desktop, hot corners
 * ---------------------------------------------------------------------------
 * Mission Control (F3, Ctrl+↑, a hot corner, or Spotlight) lays every visible
 * window out in a grid so you can pick one. The windows themselves move —
 * they're scaled and translated live, iframes and all — so what you see is
 * the real, running content rather than a snapshot.
 *
 * Movement uses the independent `translate` and `scale` properties rather
 * than `transform`. The window manager animates `transform` for open,
 * minimise and focus effects, and a filling animation pins it; the separate
 * properties compose with whatever transform is there instead of losing to
 * it (the same lesson as the Launchpad's magnetic icons).
 *
 * Show Desktop (Ctrl+Alt+D or a hot corner) slides every window out to its
 * nearest screen edge, leaving a sliver visible, and back.
 */

type HotCornerAction =
	| "none"
	| "mission-control"
	| "show-desktop"
	| "launchpad"
	| "spotlight"
	| "lock-screen"
	| "control-center";

const AETHER_HOT_CORNER_ACTIONS: { id: HotCornerAction; label: string }[] = [
	{ id: "none", label: "—" },
	{ id: "mission-control", label: "Mission Control" },
	{ id: "show-desktop", label: "Show Desktop" },
	{ id: "launchpad", label: "Launchpad" },
	{ id: "spotlight", label: "Spotlight" },
	{ id: "lock-screen", label: "Lock Screen" },
	{ id: "control-center", label: "Control Center" },
];

class AetherMissionControl {
	static active = false;
	static desktopShown = false;

	static #backdrop: HTMLElement | null = null;
	static #labels: HTMLElement | null = null;
	static #entries: {
		el: HTMLElement;
		label: HTMLElement;
		close: HTMLElement;
	}[] = [];
	static #selected = -1;
	static #listeners: AbortController | null = null;

	/** Visible, connected windows, in stacking order (back to front). */
	static windows(): HTMLElement[] {
		return Array.from(document.querySelectorAll<HTMLElement>(".aliceWMwin"))
			.filter(
				(el) =>
					el.isConnected &&
					el.style.display !== "none" &&
					!el.classList.contains("opacity0"),
			)
			.sort(
				(a, b) =>
					(parseInt(a.style.zIndex) || 0) - (parseInt(b.style.zIndex) || 0),
			);
	}

	static #animated(): boolean {
		try {
			return !anura.settings.get("disable-animation");
		} catch {
			return true;
		}
	}

	/** Clear our properties once the move back has finished. */
	static #release(el: HTMLElement, delay: number) {
		setTimeout(() => {
			el.style.removeProperty("translate");
			el.style.removeProperty("scale");
			el.style.removeProperty("opacity");
			el.style.removeProperty("--mc-scale");
			el.style.removeProperty("transition");
			el.classList.remove("mc-window", "mc-hover", "mc-selected");
		}, delay);
	}

	/* ---- Mission Control ---------------------------------------------- */

	static toggle() {
		if (this.active) this.exit();
		else this.enter();
	}

	static enter() {
		if (this.active) return;
		if (this.desktopShown) this.restoreDesktop();
		try {
			launcher?.hide?.();
			quickSettings?.close?.();
			calendar?.close?.();
			AetherSpotlight?.instance?.close();
		} catch {
			/* optional pieces */
		}

		const wins = this.windows();
		this.active = true;
		document.body.classList.add("mission-control");
		(globalThis as any).aetherSound?.play?.("launchpadOpen");

		this.#backdrop = document.createElement("div");
		this.#backdrop.id = "mission-control-backdrop";
		const hint = document.createElement("div");
		hint.className = "mc-hint";
		hint.textContent = wins.length
			? "Click a window, or use the arrow keys"
			: "No open windows";
		this.#backdrop.appendChild(hint);
		document.body.appendChild(this.#backdrop);

		this.#labels = document.createElement("div");
		this.#labels.id = "mission-control-labels";
		document.body.appendChild(this.#labels);

		this.#entries = [];
		this.#layout(wins);
		requestAnimationFrame(() => {
			this.#backdrop?.classList.add("is-shown");
			this.#labels?.classList.add("is-shown");
		});

		this.#listeners = new AbortController();
		const signal = this.#listeners.signal;
		document.addEventListener(
			"pointerdown",
			(e) => {
				const win = (e.target as Element | null)?.closest?.(".aliceWMwin");
				const closeBtn = (e.target as Element | null)?.closest?.(".mc-close");
				if (closeBtn) return; // handled by the button itself
				if (win) {
					e.preventDefault();
					e.stopPropagation();
					this.exit(win as HTMLElement);
				} else if (
					e.target === this.#backdrop ||
					(e.target as Element)?.closest?.("#mission-control-backdrop")
				) {
					this.exit();
				}
			},
			{ capture: true, signal },
		);
		document.addEventListener(
			"pointerover",
			(e) => {
				const win = (e.target as Element | null)?.closest?.(".aliceWMwin");
				const i = this.#entries.findIndex((en) => en.el === win);
				if (i >= 0) this.#select(i);
			},
			{ capture: true, signal },
		);
		document.addEventListener(
			"keydown",
			(e) => {
				if (!this.active) return;
				const keys: Record<string, [number, number]> = {
					ArrowLeft: [-1, 0],
					ArrowRight: [1, 0],
					ArrowUp: [0, -1],
					ArrowDown: [0, 1],
				};
				if (e.key === "Escape") {
					e.preventDefault();
					this.exit();
				} else if (e.key === "Enter") {
					e.preventDefault();
					this.exit(this.#entries[this.#selected]?.el);
				} else if (keys[e.key] && !e.ctrlKey && !e.metaKey) {
					e.preventDefault();
					this.#moveSelection(...keys[e.key]!);
				}
			},
			{ capture: true, signal },
		);
		window.addEventListener("resize", () => this.#layout(this.windows()), {
			signal,
		});
	}

	/** Grid that maximises the total on-screen area of the scaled windows. */
	static #layout(wins: HTMLElement[]) {
		if (!this.#labels) return;
		this.#labels.textContent = "";
		this.#entries = [];
		if (!wins.length) return;

		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const top = 28 + 34; // menu bar + breathing room
		const bottom = 82 + 20; // dock reserve
		const side = 48;
		const gap = 36;
		const labelH = 30;
		const W = vw - side * 2;
		const H = vh - top - bottom;

		const rects = wins.map((el) => {
			// Measure without any leftover Mission Control geometry.
			const r = el.getBoundingClientRect();
			const s = parseFloat(el.style.scale) || 1;
			return { w: r.width / s, h: r.height / s, el };
		});
		// Keep spatial memory: order roughly by where windows already are.
		const order = wins
			.map((el, i) => {
				const r = el.getBoundingClientRect();
				return {
					i,
					key:
						Math.round((r.top + r.height / 2) / 200) * 10000 +
						(r.left + r.width / 2),
				};
			})
			.sort((a, b) => a.key - b.key)
			.map((o) => o.i);

		let best = { cols: 1, rows: 1, score: -1 };
		for (let cols = 1; cols <= wins.length; cols++) {
			const rows = Math.ceil(wins.length / cols);
			const cw = (W - gap * (cols - 1)) / cols;
			const ch = (H - gap * (rows - 1)) / rows - labelH;
			if (cw <= 0 || ch <= 0) continue;
			let area = 0;
			for (const r of rects) {
				const s = Math.min(cw / r.w, ch / r.h, 1);
				area += r.w * r.h * s * s;
			}
			if (area > best.score) best = { cols, rows, score: area };
		}

		const { cols, rows } = best;
		const cw = (W - gap * (cols - 1)) / cols;
		const cellH = (H - gap * (rows - 1)) / rows;
		const ch = cellH - labelH;
		const animated = this.#animated();

		order.forEach((winIndex, slot) => {
			const { w, h, el } = rects[winIndex]!;
			const row = Math.floor(slot / cols);
			const inRow = Math.min(cols, wins.length - row * cols);
			const col = slot % cols;
			// Centre a short last row.
			const rowOffset = ((cols - inRow) * (cw + gap)) / 2;
			const cx = side + rowOffset + col * (cw + gap) + cw / 2;
			const cy = top + row * (cellH + gap) + ch / 2;
			const s = Math.min(cw / w, ch / h, 1) * 0.94;

			const r = el.getBoundingClientRect();
			const scaleNow = parseFloat(el.style.scale) || 1;
			const tx0 = parseFloat(el.style.translate?.split(" ")[0] || "0") || 0;
			const ty0 = parseFloat(el.style.translate?.split(" ")[1] || "0") || 0;
			// Centre of the untransformed window.
			const ox = r.left + r.width / 2 - tx0;
			const oy = r.top + r.height / 2 - ty0;
			void scaleNow;

			el.classList.add("mc-window");
			el.style.transition = animated
				? "translate 0.46s var(--ease-spring-soft, cubic-bezier(0.34,1.3,0.64,1)), scale 0.46s var(--ease-spring-soft, cubic-bezier(0.34,1.3,0.64,1))"
				: "none";
			el.style.translate = `${cx - ox}px ${cy - oy}px`;
			el.style.scale = String(s);
			el.style.setProperty("--mc-scale", String(s));

			const wm = wmWindowByElement.get(el);
			const label = document.createElement("div");
			label.className = "mc-label";
			const icon = document.createElement("img");
			icon.src = wm?.app?.icon || "/assets/icons/generic.svg";
			icon.alt = "";
			const text = document.createElement("span");
			text.textContent = wm?.title || wm?.app?.name || "Window";
			label.append(icon, text);
			label.style.left = `${cx}px`;
			label.style.top = `${cy + (h * s) / 2 + 10}px`;
			label.style.maxWidth = `${Math.max(120, w * s)}px`;

			const close = document.createElement("button");
			close.className = "mc-close";
			close.title = "Close window";
			close.innerHTML = '<span class="material-symbols-outlined">close</span>';
			close.style.left = `${cx - (w * s) / 2}px`;
			close.style.top = `${cy - (h * s) / 2}px`;
			close.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const target = wmWindowByElement.get(el);
				el.style.transition = "opacity 0.18s ease, scale 0.18s ease";
				el.style.opacity = "0";
				setTimeout(() => {
					this.#release(el, 0);
					target?.close();
					// Re-flow the survivors into the freed space.
					setTimeout(() => this.active && this.#layout(this.windows()), 60);
				}, 170);
			});

			this.#labels!.append(label, close);
			this.#entries.push({ el, label, close });
		});
		this.#select(
			Math.min(Math.max(this.#selected, 0), this.#entries.length - 1),
		);
	}

	static #select(i: number) {
		this.#selected = i;
		this.#entries.forEach((en, j) => {
			const on = j === i;
			en.el.classList.toggle("mc-selected", on);
			en.label.classList.toggle("is-selected", on);
			en.close.classList.toggle("is-shown", on);
		});
	}

	/** Pick the nearest window in a direction, by on-screen centres. */
	static #moveSelection(dx: number, dy: number) {
		const cur = this.#entries[this.#selected];
		if (!cur) return this.#select(0);
		const c = cur.el.getBoundingClientRect();
		const cx = c.left + c.width / 2;
		const cy = c.top + c.height / 2;
		let best = -1;
		let bestD = Infinity;
		this.#entries.forEach((en, j) => {
			if (j === this.#selected) return;
			const r = en.el.getBoundingClientRect();
			const vx = r.left + r.width / 2 - cx;
			const vy = r.top + r.height / 2 - cy;
			// Must lie in the pressed direction.
			if (dx && Math.sign(vx) !== dx) return;
			if (dy && Math.sign(vy) !== dy) return;
			const d = Math.hypot(vx * (dy ? 2 : 1), vy * (dx ? 2 : 1));
			if (d < bestD) {
				bestD = d;
				best = j;
			}
		});
		if (best >= 0) this.#select(best);
	}

	static exit(pick?: HTMLElement) {
		if (!this.active) return;
		this.active = false;
		this.#listeners?.abort();
		this.#listeners = null;
		(globalThis as any).aetherSound?.play?.("launchpadClose");

		const animated = this.#animated();
		const back = animated ? 420 : 0;
		for (const { el } of this.#entries) {
			el.style.translate = "0px 0px";
			el.style.scale = "1";
			this.#release(el, back + 20);
		}
		this.#backdrop?.classList.remove("is-shown");
		this.#labels?.classList.remove("is-shown");
		const backdrop = this.#backdrop;
		const labels = this.#labels;
		setTimeout(() => {
			backdrop?.remove();
			labels?.remove();
			document.body.classList.remove("mission-control");
		}, back);
		this.#backdrop = null;
		this.#labels = null;
		this.#entries = [];
		this.#selected = -1;

		if (pick) {
			const wm = wmWindowByElement.get(pick);
			try {
				wm?.focus();
			} catch {
				/* window may have closed meanwhile */
			}
		}
	}

	/* ---- Show Desktop -------------------------------------------------- */

	static #desktopListeners: AbortController | null = null;
	static #desktopWindows: HTMLElement[] = [];

	static toggleDesktop() {
		if (this.desktopShown) this.restoreDesktop();
		else this.showDesktop();
	}

	static showDesktop() {
		if (this.active) this.exit();
		const wins = this.windows();
		if (!wins.length) return;
		this.desktopShown = true;
		this.#desktopWindows = wins;
		const vw = window.innerWidth;
		const peek = 26;
		const animated = this.#animated();
		for (const el of wins) {
			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2 - vw / 2;
			// Always sideways: a window pushed up would leave its sliver
			// tucked under the menu bar, and one pushed down behind the dock.
			const tx = cx >= 0 ? vw - peek - r.left : -(r.right - peek);
			const ty = 0;
			el.classList.add("mc-window");
			el.style.transition = animated
				? "translate 0.5s var(--ease-glide, cubic-bezier(0.2,0.8,0.2,1)), opacity 0.5s ease"
				: "none";
			el.style.translate = `${tx}px ${ty}px`;
			el.style.opacity = "0.85";
		}
		document.body.classList.add("desktop-shown");
		// Any click anywhere (including a peeking window) brings them back.
		this.#desktopListeners = new AbortController();
		setTimeout(() => {
			document.addEventListener(
				"pointerdown",
				(e) => {
					const onChrome = (e.target as Element | null)?.closest?.(
						"#dock, #menubar, header",
					);
					if (!onChrome) this.restoreDesktop();
				},
				{ capture: true, signal: this.#desktopListeners!.signal },
			);
		}, 0);
	}

	static restoreDesktop() {
		if (!this.desktopShown) return;
		this.desktopShown = false;
		this.#desktopListeners?.abort();
		this.#desktopListeners = null;
		const back = this.#animated() ? 480 : 0;
		for (const el of this.#desktopWindows) {
			el.style.translate = "0px 0px";
			el.style.opacity = "1";
			this.#release(el, back + 20);
		}
		this.#desktopWindows = [];
		document.body.classList.remove("desktop-shown");
	}
}

/* ---- hot corners -------------------------------------------------------- */

class AetherHotCorners {
	static readonly SETTING_KEY = "aether.hotcorners";
	static readonly DEFAULTS: Record<string, HotCornerAction> = {
		tl: "mission-control",
		tr: "none",
		bl: "none",
		br: "show-desktop",
	};
	static #armed = true;
	static #timer = 0;
	static #corner = "";

	static get config(): Record<string, HotCornerAction> {
		try {
			return {
				...this.DEFAULTS,
				...(anura.settings.get(this.SETTING_KEY) || {}),
			};
		} catch {
			return { ...this.DEFAULTS };
		}
	}

	static run(action: HotCornerAction) {
		switch (action) {
			case "mission-control":
				return AetherMissionControl.toggle();
			case "show-desktop":
				return AetherMissionControl.toggleDesktop();
			case "launchpad":
				return launcher?.toggleVisible?.();
			case "spotlight":
				return AetherSpotlight?.toggle();
			case "lock-screen":
				return AetherCommands.run("lock-screen");
			case "control-center":
				return quickSettings?.toggle?.();
		}
	}

	static init() {
		const R = 2; // px from the very corner
		document.addEventListener(
			"pointermove",
			(e) => {
				if (e.buttons) return; // never while dragging
				const w = window.innerWidth;
				const h = window.innerHeight;
				const x = e.clientX;
				const y = e.clientY;
				const corner =
					x <= R && y <= R
						? "tl"
						: x >= w - 1 - R && y <= R
							? "tr"
							: x <= R && y >= h - 1 - R
								? "bl"
								: x >= w - 1 - R && y >= h - 1 - R
									? "br"
									: "";
				if (!corner) {
					// Re-arm once the pointer has clearly left the corner.
					if (
						!this.#armed &&
						(Math.min(x, w - x) > 40 || Math.min(y, h - y) > 40)
					)
						this.#armed = true;
					clearTimeout(this.#timer);
					this.#corner = "";
					return;
				}
				if (!this.#armed || corner === this.#corner) return;
				this.#corner = corner;
				const action = this.config[corner] || "none";
				if (action === "none") return;
				// A short dwell, so skimming past a corner doesn't fire it.
				clearTimeout(this.#timer);
				this.#timer = window.setTimeout(() => {
					this.#armed = false;
					this.run(action);
				}, 160);
			},
			{ passive: true },
		);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherMissionControl = AetherMissionControl;
(globalThis as any).AetherHotCorners = AetherHotCorners;
(globalThis as any).AETHER_HOT_CORNER_ACTIONS = AETHER_HOT_CORNER_ACTIONS;
