/**
 * Dimension — the island
 * ---------------------------------------------------------------------------
 * A black pill that floats at the top of the screen and grows into whatever is
 * happening right now. Built on Apple's rules for the Dynamic Island:
 *
 *   rest      the pill, always there: the island has a home that everything
 *             grows out of and goes back into
 *   compact   one activity: content either side of the middle, the whole
 *             thing no wider than that content needs
 *   minimal   a second activity splits off into a detached bubble on the
 *             right. The split and merge are liquid: an SVG "goo" filter runs
 *             just for the length of it, so edges are crisp the rest of the time
 *   peek      hovering grows it a little toward where a click would take it,
 *             and says what that is
 *   expanded  click to open: the activity's full card, or a small dashboard
 *   alerts    notifications and HUDs (volume, brightness, battery) burst out
 *             of the island and shrink back into it, instead of corner toasts
 *
 * Motion follows "Designing Fluid Interfaces" (WWDC 2018): everything moves
 * on springs, critically damped by default with a few percent of overshoot
 * only when growing, and every change can be interrupted mid-flight. Sizes are
 * CSS transitions, which retarget smoothly from wherever they are.
 *
 * Sizes change for real (width, height, radius) rather than by scaling, so
 * text never stretches. The island is small, solid black, and isolated with
 * `contain`, so that relayout costs next to nothing.
 *
 * Activities register with set(id, spec). Music, timers and recording are
 * built in; the AI assistant and others add their own.
 */

interface IslandActivitySpec {
	/** Higher wins the compact slot; the runner-up gets the bubble. */
	priority: number;
	/** Identity colour: tints the island's hairline. */
	tint?: string;
	leading: HTMLElement;
	trailing: HTMLElement;
	minimal: HTMLElement;
	/** What a hover says this is (and what a click would open). */
	label?: () => string;
	expanded?: HTMLElement;
	/** Width of the expanded card; its height is measured. */
	expandedWidth?: number;
	/** Click on the compact view when there's no expanded card. */
	onTap?: () => void;
	/** Called once a second while registered. */
	tick?: () => void;
}

interface IslandAlert {
	/** Material Symbols name. */
	icon?: string;
	/** Image URL shown instead of the icon. */
	image?: string;
	title: string;
	body?: string;
	tone?: "red" | "green" | "amber" | "accent";
	ms?: number;
	actions?: Array<{ label: string; primary?: boolean; run: () => void }>;
	onTap?: () => void;
	/** Stays until an action is chosen (AI approvals). */
	sticky?: boolean;
	/** Called once it's gone, however it went. */
	onDone?: () => void;
}

type IslandView = "rest" | "compact" | "expanded" | "alert" | "hud";

const isl = (tag: string, cls = "", html = ""): HTMLElement => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = html;
	return e;
};
const islIcon = (name: string, cls = "") =>
	isl("span", "material-symbols-outlined " + cls, name);

class AetherIsland {
	static readonly REST = { w: 112, h: 30 };
	static readonly COMPACT_H = 34;
	/** The empty middle of a compact view: where the camera is on a phone. */
	static readonly MIDDLE = 40;

	static #root: HTMLElement | null = null;
	static #face: HTMLElement = document.createElement("div");
	static #bubbleFace: HTMLElement = document.createElement("div");
	static #measure: HTMLElement = document.createElement("div");

	static #activities = new Map<string, IslandActivitySpec>();
	static #view: IslandView = "rest";
	static #expandedId: string | null = null;
	static #shownLayer: HTMLElement | null = null;
	static #shownKey = "";
	static #bubbleKey = "";
	static #peek = false;
	static #size = { w: 112, h: 30 };
	static #tick = 0;
	static #leaveTimer = 0;
	static #hoverTimer = 0;
	static #gooTimer = 0;

