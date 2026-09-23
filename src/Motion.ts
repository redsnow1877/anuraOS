/**
 * Aether — motion
 * ---------------------------------------------------------------------------
 * Real springs, and the choreography built out of them:
 *
 *   unlock    the desktop drops in from the middle of the screen and spreads
 *             out to where everything lives: nearest pieces first, the
 *             outermost last, each on its own spring
 *   lock      the desktop recedes under the lock screen's blur
 *   windows   a window grows out of whatever you clicked to open it, closes
 *             by falling away, and minimises into its dock icon
 *
 * Every animation here touches `translate`, `scale`, `rotate` and `opacity`
 * and nothing else, through the Web Animations API, so it runs on the
 * compositor: no layout, no paint, nothing on the main thread per frame. The
 * spring curves are CSS `linear()` easings sampled from the actual physics,
 * computed once per (response, damping) pair and cached.
 *
 * Two things that would quietly wreck that are handled here:
 *
 *   - CSS transitions outrank animations in the cascade. A window's own
 *     `transition: opacity .16s` would take over the first 160ms of any
 *     opacity animation and then hand back mid-flight, a visible jump. Every
 *     animated element is put under `.mo-hold` (transition: none) for the
 *     duration.
 *   - `backdrop-filter` only sees as far back as the nearest ancestor with
 *     opacity < 1. Fading a widget's wrapper would turn its glass into flat
 *     tint for the whole animation and then pop the blur back on at the end,
 *     so glass surfaces fade themselves, never through a parent.
 */

interface AetherSpringCurve {
	easing: string;
	/** Milliseconds until it's within 0.1% of rest. */
	duration: number;
}

interface AetherMotionPiece {
	el: HTMLElement;
	/** What fades. Usually `el`; the glass card inside a desktop widget. */
	fade: HTMLElement;
	rect: DOMRect;
	opacity: number;
	/** False when the element's own CSS uses `translate` (the island). */
	canTranslate: boolean;
	canScale: boolean;
}

class AetherMotion {
	static bound = false;

	static readonly supportsLinear =
		typeof CSS !== "undefined" &&
		CSS.supports("animation-timing-function", "linear(0, 0.5 40%, 1)");

	static #springs = new Map<string, AetherSpringCurve>();

