/**
 * Aether — snap layouts
 * ---------------------------------------------------------------------------
 * Rest the pointer on a window's green (zoom) button and a picker appears
 * with a handful of layouts, each drawn as a miniature screen. Click a zone
 * to send the window there. Also on the keyboard: Ctrl+Alt+←/→ for halves,
 * Ctrl+Alt+↑ to maximise, Ctrl+Alt+↓ to restore.
 *
 * Halves and quarters go through the window manager's own snap(), so its
 * snapped state and the split bar between side-by-side windows keep working.
 * Thirds and "centred" are plain geometry. Either way a maximised or snapped
 * window is restored first: snap() saves the current geometry as the restore
 * point, and would otherwise remember the maximised size.
 */

type SnapZone =
	| { kind: "snap"; dir: "left" | "right" | "ne" | "nw" | "se" | "sw" }
	| { kind: "max" }
	| { kind: "rect"; x: number; y: number; w: number; h: number };

interface SnapLayout {
	name: string;
	/** Zones in fractions of the work area, plus what each one does. */
	zones: { x: number; y: number; w: number; h: number; zone: SnapZone }[];
}

const AETHER_SNAP_LAYOUTS: SnapLayout[] = [
	{
		name: "Halves",
		zones: [
			{ x: 0, y: 0, w: 0.5, h: 1, zone: { kind: "snap", dir: "left" } },
			{ x: 0.5, y: 0, w: 0.5, h: 1, zone: { kind: "snap", dir: "right" } },
		],
	},
	{
		name: "Two-thirds",
		zones: [
			{
				x: 0,
				y: 0,
				w: 2 / 3,
				h: 1,
				zone: { kind: "rect", x: 0, y: 0, w: 2 / 3, h: 1 },
			},
			{
				x: 2 / 3,
				y: 0,
				w: 1 / 3,
				h: 1,
				zone: { kind: "rect", x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
			},
		],
	},
	{
		name: "Thirds",
		zones: [0, 1, 2].map((i) => ({
			x: i / 3,
			y: 0,
			w: 1 / 3,
			h: 1,
			zone: { kind: "rect", x: i / 3, y: 0, w: 1 / 3, h: 1 } as SnapZone,
		})),
	},
	{
		name: "Quarters",
		zones: [
			{ x: 0, y: 0, w: 0.5, h: 0.5, zone: { kind: "snap", dir: "nw" } },
			{ x: 0.5, y: 0, w: 0.5, h: 0.5, zone: { kind: "snap", dir: "ne" } },
			{ x: 0, y: 0.5, w: 0.5, h: 0.5, zone: { kind: "snap", dir: "sw" } },
			{ x: 0.5, y: 0.5, w: 0.5, h: 0.5, zone: { kind: "snap", dir: "se" } },
		],
	},
	{
		name: "Side + stack",
		zones: [
			{ x: 0, y: 0, w: 0.5, h: 1, zone: { kind: "snap", dir: "left" } },
			{ x: 0.5, y: 0, w: 0.5, h: 0.5, zone: { kind: "snap", dir: "ne" } },
			{ x: 0.5, y: 0.5, w: 0.5, h: 0.5, zone: { kind: "snap", dir: "se" } },
		],
	},
	{
		name: "Fill or centre",
		zones: [
			{ x: 0, y: 0, w: 0.58, h: 1, zone: { kind: "max" } },
			{
				x: 0.64,
				y: 0.18,
				w: 0.32,
				h: 0.64,
				zone: { kind: "rect", x: 0.15, y: 0.08, w: 0.7, h: 0.84 },
			},
		],
	},
];

class AetherSnapLayouts {
	static #flyout: HTMLElement | null = null;
	static #target: WMWindow | null = null;
	static #showTimer = 0;
	static #hideTimer = 0;

	static init() {
		if (anura.platform.type === "mobile" || anura.platform.type === "tablet")
			return;

		document.addEventListener(
			"pointerover",
			(e) => {
				const btn = (e.target as Element | null)?.closest?.(
					".aliceWMwin .windowButton.maximize",
				);
				if (!btn) return;
				const win = wmWindowByElement.get(
					btn.closest(".aliceWMwin") as HTMLElement,
				);
				if (!win || document.body.classList.contains("mission-control")) return;
				clearTimeout(this.#hideTimer);
				if (this.#flyout && this.#target === win) return;
				clearTimeout(this.#showTimer);
				// A deliberate rest, not a pass-through on the way to close.
				this.#showTimer = window.setTimeout(
					() => this.show(win, btn as HTMLElement),
					420,
				);
			},
			true,
		);
		document.addEventListener(
			"pointerout",
			(e) => {
				const from = e.target as Element | null;
				const to = e.relatedTarget as Element | null;
				const inside = (el: Element | null) =>
					!!el?.closest?.(".snap-flyout, .aliceWMwin .windowButton.maximize");
				if (inside(from) && !inside(to)) {
					clearTimeout(this.#showTimer);
					this.#scheduleHide();
				}
			},
			true,
		);
		// Clicking the zoom button itself still just zooms.
		document.addEventListener(
			"pointerdown",
			(e) => {
				if (!(e.target as Element)?.closest?.(".snap-flyout")) {
					clearTimeout(this.#showTimer);
					this.hide();
				}
			},
			true,
		);
	}

	static #scheduleHide() {
		clearTimeout(this.#hideTimer);
		this.#hideTimer = window.setTimeout(() => this.hide(), 260);
	}

	static show(win: WMWindow, anchor: HTMLElement) {
		this.hide(true);
		this.#target = win;
		const fly = document.createElement("div");
		fly.className = "snap-flyout";
		fly.setAttribute("role", "menu");
		fly.setAttribute("aria-label", "Snap layouts");

		for (const layout of AETHER_SNAP_LAYOUTS) {
			const tile = document.createElement("div");
			tile.className = "snap-layout";
			tile.title = layout.name;
			for (const z of layout.zones) {
				const zone = document.createElement("button");
				zone.className = "snap-zone";
				zone.style.left = `calc(${z.x * 100}% + 2px)`;
				zone.style.top = `calc(${z.y * 100}% + 2px)`;
				zone.style.width = `calc(${z.w * 100}% - 4px)`;
				zone.style.height = `calc(${z.h * 100}% - 4px)`;
				zone.setAttribute("aria-label", layout.name);
				zone.addEventListener("click", (e) => {
					e.stopPropagation();
					const w = this.#target;
					this.hide();
					if (w) AetherSnapLayouts.apply(w, z.zone);
				});
				tile.appendChild(zone);
			}
			fly.appendChild(tile);
		}

		const r = anchor.getBoundingClientRect();
		document.body.appendChild(fly);
		const fw = fly.offsetWidth;
		fly.style.left = `${Math.max(8, Math.min(window.innerWidth - fw - 8, r.left - 14))}px`;
		fly.style.top = `${r.bottom + 10}px`;
		requestAnimationFrame(() => fly.classList.add("is-shown"));
		this.#flyout = fly;
	}

	static hide(immediate = false) {
		clearTimeout(this.#hideTimer);
		const fly = this.#flyout;
		if (!fly) return;
		this.#flyout = null;
		this.#target = null;
		if (immediate) return fly.remove();
		fly.classList.remove("is-shown");
		setTimeout(() => fly.remove(), 160);
	}

	/** Restore a maximised/snapped window so new geometry starts clean. */
	static async #unsnap(win: WMWindow) {
		if (win.maximized || win.snapped) {
			await win.unmaximize();
			// unmaximize() animates back; let it land before re-placing.
			await new Promise((r) => setTimeout(r, win.snapped ? 20 : 60));
		}
	}

	static async apply(win: WMWindow, zone: SnapZone) {
		await this.#unsnap(win);
		(globalThis as any).aetherSound?.play?.("maximize");
		if (zone.kind === "max") return win.maximize();
		if (zone.kind === "snap") return win.snap(zone.dir);

		const W = window.innerWidth;
		const H = window.innerHeight - WM_V_INSET;
		const gap = 4;
		const el = win.element;
		const animated = !anura.settings.get("disable-animation");
		if (animated) el.classList.add("maxtransition");
		el.style.left = `${Math.round(zone.x * W) + (zone.x > 0 ? gap / 2 : 0)}px`;
		el.style.top = `${WM_TOP_INSET + Math.round(zone.y * H)}px`;
		el.style.width = `${Math.round(zone.w * W) - (zone.x > 0 && zone.x + zone.w < 1 ? gap : gap / 2)}px`;
		el.style.height = `${Math.round(zone.h * H)}px`;
		if (animated) setTimeout(() => el.classList.remove("maxtransition"), 240);
		win.width = parseFloat(el.style.width);
		win.height = parseFloat(el.style.height);
		win.dispatchEvent(
			new MessageEvent("resize", {
				data: { width: win.width, height: win.height },
			}),
		);
		win.onresize(win.width, win.height);
		win.focus();
	}

	/** The focused window, for keyboard snapping. */
	static focused(): WMWindow | null {
		const el = document.querySelector<HTMLElement>(".aliceWMwin.focused");
		return el ? wmWindowByElement.get(el) || null : null;
	}

	static registerShortcuts() {
		const on = (
			combo: string,
			description: string,
			fn: (w: WMWindow) => void,
		) =>
			AetherShortcuts.register({
				combo,
				group: "Windows",
				description,
				handler: () => {
					const w = this.focused();
					if (w) fn(w);
				},
			});
		on("Ctrl+Alt+ArrowLeft", "Snap window to the left half", (w) =>
			this.apply(w, { kind: "snap", dir: "left" }),
		);
		on("Ctrl+Alt+ArrowRight", "Snap window to the right half", (w) =>
			this.apply(w, { kind: "snap", dir: "right" }),
		);
		on("Ctrl+Alt+ArrowUp", "Maximise window", (w) =>
			this.apply(w, { kind: "max" }),
		);
		on("Ctrl+Alt+ArrowDown", "Restore window", (w) => {
			if (w.maximized || w.snapped) w.unmaximize();
			else w.minimize();
		});
		on("Ctrl+Alt+C", "Centre window", (w) =>
			this.apply(w, { kind: "rect", x: 0.15, y: 0.08, w: 0.7, h: 0.84 }),
		);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherSnapLayouts = AetherSnapLayouts;