	static #alerts: IslandAlert[] = [];
	static #alert: IslandAlert | null = null;
	static #alertSeq = 0;
	static #alertTimer = 0;
	static #hud: {
		icon: string;
		level: number;
		label: string;
		tone: string;
	} | null = null;
	static #hudTimer = 0;

	static #springOpen = {
		easing: "cubic-bezier(0.34, 1.2, 0.5, 1)",
		duration: 520,
	};
	static #springClose = {
		easing: "cubic-bezier(0.3, 0.8, 0.3, 1)",
		duration: 420,
	};

	/* ---- public API ----------------------------------------------------- */

	/** On screen (it's hidden on narrow screens). */
	static get present(): boolean {
		return !!this.#root && getComputedStyle(this.#root).display !== "none";
	}

	/** Add or replace an activity. */
	static set(id: string, spec: IslandActivitySpec) {
		this.#activities.set(id, spec);
		this.#render();
	}

	static clear(id: string) {
		if (!this.#activities.delete(id)) return;
		if (this.#expandedId === id) {
			this.#expandedId = null;
			if (this.#view === "expanded") this.#view = "rest";
		}
		this.#render();
	}

	static has(id: string) {
		return this.#activities.has(id);
	}

	/** Open the expanded view: an activity's card, or the dashboard. */
	static expand(id?: string) {
		const want = id ?? this.#top()[0]?.[0];
		this.#expandedId =
			want && this.#activities.get(want)?.expanded ? want : "dashboard";
		this.#view = "expanded";
		this.#peek = false;
		this.#render();
	}

	static collapse() {
		if (this.#view !== "expanded") return;
		this.#view = "rest";
		this.#expandedId = null;
		this.#render();
	}

	/**
	 * Burst an alert out of the island. They queue; each stays a few seconds
	 * (longer for more text), or until an action is chosen when `sticky`.
	 */
	static alert(a: IslandAlert) {
		if (!this.#root) return;
		this.#alerts.push(a);
		if (!this.#alert) this.#nextAlert();
	}

	/** Dismiss the current alert, sticky ones included. */
	static dismissAlert() {
		const a = this.#alert;
		clearTimeout(this.#alertTimer);
		this.#alert = null;
		a?.onDone?.();
		this.#nextAlert();
	}

	/**
	 * Flash a level: `icon` is a Material Symbols name, `level` 0..1. A
	 * `label` shows beside the bar; `tone` ("green", "red") tints it.
	 */
	static hud(
		icon: string,
		level: number,
		opts: { label?: string; tone?: string; ms?: number } = {},
	) {
		if (!this.#root) return;
		this.#hud = {
			icon,
			level: Math.max(0, Math.min(1, level)),
			label: opts.label || "",
			tone: opts.tone || "",
		};
		clearTimeout(this.#hudTimer);
		this.#hudTimer = window.setTimeout(() => {
			this.#hud = null;
			this.#render();
		}, opts.ms ?? 1400);
		this.#render();
	}

	/** A built-in source changed (music, timer, recording). */
	static refresh() {
		this.#syncBuiltins();
		this.#render();
	}

	/* ---- what to show -------------------------------------------------- */

	static #top(): Array<[string, IslandActivitySpec]> {
		return [...this.#activities.entries()].sort(
			(a, b) => b[1].priority - a[1].priority,
		);
	}

	static #currentView(): IslandView {
		if (this.#alert) return "alert";
		if (this.#hud) return "hud";
		if (this.#view === "expanded") return "expanded";
		return this.#activities.size ? "compact" : "rest";
	}

	/* ---- rendering ------------------------------------------------------ */

	static #render() {
		const root = this.#root;
		if (!root) return;
		const view = this.#currentView();
		const [first, second] = this.#top();
		const maxW = Math.max(240, innerWidth - 24);

		let key: string = view;
		let build: () => HTMLElement;
		let tint = "";
		let card = 0; // > 0: a card this wide, its height measured
		let size = { w: this.REST.w, h: this.REST.h };

		if (view === "alert") {
			const a = this.#alert!;
			key = "alert:" + (a as any).__seq;
			build = () => this.#alertLayer(a);
			card = Math.min(372, maxW);
			tint = this.#toneColor(a.tone);
		} else if (view === "hud") {
			const h = this.#hud!;
			build = () => this.#hudLayer();
			size = { w: Math.min(h.label ? 300 : 260, maxW), h: this.COMPACT_H };
			tint = this.#toneColor(h.tone);
		} else if (view === "expanded") {
			const id = this.#expandedId || "dashboard";
			const spec = this.#activities.get(id);
			key = "expanded:" + id;
			if (spec?.expanded) {
				const node = spec.expanded;
				build = () => {
					const l = isl("div", "isl-layer isl-card");
					l.append(node);
					return l;
				};
				card = Math.min(spec.expandedWidth ?? 372, maxW);
				tint = spec.tint || "";
			} else {
				key = "expanded:dashboard";
				build = () => this.#dashboard();
				card = Math.min(372, maxW);
			}
		} else if (view === "compact" && first) {
			const [id, spec] = first;
			key = "compact:" + id;
			build = () => this.#compactLayer(spec);
			tint = spec.tint || "";
			const pad = 11;
			const side = Math.max(
				this.#measureWidth(spec.leading),
				this.#measureWidth(spec.trailing),
			);
			// Symmetric sides, like the cutout in the middle of a phone's.
			let w = pad * 2 + side * 2 + this.MIDDLE;
			let h = this.COMPACT_H;
			if (this.#peek) {
				const label = spec.label?.() || "";
				const lw = label ? Math.min(180, this.#measureText(label)) + 24 : 0;
				w = Math.max(w + 16, pad * 2 + side * 2 + lw);
				h += 4;
			}
			size = { w: Math.min(Math.max(w, this.REST.w + 16), maxW), h };
		} else {
			key = "rest";
			build = () => this.#restLayer();
			if (this.#peek) {
				const lw = this.#measureText(this.#restLabel()) + 34;
				size = { w: Math.max(this.REST.w + 18, lw), h: this.REST.h + 4 };
			}
		}

		if (key !== this.#shownKey) this.#swap(build(), key);
		const layer = this.#shownLayer!;
		if (view === "hud") this.#paintHud(layer);
		if (view === "compact" && first) {
			const label = layer.querySelector(".isl-label");
			if (label) label.textContent = first[1].label?.() || "";
		}
		if (key === "rest") {
			layer.querySelector(".isl-label")!.textContent = this.#restLabel();
		}
		if (card) {
			layer.style.width = card + "px";
			size = { w: card, h: Math.max(this.COMPACT_H, layer.offsetHeight) };
		}

		root.classList.toggle("is-peek", this.#peek);
		root.dataset.view = view;
		root.style.setProperty("--isl-tint", tint || "rgba(255, 255, 255, 0.075)");
		this.#applySize(size, card ? 30 : size.h / 2);

		// The runner-up rides in the bubble, but only beside a compact view.
		const bubble = view === "compact" && second ? second : null;
		this.#setBubble(bubble ? bubble[0] : "", bubble ? bubble[1] : null);

		this.#startTick();
	}

	static #applySize(s: { w: number; h: number }, r: number) {
		const prev = this.#size;
		const growing = s.w * s.h > prev.w * prev.h + 1;
		const spring = growing ? this.#springOpen : this.#springClose;
		const st = this.#root!.style;
		st.setProperty("--isl-ease", spring.easing);
		st.setProperty("--isl-dur", spring.duration + "ms");
		st.setProperty("--isl-w", s.w + "px");
		st.setProperty("--isl-h", s.h + "px");
		st.setProperty("--isl-r", r + "px");
		this.#size = s;
	}

	/**
	 * Replace the content: the old layer shrinks and fades fast while the new
	 * one grows in just behind it on a spring, a little blurred until it lands
	 * (the content transition Apple uses inside the island).
	 */
	static #swap(layer: HTMLElement, key: string) {
		const old = this.#shownLayer;
		this.#shownKey = key;
		this.#shownLayer = layer;
		const reduced = (globalThis as any).AetherMotion?.reduced;
		if (old) {
			old.classList.add("is-leaving");
			if (reduced) old.remove();
			else
				old
					.animate(
						[
							{ opacity: 1, scale: "1", filter: "blur(0px)" },
							{ opacity: 0, scale: "0.92", filter: "blur(3px)" },
						],
						{
							duration: 130,
							easing: "cubic-bezier(0.4, 0, 1, 1)",
							fill: "forwards",
						},
					)
					.finished.then(
						() => old.remove(),
						() => old.remove(),
					);
		}
		this.#face.append(layer);
		if (reduced) return;
		const spring = (globalThis as any).AetherMotion?.spring(0.4, 0.86) || {
			easing: "ease-out",
			duration: 380,
		};
		layer.animate(
			[
				{ opacity: 0, scale: "0.94", filter: "blur(4px)" },
				{ opacity: 1, scale: "1", filter: "blur(0px)" },
			],
			{
				duration: spring.duration,
				delay: old ? 60 : 0,
				easing: spring.easing,
				fill: "backwards",
			},
		);
	}

	/**
	 * The detached bubble. Changing it runs the goo filter for the length of
	 * the split, so it pulls away from the pill like a drop of liquid (or is
	 * absorbed back into it), then takes the filter off again.
	 */
	static #setBubble(key: string, spec: IslandActivitySpec | null) {
		if (key === this.#bubbleKey) return;
		const root = this.#root!;
		const was = this.#bubbleKey;
		this.#bubbleKey = key;
		if (!(globalThis as any).AetherMotion?.reduced && !!was !== !!key) {
			root.classList.add("is-goo");
			clearTimeout(this.#gooTimer);
			this.#gooTimer = window.setTimeout(
				() => root.classList.remove("is-goo"),
				760,
			);
		}
		if (spec) {
			this.#bubbleFace.replaceChildren(spec.minimal);
			root.classList.add("has-bubble");
		} else {
			root.classList.remove("has-bubble");
			// Its content goes once it's been absorbed.
			setTimeout(() => {
				if (!this.#bubbleKey) this.#bubbleFace.replaceChildren();
			}, 300);
		}
	}

	static #measureWidth(el: HTMLElement): number {
		const clone = el.cloneNode(true) as HTMLElement;
		this.#measure.replaceChildren(clone);
		const w = Math.ceil(clone.getBoundingClientRect().width);
		this.#measure.replaceChildren();
		return w;
	}

	static #measureText(text: string): number {
		const s = isl("span", "isl-label");
		s.textContent = text;
		return this.#measureWidth(s);
	}

	static #startTick() {
		clearInterval(this.#tick);
		const ticking = [...this.#activities.values()].some((a) => a.tick);
		const dash = this.#shownKey === "expanded:dashboard";
		if (!ticking && !dash) return;
		this.#tick = window.setInterval(() => {
			for (const a of this.#activities.values()) a.tick?.();
			if (this.#shownKey === "expanded:dashboard") this.#paintDashboard();
		}, 1000);
	}

	static #toneColor(tone?: string) {
		switch (tone) {
			case "red":
				return "rgba(255, 69, 58, 0.5)";
			case "green":
				return "rgba(48, 209, 88, 0.45)";
			case "amber":
				return "rgba(255, 159, 10, 0.45)";
			case "accent":
				return "color-mix(in oklab, var(--theme-accent) 55%, transparent)";
			default:
				return "";
		}
	}

	static #hour12() {
		try {
			return !anura.settings.get("sir-yes-sir");
		} catch {
			return true;
		}
	}

	static #clockText(d = new Date()) {
		return d.toLocaleTimeString(navigator.language, {
			hour: "numeric",
			minute: "2-digit",
			hour12: this.#hour12(),
		});
	}

	/* ---- layers ------------------------------------------------------- */

	static #restLabel() {
		return this.#clockText();
	}

	static #restLayer(): HTMLElement {
		const l = isl("div", "isl-layer isl-rest");
		l.append(isl("span", "isl-label"));
		return l;
	}

	static #compactLayer(spec: IslandActivitySpec): HTMLElement {
		const l = isl("div", "isl-layer isl-compact");
		const lead = isl("div", "isl-lead");
		const trail = isl("div", "isl-trail");
		lead.append(spec.leading);
		trail.append(spec.trailing);
		l.append(lead, isl("span", "isl-label"), trail);
		return l;
	}

	static #hudLayer(): HTMLElement {
		const l = isl("div", "isl-layer isl-hud");
		l.append(
			islIcon("", "isl-hud-icon"),
			isl("span", "isl-level", '<span class="isl-level-fill"></span>'),
			isl("span", "isl-hud-label"),
		);
		return l;
	}

	static #paintHud(layer: HTMLElement) {
		const h = this.#hud;
		if (!h) return;
		layer.querySelector(".isl-hud-icon")!.textContent = h.icon;
		layer.dataset.tone = h.tone;
		layer.querySelector(".isl-hud-label")!.textContent = h.label;
		(layer.querySelector(".isl-level-fill") as HTMLElement).style.scale =
			h.level + " 1";
	}

	static #alertLayer(a: IslandAlert): HTMLElement {
		const l = isl("div", "isl-layer isl-card isl-alert");
		if (a.tone) l.dataset.tone = a.tone;
		const art = isl("div", "isl-alert-art");
		if (a.image) {
			const img = document.createElement("img");
			img.src = a.image;
			img.alt = "";
			art.append(img);
		} else art.append(islIcon(a.icon || "notifications"));
		const text = isl("div", "isl-alert-text");
		const title = isl("div", "isl-alert-title");
		title.textContent = a.title;
		text.append(title);
		if (a.body) {
			const body = isl("div", "isl-alert-body");
			body.textContent = a.body;
			text.append(body);
		}
		l.append(art, text);
		if (a.actions?.length) {
			const row = isl("div", "isl-actions");
			for (const act of a.actions) {
				const b = isl("button", "isl-btn" + (act.primary ? " is-primary" : ""));
				b.textContent = act.label;
				b.addEventListener("click", (e) => {
					e.stopPropagation();
					if (this.#alert !== a) return;
					this.dismissAlert();
					act.run();
				});
				row.append(b);
			}
			l.append(row);
		}
		return l;
	}

	static #dashboard(): HTMLElement {
		const l = isl("div", "isl-layer isl-card isl-dash");
		const head = isl("div", "isl-dash-head");
		head.append(isl("div", "isl-dash-time"), isl("div", "isl-dash-date"));
		const actions = isl("div", "isl-dash-actions");
		const act = (icon: string, label: string, run: () => void, cls = "") => {
			const b = isl("button", "isl-dash-btn " + cls);
			b.append(islIcon(icon), isl("span", "", label));
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				this.collapse();
				run();
			});
			actions.append(b);
		};
		const g = globalThis as any;
		act("auto_awesome", "Ask AI", () => g.DimensionAI?.summon(), "is-ai");
		act(
			g.AetherDND?.on ? "do_not_disturb_on" : "bedtime",
			g.AetherDND?.on ? "Focus is on" : "Focus",
			() => g.AetherDND?.toggle(),
			g.AetherDND?.on ? "is-on" : "",
		);
		act("screenshot_region", "Capture", () =>
			setTimeout(() => g.AetherScreenshot?.captureRegion(), 280),
		);
		act("terminal", "Terminal", () => anura.apps["anura.ashell"]?.open());
		act("lock", "Lock", () => g.AetherLockScreen?.lock());
		l.append(head, actions);
		this.#paintDashboard(l);
		return l;
	}

	static #paintDashboard(l = this.#shownLayer) {
		if (!l) return;
		const now = new Date();
		const t = l.querySelector(".isl-dash-time");
		const d = l.querySelector(".isl-dash-date");
		if (t) t.textContent = this.#clockText(now);
		if (d)
			d.textContent = now.toLocaleDateString(navigator.language, {
				weekday: "long",
				month: "long",
				day: "numeric",
			});
	}

	static #nextAlert() {
		clearTimeout(this.#alertTimer);
		const a = this.#alerts.shift() || null;
		if (a) (a as any).__seq = ++this.#alertSeq;
		this.#alert = a;
		this.#render();
		if (a && !a.sticky) this.#armAlert(a);
	}

	static #armAlert(a: IslandAlert, ms?: number) {
		clearTimeout(this.#alertTimer);
		const words = (a.title + " " + (a.body || "")).split(/\s+/).length;
		this.#alertTimer = window.setTimeout(
			() => {
				if (this.#alert === a) this.dismissAlert();
			},
			ms ?? a.ms ?? Math.min(9000, 3000 + words * 170),
		);
	}

	/* ---- built-in activities ------------------------------------------- */

	static #music = {
		art: Object.assign(document.createElement("img"), {
			className: "isl-art",
			alt: "",
		}),
		eq: isl("span", "isl-eq", "<i></i><i></i><i></i><i></i>"),
		mini: Object.assign(document.createElement("img"), {
			className: "isl-art isl-art-mini",
			alt: "",
		}),
		card: null as HTMLElement | null,
		grace: 0,
		graceTimer: 0,
	};

	static #musicCard(): HTMLElement {
		if (this.#music.card) return this.#music.card;
		const card = isl(
			"div",
			"isl-music",
			`<img class="isl-music-art" alt="" />
			<div class="isl-music-meta"><div class="isl-music-title"></div><div class="isl-music-artist"></div></div>
			<span class="isl-eq isl-eq-lg"><i></i><i></i><i></i><i></i></span>
			<div class="isl-scrub"><span class="isl-scrub-t0"></span><div class="isl-scrub-bar"><div class="isl-scrub-fill"></div></div><span class="isl-scrub-t1"></span></div>
			<div class="isl-music-controls">
				<button data-a="prev" title="Previous">${aetherMediaIcon("prev")}</button>
				<button data-a="toggle" class="isl-play" title="Play">${aetherMediaIcon("play")}</button>
				<button data-a="next" title="Next">${aetherMediaIcon("next")}</button>
			</div>`,
		);
		card.addEventListener("click", (e) => {
			e.stopPropagation();
			const b = (e.target as Element).closest<HTMLElement>("button[data-a]");
			if (!b) {
				// Anywhere else on the card: open the full player.
				anura.apps["anura.music"]?.open();
				this.collapse();
				return;
			}
			const a = b.dataset.a;
			if (a === "prev") AetherMusic.prev();
			else if (a === "next") AetherMusic.next();
			else AetherMusic.toggle();
		});
		this.#music.card = card;
		return card;
	}

	static #paintMusic() {
		const m = AetherMusic;
		const t = m.current;
		if (!t) return;
		const mm = this.#music;
		for (const img of [mm.art, mm.mini])
			if (img.getAttribute("src") !== t.art) img.src = t.art;
		this.#root?.classList.toggle("is-playing", !!m.playing);
		const card = mm.card;
		if (!card) return;
		const img = card.querySelector<HTMLImageElement>(".isl-music-art")!;
		if (img.getAttribute("src") !== t.art) img.src = t.art;
		card.querySelector(".isl-music-title")!.textContent = t.title;
		card.querySelector(".isl-music-artist")!.textContent = t.artist;
		const play = card.querySelector<HTMLElement>(".isl-play")!;
		const want = m.playing ? "pause" : "play";
		if (play.dataset.icon !== want) {
			play.dataset.icon = want;
			play.innerHTML = aetherMediaIcon(want);
			play.title = m.playing ? "Pause" : "Play";
		}
		this.#paintScrub();
	}

	static #paintScrub() {
		const card = this.#music.card;
		if (!card || !card.isConnected) return;
		const d = AetherMusic.duration || 0;
		const t = AetherMusic.time || 0;
		(card.querySelector(".isl-scrub-fill") as HTMLElement).style.scale =
			(d ? Math.min(1, t / d) : 0) + " 1";
		card.querySelector(".isl-scrub-t0")!.textContent = aetherFormatTime(t);
		card.querySelector(".isl-scrub-t1")!.textContent =
			"-" + aetherFormatTime(Math.max(0, d - t));
	}

	static #timer = {
		icon: islIcon("timer", "isl-ico isl-amber"),
		time: isl("span", "isl-time isl-amber"),
		mini: islIcon("timer", "isl-ico isl-amber"),
		card: null as HTMLElement | null,
	};

	static #timerCard(): HTMLElement {
		if (this.#timer.card) return this.#timer.card;
		const card = isl(
			"div",
			"isl-timer",
			`<div class="isl-timer-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="isl-ring-bg"/><circle cx="22" cy="22" r="19" class="isl-ring-fg" pathLength="100"/></svg><span class="material-symbols-outlined">timer</span></div>
			<div class="isl-timer-meta"><div class="isl-timer-label">Timer</div><div class="isl-timer-big"></div></div>
			<div class="isl-timer-controls">
				<button data-a="toggle" class="isl-round is-amber" title="Pause"><span class="material-symbols-outlined">pause</span></button>
				<button data-a="cancel" class="isl-round" title="Cancel"><span class="material-symbols-outlined">close</span></button>
			</div>`,
		);
		card.addEventListener("click", (e) => {
			e.stopPropagation();
			const clock = anura.apps["anura.clock"] as any;
			const b = (e.target as Element).closest<HTMLElement>("button[data-a]");
			if (!b) {
				clock?.open(["timer"]);
				this.collapse();
				return;
			}
			if (b.dataset.a === "cancel") clock?.cancelTimer();
			else if (clock?.timer.running) clock.pauseTimer();
			else clock?.resumeTimer();
		});
		this.#timer.card = card;
		return card;
	}

	static #rec = {
		dot: isl("span", "isl-rec-dot"),
		time: isl("span", "isl-time isl-red"),
		mini: isl("span", "isl-rec-dot"),
	};

	/** Keep the built-in activities in step with their sources. */
	static #syncBuiltins() {
		const shot = (globalThis as any).AetherScreenshot;
		if (shot?.recording) {
			if (!this.#activities.has("rec"))
				this.#activities.set("rec", {
					priority: 30,
					tint: "rgba(255, 69, 58, 0.45)",
					leading: this.#rec.dot,
					trailing: this.#rec.time,
					minimal: this.#rec.mini,
					label: () => "Stop recording",
					onTap: () => shot.stopRecording(),
					tick: () => this.#paintRec(),
				});
			this.#paintRec();
		} else this.#activities.delete("rec");

		const clock = anura.apps["anura.clock"] as any;
		if (clock?.timer?.active) {
			if (!this.#activities.has("timer"))
				this.#activities.set("timer", {
					priority: 20,
					tint: "rgba(255, 159, 10, 0.4)",
					leading: this.#timer.icon,
					trailing: this.#timer.time,
					minimal: this.#timer.mini,
					label: () => (clock.timer.running ? "Timer" : "Paused"),
					expanded: this.#timerCard(),
					expandedWidth: 340,
					tick: () => this.#paintTimer(),
				});
			this.#paintTimer();
		} else this.#activities.delete("timer");

		const m = (globalThis as any).AetherMusic;
		if (m?.current && (m.playing || Date.now() < this.#music.grace)) {
			if (!this.#activities.has("music"))
				this.#activities.set("music", {
					priority: 10,
					tint: "color-mix(in oklab, var(--theme-accent) 40%, transparent)",
					leading: this.#music.art,
					trailing: this.#music.eq,
					minimal: this.#music.mini,
					label: () => m.current?.title || "Music",
					expanded: this.#musicCard(),
					expandedWidth: 372,
				});
			this.#paintMusic();
		} else this.#activities.delete("music");

		for (const id of ["rec", "timer", "music"])
			if (!this.#activities.has(id) && this.#expandedId === id) {
				this.#expandedId = null;
				this.#view = "rest";
			}
	}

	static #paintRec() {
		const start = (globalThis as any).AetherScreenshot?.recordingStart || 0;
		if (start)
			this.#rec.time.textContent = aetherFormatTime(
				(Date.now() - start) / 1000,
			);
	}

	static #paintTimer() {
		const tm = (anura.apps["anura.clock"] as any)?.timer;
		if (!tm?.active) return;
		const ms = tm.running ? Math.max(0, tm.endsAt - Date.now()) : tm.remaining;
		const text = ClockApp.formatRemaining(ms);
		this.#timer.time.textContent = text;
		this.#root?.classList.toggle("timer-paused", !tm.running);
		const card = this.#timer.card;
		if (!card) return;
		card.querySelector(".isl-timer-big")!.textContent = text;
		card.querySelector(".isl-timer-label")!.textContent = tm.running
			? "Timer"
			: "Paused";
		const frac = tm.total ? Math.max(0, Math.min(1, ms / tm.total)) : 0;
		(card.querySelector(".isl-ring-fg") as SVGElement).style.strokeDashoffset =
			String(100 - frac * 100);
		const btn = card.querySelector<HTMLElement>('[data-a="toggle"]')!;
		const icon = tm.running ? "pause" : "play_arrow";
		if (btn.textContent !== icon) {
			btn.firstElementChild!.textContent = icon;
			btn.title = tm.running ? "Pause" : "Resume";
		}
	}

	/* ---- boot ----------------------------------------------------------- */

	static init() {
		if (this.#root) return;
		const motion = (globalThis as any).AetherMotion;
		if (motion?.supportsLinear) {
			// ~3% overshoot growing; critically damped and a touch quicker
			// going back, so it never wobbles on the way home.
			this.#springOpen = motion.spring(0.5, 0.74);
			this.#springClose = motion.spring(0.4, 1);
		}

		const root = isl("div");
		root.id = "island";
		root.dataset.view = "rest";
		root.setAttribute("role", "status");
		this.#root = root;

		root.innerHTML =
			'<svg class="isl-defs" width="0" height="0" aria-hidden="true"><filter id="isl-goo" x="-60%" y="-60%" width="320%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="5"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11"/></filter></svg>' +
			'<div class="isl-goo"><div class="isl-body"></div><div class="isl-bubble"></div></div>' +
			'<div class="isl-edge"></div><div class="isl-bubble-edge"></div>';
		this.#face = isl("div", "isl-face");
		this.#bubbleFace = isl("div", "isl-bubble-face");
		this.#measure = isl("div", "isl-measure");
		root.append(this.#face, this.#bubbleFace, this.#measure);
		document.body.appendChild(root);
		this.#swap(this.#restLayer(), "rest");
		this.#applySize(this.REST, this.REST.h / 2);

		this.#bindPointer(root);

		addEventListener("keydown", (e) => {
			if (e.key !== "Escape") return;
			if (this.#alert && !this.#alert.sticky) this.dismissAlert();
			else if (this.#view === "expanded") this.collapse();
		});
		document.addEventListener(
			"pointerdown",
			(e) => {
				if (this.#view === "expanded" && !root.contains(e.target as Node))
					this.collapse();
			},
			true,
		);
		addEventListener("resize", () => this.#render());

		const music = (globalThis as any).AetherMusic;
		if (music) {
			music.events.addEventListener("track", () => this.refresh());
			music.events.addEventListener("state", () => {
				// Hold the activity a little after a pause, then let it go.
				clearTimeout(this.#music.graceTimer);
				if (!music.playing) {
					this.#music.grace = Date.now() + 6000;
					this.#music.graceTimer = window.setTimeout(
						() => this.refresh(),
						6100,
					);
				}
				this.refresh();
			});
			music.events.addEventListener("time", () => this.#paintScrub());
		}
		(globalThis as any).AetherVolume?.addEventListener?.("change", () => {
			const v = (globalThis as any).aetherSound?.volume ?? 0;
			this.hud(
				v <= 0 ? "volume_off" : v < 0.5 ? "volume_down" : "volume_up",
				v,
			);
		});
		this.refresh();
	}

	static #bindPointer(root: HTMLElement) {
		// Hover: after a short dwell (so passing through doesn't set it off)
		// it grows a little toward where a click would take it.
		root.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			clearTimeout(this.#leaveTimer);
			clearTimeout(this.#hoverTimer);
			this.#hoverTimer = window.setTimeout(() => {
				this.#peek = true;
				this.#render();
			}, 90);
			// Reading an alert holds it.
			if (this.#alert && !this.#alert.sticky) clearTimeout(this.#alertTimer);
		});
		root.addEventListener("pointerleave", () => {
			clearTimeout(this.#hoverTimer);
			if (this.#peek) {
				this.#peek = false;
				this.#render();
			}
			if (this.#view === "expanded")
				this.#leaveTimer = window.setTimeout(() => this.collapse(), 900);
			if (this.#alert && !this.#alert.sticky) this.#armAlert(this.#alert, 1600);
		});

		// A press gives a little, like pressing something soft. Dragging an
		// alert upward flicks it back into the island.
		let downY = -1;
		root.addEventListener("pointerdown", (e) => {
			root.classList.add("is-pressed");
			downY = e.clientY;
		});
		root.addEventListener("pointermove", (e) => {
			if (downY < 0 || !this.#alert || this.#alert.sticky) return;
			if (e.clientY - downY < -16) {
				downY = -1;
				root.classList.remove("is-pressed");
				this.dismissAlert();
			}
		});
		addEventListener("pointerup", () => {
			downY = -1;
			root.classList.remove("is-pressed");
		});

		root.addEventListener("click", (e) => {
			if ((e.target as Element).closest("button")) return;
			const view = this.#currentView();
			if (view === "alert") {
				const a = this.#alert!;
				if (a.sticky) return;
				this.dismissAlert();
				a.onTap?.();
				return;
			}
			if (view === "expanded" || view === "hud") return;
			const top = this.#top()[0];
			if (view === "compact" && top && !top[1].expanded && top[1].onTap) {
				top[1].onTap();
				return;
			}
			this.expand(top?.[0]);
		});
		this.#bubbleFace.addEventListener("click", (e) => {
			e.stopPropagation();
			const second = this.#top()[1];
			if (!second) return;
			if (second[1].expanded) this.expand(second[0]);
			else second[1].onTap?.();
		});
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherIsland = AetherIsland;