	/**
	 * A damped spring as a CSS easing. `response` is how long one undamped
	 * oscillation would take, in seconds (SwiftUI's meaning: smaller is
	 * snappier). `damping` is the damping ratio: 1 settles without
	 * overshooting, lower values overshoot and settle back.
	 */
	static spring(response: number, damping: number): AetherSpringCurve {
		const key = response + "/" + damping;
		const hit = this.#springs.get(key);
		if (hit) return hit;

		const w = (2 * Math.PI) / response;
		const z = damping;
		let x: (t: number) => number;
		if (z < 1) {
			const wd = w * Math.sqrt(1 - z * z);
			x = (t) =>
				1 -
				Math.exp(-z * w * t) *
					(Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
		} else if (z === 1) {
			x = (t) => 1 - Math.exp(-w * t) * (1 + w * t);
		} else {
			// Overdamped, written as two decaying exponentials so it can't
			// overflow the way cosh/sinh would for long settle times.
			const r1 = -w * (z - Math.sqrt(z * z - 1));
			const r2 = -w * (z + Math.sqrt(z * z - 1));
			x = (t) =>
				1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
		}

		// Settled: the last moment it's more than 0.1% from rest.
		let settle = 0;
		for (let t = 0; t < 8; t += 0.002)
			if (Math.abs(1 - x(t)) > 0.001) settle = t;
		const T = settle + 0.002;

		// Sample where the curve bends, not at fixed steps: the start of a
		// spring is steep and the tail is nearly flat, so even spacing would
		// waste points on the tail and cut corners at the start.
		const points: Array<[number, number]> = [[0, 0]];
		const refine = (a: number, b: number, depth: number) => {
			const m = (a + b) / 2;
			const va = x(a * T);
			const vb = x(b * T);
			if (depth < 6 && Math.abs(x(m * T) - (va + vb) / 2) > 0.0006) {
				refine(a, m, depth + 1);
				refine(m, b, depth + 1);
			} else points.push([b, vb]);
		};
		const segments = 12;
		for (let i = 0; i < segments; i++)
			refine(i / segments, (i + 1) / segments, 0);

		let easing: string;
		if (this.supportsLinear) {
			const stops = points.map(([p, v], i) =>
				i === 0
					? "0"
					: i === points.length - 1
						? "1"
						: `${+v.toFixed(4)} ${+(p * 100).toFixed(2)}%`,
			);
			easing = `linear(${stops.join(", ")})`;
		} else {
			easing =
				z < 0.9
					? "cubic-bezier(0.34, 1.3, 0.5, 1)"
					: "cubic-bezier(0.2, 0.9, 0.25, 1)";
		}
		const curve = { easing, duration: Math.round(T * 1000) };
		this.#springs.set(key, curve);
		return curve;
	}

	/* ---- housekeeping ------------------------------------------------------ */

	/** No animation setting, the OS preference, or `body.reduce-motion`. */
	static get reduced(): boolean {
		try {
			if (anura.settings.get("disable-animation")) return true;
		} catch {
			/* anura isn't up yet */
		}
		return (
			!!document.body?.classList.contains("reduce-motion") ||
			matchMedia("(prefers-reduced-motion: reduce)").matches
		);
	}

	/** Push the current `disable-animation` value onto <body>. */
	static sync(): void {
		try {
			if (!document.body) return;
			document.body.classList.toggle(
				"reduce-motion",
				!!anura.settings.get("disable-animation"),
			);
		} catch {
			/* ignore */
		}
	}

	/** Sync now and on every settings change event the shell emits. */
	static watch(): void {
		if (this.bound) return;
		this.bound = true;
		this.sync();
		document.addEventListener("anura-settings-change", () => this.sync());
		document.addEventListener("anura-theme-change", () => this.sync());
	}

	static #holds = new WeakMap<HTMLElement, number>();

	/** Suspend an element's CSS transitions (counted, so holds can nest). */
	static hold(el: HTMLElement) {
		const n = this.#holds.get(el) || 0;
		this.#holds.set(el, n + 1);
		if (!n) el.classList.add("mo-hold");
	}

	static release(el: HTMLElement) {
		const n = (this.#holds.get(el) || 0) - 1;
		if (n > 0) return void this.#holds.set(el, n);
		this.#holds.delete(el);
		el.classList.remove("mo-hold", "mo-origin");
		el.style.removeProperty("--mo-ox");
		el.style.removeProperty("--mo-oy");
	}

	/**
	 * Scale about the element's visual centre even when its own `transform`
	 * translates it (the dock is centred with translateX(-50%), desktop
	 * widgets are positioned with translate()). The individual transform
	 * properties apply before `transform`, so with the default origin the
	 * scale would pivot somewhere off to the side. Returns false when the
	 * element's transform is more than a translation and scaling it would
	 * look wrong either way.
	 */
	static #pivot(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
		if (!cs.transform || cs.transform === "none") return true;
		const m = new DOMMatrixReadOnly(cs.transform);
		if (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1) return false;
		if (!m.e && !m.f) return true;
		el.style.setProperty("--mo-ox", el.offsetWidth / 2 + m.e + "px");
		el.style.setProperty("--mo-oy", el.offsetHeight / 2 + m.f + "px");
		el.classList.add("mo-origin");
		return true;
	}

	/**
	 * One read pass over everything that's about to move, after the holds are
	 * on and before any animation starts, so there's exactly one style and
	 * layout flush however many pieces there are.
	 */
	static #measure(
		els: HTMLElement[],
		fadeOf?: (el: HTMLElement) => HTMLElement,
	): AetherMotionPiece[] {
		const out: AetherMotionPiece[] = [];
		for (const el of els) {
			const cs = getComputedStyle(el);
			if (cs.display === "none" || cs.visibility === "hidden") continue;
			const fade = fadeOf?.(el) || el;
			const opacity = parseFloat(
				fade === el ? cs.opacity : getComputedStyle(fade).opacity,
			);
			if (!(opacity > 0.01)) continue;
			const rect = el.getBoundingClientRect();
			if (rect.width < 1 || rect.height < 1) continue;
			out.push({
				el,
				fade,
				rect,
				opacity,
				canTranslate: cs.translate === "none" || cs.translate === "0px",
				canScale: this.#pivot(el, cs),
			});
		}
		return out;
	}

	/* ---- lock / unlock ------------------------------------------------------ */

	static #lockRun: { anims: Animation[]; els: HTMLElement[] } | null = null;

	static #desktop() {
		const q = (s: string) =>
			Array.from(document.querySelectorAll<HTMLElement>(s));
		return {
			stage: [...q(".aliceWMwin"), ...q("#desktop-widgets .dw-item")],
			dock: q("#dock"),
			dockItems: q("#dock #launcher-button-container, #dock .dock-item"),
			menubar: q("#menubar"),
			menuItems: q(
				"#menubar > .menubar-item, #menubar-right > *, #menubar > #island",
			),
		};
	}

	/** Desktop widgets fade their glass card, not the wrapper. See the top. */
	static #fadeTarget = (el: HTMLElement) =>
		(el.classList.contains("dw-item") &&
			el.querySelector<HTMLElement>(":scope > .widget-card")) ||
		el;

	/**
	 * The desktop recedes: everything drifts a little toward the middle,
	 * shrinks and fades while the lock screen's blur comes up over it. Calls
	 * `hide` (which puts `aether-locked` on the body) once it's out of sight.
	 */
	static lock(hide: () => void) {
		this.#finishLock();
		if (this.reduced) return hide();
		const d = this.#desktop();
		const all = [...d.stage, ...d.dock, ...d.dockItems, ...d.menubar];
		all.forEach((el) => this.hold(el));
		const pieces = this.#measure(all, this.#fadeTarget);
		const vw = innerWidth;
		const vh = innerHeight;
		const anims: Animation[] = [];
		const ease = "cubic-bezier(0.4, 0, 0.9, 0.6)";
		for (const p of pieces) {
			const x = p.rect.left + p.rect.width / 2 - vw / 2;
			const y = p.rect.top + p.rect.height / 2 - vh * 0.46;
			const isBar = p.el.id === "menubar";
			const isDock = p.el.id === "dock" || !!p.el.closest("#dock");
			const to: Keyframe = {};
			if (p.canTranslate)
				to.translate = isBar
					? "0 -10px"
					: isDock
						? "0 14px"
						: `${-x * 0.06}px ${-y * 0.06 + 8}px`;
			if (p.canScale && !isBar) to.scale = isDock ? "0.97" : "0.94";
			anims.push(
				p.el.animate([{}, to], {
					duration: 300,
					easing: ease,
					fill: "forwards",
				}),
				p.fade.animate([{}, { opacity: 0 }], {
					duration: 240,
					easing: "cubic-bezier(0.4, 0, 1, 1)",
					fill: "forwards",
				}),
			);
		}
		const run = { anims, els: all };
		this.#lockRun = run;
		// Cancelled by an early unlock: the promise rejects and nothing hides.
		Promise.all(anims.map((a) => a.finished)).then(
			() => {
				if (this.#lockRun !== run) return;
				hide();
				this.#finishLock();
			},
			() => {},
		);
	}

	static #finishLock() {
		const run = this.#lockRun;
		if (!run) return;
		this.#lockRun = null;
		run.anims.forEach((a) => a.cancel());
		run.els.forEach((el) => this.release(el));
	}

	/**
	 * The unlock. Calls `reveal` (which takes `aether-locked` off the body)
	 * at the right moment inside the choreography, and returns how long the
	 * whole thing runs, in milliseconds.
	 *
	 * Everything starts gathered toward the middle of the screen, a little
	 * above where it belongs, smaller and invisible, then drops down and
	 * spreads outward into place. The delay grows with distance from the
	 * centre, so the desktop blooms outward in one continuous wave: windows
	 * and widgets first, then the dock fanning out from its middle, then the
	 * menu bar. Each piece settles on a spring whose stiffness depends on
	 * what it is: big windows are heavier and softer, dock icons are light
	 * and land with a small bounce, the menu bar doesn't overshoot at all
	 * (overshooting would open a gap above it).
	 */
	static unlock(reveal: () => void): number {
		const lockWasRunning = !!this.#lockRun;
		this.#finishLock();
		if (this.reduced) {
			reveal();
			return 0;
		}

		const d = this.#desktop();
		const all = [
			...d.stage,
			...d.dock,
			...d.dockItems,
			...d.menubar,
			...d.menuItems,
		];
		// Holds first, then reveal, then measure: taking the class off with
		// transitions still live would start a 0 → 1 fade on every window that
		// the animations below can't override.
		all.forEach((el) => this.hold(el));
		reveal();
		const stage = this.#measure(d.stage, this.#fadeTarget);
		const [dock] = this.#measure(d.dock);
		const dockItems = this.#measure(d.dockItems);
		const [bar] = this.#measure(d.menubar);
		const menuItems = this.#measure(d.menuItems);

		const vw = innerWidth;
		const vh = innerHeight;
		const cx = vw / 2;
		const cy = vh * 0.46;
		const reach = Math.hypot(vw / 2, vh / 2);
		const anims: Animation[] = [];
		// A window that was mid-recede should pick up from where it is rather
		// than snap to fully faded first; a head start does that well enough.
		const head = lockWasRunning ? 0 : 40;

		const fadeIn = (p: AetherMotionPiece, delay: number, duration: number) =>
			anims.push(
				p.fade.animate([{ opacity: 0 }, { opacity: p.opacity }], {
					duration,
					delay,
					easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
					fill: "backwards",
				}),
			);
		const move = (
			p: AetherMotionPiece,
			from: { x?: number; y?: number; s?: number; r?: number },
			delay: number,
			spring: AetherSpringCurve,
		) => {
			const a: Keyframe = {};
			const b: Keyframe = {};
			if (p.canTranslate && (from.x || from.y)) {
				a.translate = `${from.x || 0}px ${from.y || 0}px`;
				b.translate = "0px 0px";
			}
			if (p.canScale && from.s !== undefined) {
				a.scale = String(from.s);
				b.scale = "1";
			}
			if (from.r) {
				a.rotate = from.r + "deg";
				b.rotate = "0deg";
			}
			if (Object.keys(a).length)
				anims.push(
					p.el.animate([a, b], {
						duration: spring.duration,
						delay,
						easing: spring.easing,
						fill: "backwards",
					}),
				);
		};

		// Windows and widgets: the bloom.
		const lift = Math.min(84, vh * 0.08);
		for (const p of stage) {
			const x = p.rect.left + p.rect.width / 2 - cx;
			const y = p.rect.top + p.rect.height / 2 - cy;
			const dn = Math.min(1, Math.hypot(x, y) / reach);
			// Big surfaces shrink less: a maximised window starting at 80%
			// would sweep its edges a hundred-odd pixels, which reads as a
			// zoom, not a drop.
			const size = Math.min(
				1,
				Math.sqrt((p.rect.width * p.rect.height) / (vw * vh)),
			);
			const s = 0.66 + 0.2 * size;
			const delay = head + Math.pow(dn, 0.9) * 260;
			const spring = this.spring(0.62 + 0.12 * size, 0.82);
			move(
				p,
				{
					x: -x * 0.5,
					y: -y * 0.5 - lift,
					s,
					// Fanned: pieces left of centre come in turned slightly
					// one way, right of centre the other, and straighten out as
					// they spread. Barely there, but it's what makes it feel
					// thrown rather than slid.
					r: Math.max(-1, Math.min(1, x / (vw / 2))) * -2.6 * (1 - size),
				},
				delay,
				spring,
			);
			fadeIn(p, delay, 300);
		}

		// The dock rises into place while its icons drop into it, fanning out
		// from the middle.
		if (dock) {
			const delay = head + 120;
			move(dock, { y: 22, s: 0.96 }, delay, this.spring(0.5, 0.92));
			fadeIn(dock, delay, 220);
			const dcx = dock.rect.left + dock.rect.width / 2;
			const half = Math.max(1, dock.rect.width / 2);
			for (const p of dockItems) {
				const x = p.rect.left + p.rect.width / 2 - dcx;
				const dn = Math.min(1, Math.abs(x) / half);
				const itemDelay = delay + 50 + dn * 190;
				move(
					p,
					{ x: -x * 0.5, y: -18, s: 0.35 },
					itemDelay,
					this.spring(0.46, 0.64),
				);
				fadeIn(p, itemDelay, 150);
			}
		}

		// The menu bar slides down; its items settle outward from the island.
		if (bar) {
			const delay = head + 90;
			move(bar, { y: -bar.rect.height - 2 }, delay, this.spring(0.42, 1));
			fadeIn(bar, delay, 200);
			for (const p of menuItems) {
				const x = p.rect.left + p.rect.width / 2 - cx;
				const dn = Math.min(1, Math.abs(x) / (vw / 2));
				const itemDelay = delay + 110 + dn * 170;
				move(
					p,
					{ x: -x * 0.06, y: -7, s: 0.9 },
					itemDelay,
					this.spring(0.4, 0.82),
				);
				fadeIn(p, itemDelay, 180);
			}
		}

		let end = 0;
		for (const a of anims) {
			const t = a.effect?.getComputedTiming();
			end = Math.max(end, Number(t?.endTime) || 0);
		}
		// Every animation above fills backwards only, so once finished it
		// stops applying and the element is simply at rest where it was.
		const release = () => all.forEach((el) => this.release(el));
		Promise.all(anims.map((a) => a.finished)).then(release, release);
		return end;
	}

	/** The unlock's entrance on its own: boot, and the end of setup. */
	static revealDesktop(): number {
		return this.unlock(() => {});
	}

	/* ---- windows ------------------------------------------------------------ */

	static #origin: { rect: DOMRect; at: number } | null = null;

	/**
	 * Remember where an app was launched from, so its first window can grow
	 * out of that spot. Called for dock icons, Launchpad tiles and Spotlight
	 * results. Only the next window within a couple of seconds uses it.
	 */
	static noteLaunch(from: Element | null | undefined) {
		if (!from) return;
		const rect = from.getBoundingClientRect();
		if (rect.width < 1) return;
		this.#origin = { rect, at: performance.now() };
	}

	static #takeOrigin(): DOMRect | null {
		const o = this.#origin;
		this.#origin = null;
		if (!o || performance.now() - o.at > 2500) return null;
		return o.rect;
	}

	static #dockIconFor(app: { name?: string } | null | undefined) {
		if (!app?.name) return null;
		const item = document.querySelector<HTMLElement>(
			`#dock .dock-item[data-title="${CSS.escape(app.name)}"]`,
		);
		const icon = item?.querySelector<HTMLElement>(".dock-icon") || item;
		const r = icon?.getBoundingClientRect();
		return r && r.width > 0 ? r : null;
	}

	static #live = new WeakMap<HTMLElement, Animation[]>();

	static #run(el: HTMLElement, anims: Animation[]) {
		this.#live.get(el)?.forEach((a) => a.cancel());
		this.#live.set(el, anims);
		this.hold(el);
		let done = false;
		const settle = () => {
			if (done) return;
			done = true;
			// Entries that fill forwards stay listed until cancel(): they're
			// still holding the element's look (a minimised window's shrunk
			// state) and a later animation has to be able to clear them.
			if (
				this.#live.get(el) === anims &&
				!anims.some((a) => a.effect?.getTiming().fill === "forwards")
			)
				this.#live.delete(el);
			this.release(el);
		};
		Promise.all(anims.map((a) => a.finished)).then(settle, settle);
		return Promise.all(anims.map((a) => a.finished.catch(() => a)));
	}

	/**
	 * A new window appears. With a launch origin it grows out of that icon
	 * on a spring; without one it rises into place from slightly smaller.
	 * Takes `opacity0` off the window itself (with transitions held, so the
	 * window's own opacity transition can't hijack the first 160ms).
	 */
	static openWindow(el: HTMLElement) {
		if (this.reduced) {
			el.classList.remove("opacity0");
			return;
		}
		const origin = this.#takeOrigin();
		this.hold(el);
		el.classList.remove("opacity0");
		const r = el.getBoundingClientRect();
		let anims: Animation[];
		if (origin && r.width > 0) {
			const s = Math.min(
				0.5,
				Math.max(
					0.06,
					Math.max(origin.width / r.width, origin.height / r.height),
				),
			);
			const x = origin.left + origin.width / 2 - (r.left + r.width / 2);
			const y = origin.top + origin.height / 2 - (r.top + r.height / 2);
			const spring = this.spring(0.44, 0.86);
			anims = [
				el.animate(
					[
						{ translate: `${x}px ${y}px`, scale: String(s) },
						{ translate: "0px 0px", scale: "1" },
					],
					{ duration: spring.duration, easing: spring.easing },
				),
				el.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 170,
					easing: "cubic-bezier(0.2, 0.6, 0.35, 1)",
				}),
			];
		} else {
			const spring = this.spring(0.42, 0.84);
			anims = [
				el.animate(
					[
						{ translate: "0px 14px", scale: "0.9" },
						{ translate: "0px 0px", scale: "1" },
					],
					{ duration: spring.duration, easing: spring.easing },
				),
				el.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 180,
					easing: "cubic-bezier(0.2, 0.6, 0.35, 1)",
				}),
			];
		}
		void this.#run(el, anims);
		this.release(el);
	}

	/** Falls away: a little smaller, a little lower, gone. Resolves when done. */
	static closeWindow(el: HTMLElement): Promise<unknown> {
		if (this.reduced) return Promise.resolve();
		el.classList.remove("scaletransition");
		return this.#run(el, [
			el.animate(
				[
					{ translate: "0px 0px", scale: "1" },
					{ translate: "0px 10px", scale: "0.92" },
				],
				{
					duration: 210,
					easing: "cubic-bezier(0.4, 0, 0.9, 0.5)",
					fill: "forwards",
				},
			),
			el.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 180,
				easing: "cubic-bezier(0.4, 0, 1, 1)",
				fill: "forwards",
			}),
		]);
	}

	/**
	 * Into the dock. The window pours toward its icon from the bottom edge:
	 * it squeezes horizontally faster than it shrinks vertically, so it reads
	 * as being drawn in rather than simply scaled down.
	 */
	static minimizeWindow(
		el: HTMLElement,
		app?: { name?: string } | null,
	): Promise<unknown> {
		if (this.reduced) return Promise.resolve();
		el.classList.remove("scaletransition");
		const r = el.getBoundingClientRect();
		const target =
			this.#dockIconFor(app) ||
			document.getElementById("dock")?.getBoundingClientRect() ||
			new DOMRect(innerWidth / 2 - 24, innerHeight - 60, 48, 48);
		const x = target.left + target.width / 2 - (r.left + r.width / 2);
		const y = target.top + target.height / 2 - (r.top + r.height);
		const sx = Math.max(0.04, target.width / r.width);
		const sy = Math.max(0.03, target.height / r.height);
		el.style.setProperty("--mo-ox", "50%");
		el.style.setProperty("--mo-oy", "100%");
		el.classList.add("mo-origin");
		const opts = { duration: 440, fill: "forwards" as FillMode };
		return this.#run(el, [
			el.animate(
				[
					{ translate: "0px 0px" },
					{ translate: `${x * 0.18}px ${y * 0.1}px`, offset: 0.3 },
					{ translate: `${x}px ${y}px` },
				],
				{ ...opts, easing: "cubic-bezier(0.55, 0.05, 0.7, 0.35)" },
			),
			el.animate(
				[
					{ scale: "1 1" },
					{ scale: `${0.55 + 0.45 * sx} ${0.78 + 0.22 * sy}`, offset: 0.35 },
					{ scale: `${sx} ${sy}` },
				],
				{ ...opts, easing: "cubic-bezier(0.45, 0, 0.6, 0.4)" },
			),
			el.animate(
				[{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
				{ ...opts, easing: "cubic-bezier(0.4, 0, 1, 1)" },
			),
		]);
	}

	/** Back out of the dock, springing up into place. */
	static restoreWindow(el: HTMLElement, app?: { name?: string } | null) {
		if (this.reduced) {
			el.classList.remove("opacity0");
			return;
		}
		el.classList.remove("scaletransition");
		this.hold(el);
		el.classList.remove("opacity0");
		const r = el.getBoundingClientRect();
		const from =
			this.#dockIconFor(app) ||
			document.getElementById("dock")?.getBoundingClientRect() ||
			new DOMRect(innerWidth / 2 - 24, innerHeight - 60, 48, 48);
		const x = from.left + from.width / 2 - (r.left + r.width / 2);
		const y = from.top + from.height / 2 - (r.top + r.height);
		const sx = Math.max(0.04, from.width / r.width);
		const sy = Math.max(0.03, from.height / r.height);
		el.style.setProperty("--mo-ox", "50%");
		el.style.setProperty("--mo-oy", "100%");
		el.classList.add("mo-origin");
		const spring = this.spring(0.46, 0.86);
		const scaleSpring = this.spring(0.5, 0.9);
		const anims = [
			el.animate([{ translate: `${x}px ${y}px` }, { translate: "0px 0px" }], {
				duration: spring.duration,
				easing: spring.easing,
			}),
			el.animate([{ scale: `${sx} ${sy}` }, { scale: "1 1" }], {
				duration: scaleSpring.duration,
				easing: scaleSpring.easing,
			}),
			el.animate([{ opacity: 0 }, { opacity: 1 }], {
				duration: 200,
				easing: "cubic-bezier(0.2, 0.6, 0.35, 1)",
			}),
		];
		void this.#run(el, anims);
		this.release(el);
	}

	/** Drop whatever this module is animating on `el` (fill-forwards included). */
	static cancel(el: HTMLElement) {
		this.#live.get(el)?.forEach((a) => a.cancel());
		this.#live.delete(el);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherMotion = AetherMotion;
