/**
 * Aether — Setup Assistant
 * ---------------------------------------------------------------------------
 * The first thing anyone sees. A "hello" that cycles through languages, then
 * a short run of questions on a glass card over a slowly drifting aurora:
 *
 *   region      12/24-hour clock, °C/°F
 *   profile     name and avatar (shown on the lock screen)
 *   appearance  accent colour and wallpaper, previewed live behind the card
 *   desktop     which widgets start on the desktop
 *   feel        sounds, animation, glass, cursor, Night Shift, applied live
 *   privacy     passcode, auto-lock, screen saver
 *   browsing    proxy server (tested live) and search engine
 *   features    offline support, Linux, the OPFS driver
 *   installing  only when something needs downloading
 *   done        a few shortcuts worth knowing
 *
 * Then the card lifts away and the desktop blooms in behind it, the same
 * entrance as an unlock (Motion.ts).
 *
 * Built with plain DOM rather than dreamland state: every screen is built
 * when it's entered and thrown away when it's left, and the transitions
 * need direct hold of the elements anyway. All motion is transform/opacity
 * through WAAPI, on the same springs as the rest of the shell.
 */

type OobeKid = Node | string | null | undefined | false;

function oobeEl<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: {
		class?: string;
		text?: string;
		html?: string;
		style?: Partial<CSSStyleDeclaration> | Record<string, string>;
		on?: { [type: string]: (e: any) => void };
		attrs?: Record<string, string>;
	} = {},
	...kids: OobeKid[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (props.class) el.className = props.class;
	if (props.text !== undefined) el.textContent = props.text;
	if (props.html !== undefined) el.innerHTML = props.html;
	if (props.style)
		for (const [k, v] of Object.entries(props.style)) {
			// Custom properties only go through setProperty.
			if (k.startsWith("--")) el.style.setProperty(k, String(v));
			else (el.style as any)[k] = v;
		}
	if (props.attrs)
		for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
	if (props.on)
		for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn);
	for (const k of kids) if (k || k === "") el.append(k as Node | string);
	return el;
}

const oobeIcon = (name: string, cls = "") =>
	oobeEl("span", { class: "material-symbols-outlined " + cls, text: name });

const OOBE_GREETINGS = [
	"hello",
	"hola",
	"bonjour",
	"xin chào",
	"こんにちは",
	"ciao",
	"hallo",
	"olá",
	"안녕하세요",
	"привет",
	"你好",
	"merhaba",
	"hej",
	"namaste",
];

const OOBE_ACCENTS: Array<[string, string]> = [
	["#7A6CFF", "Aether"],
	["#3B82F6", "Blue"],
	["#06B6D4", "Cyan"],
	["#22C55E", "Green"],
	["#EAB308", "Yellow"],
	["#F97316", "Orange"],
	["#EF4444", "Red"],
	["#EC4899", "Pink"],
	["#8E8E93", "Graphite"],
];

const OOBE_WALLPAPERS: Array<[string, string]> = [
	["Aether", "/assets/wallpaper/bundled_wallpapers/Aether.svg"],
	["Aether Dusk", "/assets/wallpaper/bundled_wallpapers/Aether Dusk.svg"],
	["Nocturne", "/assets/wallpaper/bundled_wallpapers/Nocturne.jpg"],
	["Blues", "/assets/wallpaper/bundled_wallpapers/Blues Dark.png"],
	["Earth", "/assets/wallpaper/bundled_wallpapers/Earth Light.jpg"],
	["Fire", "/assets/wallpaper/bundled_wallpapers/Fire Dark.jpg"],
	["Water", "/assets/wallpaper/bundled_wallpapers/Water Dark.jpg"],
	["Wind", "/assets/wallpaper/bundled_wallpapers/Wind Light.jpg"],
];

const OOBE_WIDGETS: Array<[string, string, string, string]> = [
	["clock", "schedule", "Clock", "The time, at a glance"],
	["weather", "partly_cloudy_day", "Weather", "Today and the next few days"],
	["calendar", "calendar_month", "Calendar", "This month"],
	["nowplaying", "music_note", "Now Playing", "What's playing in Music"],
	["system", "monitoring", "System", "Memory, storage and frame rate"],
	["worldclock", "public", "World Clock", "Other time zones"],
];

const OOBE_SEARCH: Array<[string, string]> = [
	["Google", "https://www.google.com/search?q="],
	["DuckDuckGo", "https://duckduckgo.com/?q="],
	["Bing", "https://www.bing.com/search?q="],
	["Brave", "https://search.brave.com/search?q="],
	["Startpage", "https://www.startpage.com/do/search?q="],
];

interface OobeStep {
	id: string;
	/** Short name, for the progress bar's tooltip. */
	label: string;
	icon: string;
	title: () => string;
	subtitle: () => string;
	body: () => HTMLElement;
	next?: () => string;
	/** Continue is disabled while this returns false. */
	valid?: () => boolean;
	/** Runs on Continue, before moving on. */
	commit?: () => void | Promise<void>;
	/** Runs once the screen is on stage. */
	enter?: () => void;
	skip?: () => boolean;
}

interface OobeProbe {
	state: "idle" | "testing" | "ok" | "fail";
	ms?: number;
	reason?: string;
}

class OobeView {
	#el: HTMLElement | null = null;
	#card!: HTMLElement;
	#stage!: HTMLElement;
	#pills!: HTMLElement;
	#back!: HTMLButtonElement;
	#next!: HTMLButtonElement;
	#wall!: HTMLElement;
	#index = -1;
	#busy = false;
	#helloTimer = 0;
	#theme: Theme | null = null;
	#probes = new Map<string, OobeProbe>();
	/** Running setup again with a passcode set: an empty field keeps it. */
	#hadPin = false;

	/** Everything the questions decide, committed step by step. */
	c = {
		hour24: false,
		imperial: false,
		name: "",
		color: 0,
		emoji: "",
		accent: "#7A6CFF",
		wallpaper: OOBE_WALLPAPERS[0]![1],
		widgets: new Set(["clock", "weather", "calendar"]),
		sounds: true,
		volume: 0.6,
		animations: true,
		glass: true,
		cursor: true,
		nightShift: false,
		pin: "",
		pin2: "",
		autoLock: 0,
		saver: 10,
		wisp: "",
		customWisp: "",
		search: OOBE_SEARCH[0]![1],
		offline: true,
		linux: false,
		opfs: false,
	};

	constructor() {
		// Constructed on every boot, used only on the first: nothing here may
		// touch the DOM or settings. `element` builds on first use.
		try {
			const hc = new Intl.DateTimeFormat(undefined, {
				hour: "numeric",
			}).resolvedOptions().hourCycle;
			this.c.hour24 = hc === "h23" || hc === "h24";
			this.c.imperial = /^en-US$|^en$/i.test(navigator.language || "");
		} catch {
			/* keep the defaults */
		}
	}

	get element(): HTMLElement {
		return (this.#el ||= this.#build());
	}

	/* ---- frame ------------------------------------------------------------- */

	/** Start from what's already set, so running setup again changes only
	 *  what you change. On a first run most of this is just the defaults. */
	#prefill() {
		const s = anura.settings;
		const has = (k: string) => s.get(k) !== undefined && s.get(k) !== null;
		const prof = AetherProfile.get();
		this.c.name = prof.name;
		this.c.color = prof.color;
		this.c.emoji = prof.emoji;
		const accent = s.get("theme")?.accent;
		if (typeof accent === "string") this.c.accent = accent;
		if (s.get("wallpaper")) this.c.wallpaper = s.get("wallpaper");
		if (has("sir-yes-sir")) this.c.hour24 = !!s.get("sir-yes-sir");
		const units = s.get("aether.widgets.weather.units");
		if (units) this.c.imperial = units === "imperial";
		if (has("disable-animation"))
			this.c.animations = !s.get("disable-animation");
		if (has("blur-disable")) this.c.glass = !s.get("blur-disable");
		if (has("custom-cursor")) this.c.cursor = s.get("custom-cursor") !== false;
		try {
			this.c.sounds = aetherSound.enabled;
			this.c.volume = aetherSound.volume;
			this.c.nightShift = AetherNightShift.config.schedule === "evening";
			this.#hadPin = AetherLockScreen.hasPin;
			const entries = AetherDesktopWidgets.entries;
			if (entries.length) this.c.widgets = new Set(entries.map((e) => e.id));
		} catch {
			/* optional pieces */
		}
		const idle = Number(s.get(AetherLockScreen.IDLE_KEY));
		if (idle) this.c.autoLock = idle;
		if (s.get(AetherScreensaver.MODE_KEY) === "off") this.c.saver = 0;
		else if (Number(s.get(AetherScreensaver.DELAY_KEY)))
			this.c.saver = Number(s.get(AetherScreensaver.DELAY_KEY));
		if (has("use-sw-cache")) this.c.offline = !!s.get("use-sw-cache");
		if (has("x86-disabled")) this.c.linux = !s.get("x86-disabled");
		try {
			const b = JSON.parse(localStorage.getItem("settings") || "{}");
			if (b?.searchEngineUrl) this.c.search = b.searchEngineUrl;
		} catch {
			/* keep Google */
		}
	}

	#build(): HTMLElement {
		try {
			this.#prefill();
		} catch (e) {
			console.warn("[setup] prefill", e);
		}
		try {
			this.c.wisp = anura.settings.get("wisp-url") || OobeView.sameOriginWisp();
			this.#theme = Theme.new(anura.settings.get("theme") || {});
		} catch {
			this.c.wisp = OobeView.sameOriginWisp();
		}

		this.#wall = oobeEl("div", { class: "oobe-wall" });
		const sky = oobeEl(
			"div",
			{ class: "oobe-sky", attrs: { "aria-hidden": "true" } },
			this.#wall,
			oobeEl("div", { class: "oobe-blob b1" }),
			oobeEl("div", { class: "oobe-blob b2" }),
			oobeEl("div", { class: "oobe-blob b3" }),
			oobeEl("div", { class: "oobe-vignette" }),
		);

		this.#pills = oobeEl("div", { class: "oobe-pills" });
		this.#stage = oobeEl("div", { class: "oobe-stage" });
		this.#back = oobeEl(
			"button",
			{
				class: "oobe-btn ghost",
				on: { click: () => this.back() },
				attrs: { type: "button" },
			},
			oobeIcon("arrow_back"),
			"Back",
		);
		this.#next = oobeEl("button", {
			class: "oobe-btn primary",
			on: { click: () => this.forward() },
			attrs: { type: "button" },
		});
		this.#card = oobeEl(
			"div",
			{ class: "oobe-card", attrs: { role: "dialog", "aria-label": "Setup" } },
			oobeEl("div", { class: "oobe-head" }, this.#pills),
			this.#stage,
			oobeEl(
				"div",
				{ class: "oobe-foot" },
				this.#back,
				oobeEl("div", { class: "oobe-foot-gap" }),
				this.#next,
			),
		);

		const root = oobeEl(
			"div",
			{ attrs: { id: "oobe" } },
			sky,
			this.#hello(),
			this.#card,
		);
		this.#applyAccent();
		root.addEventListener("keydown", (e: KeyboardEvent) => this.#onKey(e));
		for (const step of this.#visibleSteps)
			this.#pills.append(
				oobeEl("i", { attrs: { title: step.label } }, oobeEl("b")),
			);
		requestAnimationFrame(() => root.focus());
		root.tabIndex = -1;
		return root;
	}

	/** The steps that count toward progress (installing is a detour). */
	get #visibleSteps(): OobeStep[] {
		return this.steps.filter((s) => s.id !== "installing");
	}

	static sameOriginWisp() {
		return (
			(location.protocol === "https:" ? "wss://" : "ws://") +
			location.host +
			"/"
		);
	}

	#applyAccent() {
		const root = this.#el || this.#card?.parentElement;
		const set = (el: HTMLElement | null | undefined) => {
			if (!el) return;
			el.style.setProperty("--oobe-accent", this.c.accent);
			el.style.setProperty("--theme-accent", this.c.accent);
			el.style.setProperty(
				"--theme-accent-rgb",
				Theme.toRgbTriplet(this.c.accent),
			);
			el.style.setProperty(
				"--matter-theme-rgb",
				Theme.toRgbTriplet(this.c.accent),
			);
		};
		set(root);
		try {
			if (this.#theme) this.#theme.accent = this.c.accent;
		} catch {
			/* live preview only */
		}
	}

	#onKey(e: KeyboardEvent) {
		if (this.#index < 0) {
			if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
			e.preventDefault();
			this.#leaveHello();
			return;
		}
		const t = e.target as HTMLElement;
		if (e.key === "Enter" && !(t instanceof HTMLButtonElement)) {
			e.preventDefault();
			this.forward();
		} else if (e.key === "ArrowLeft" && e.altKey) {
			e.preventDefault();
			this.back();
		}
	}

	#spring(response: number, damping: number) {
		return (
			(globalThis as any).AetherMotion?.spring(response, damping) || {
				easing: "cubic-bezier(0.2, 0.9, 0.25, 1)",
				duration: 500,
			}
		);
	}

	get #reduced(): boolean {
		return !this.c.animations || !!(globalThis as any).AetherMotion?.reduced;
	}

	#click() {
		(globalThis as any).aetherSound?.play?.("click");
	}

	/* ---- hello ------------------------------------------------------------- */

	#hello(): HTMLElement {
		const word = oobeEl("div", {
			class: "hello-word",
			attrs: { "aria-live": "off" },
		});
		const hint = oobeEl(
			"div",
			{ class: "hello-hint" },
			"Press any key or click to begin",
		);
		const hello = oobeEl(
			"div",
			{
				class: "oobe-hello",
				on: { pointerdown: () => this.#leaveHello() },
			},
			oobeEl("div", { class: "hello-glow" }),
			word,
			hint,
			oobeEl("div", { class: "hello-brand", text: BRANDING.name }),
		);
		let i = 0;
		const show = () => {
			if (this.#index >= 0) return;
			this.#sayHello(word, OOBE_GREETINGS[i % OOBE_GREETINGS.length]!);
			i++;
			this.#helloTimer = window.setTimeout(() => {
				this.#byeHello(word).then(show);
			}, 2600);
		};
		// Wait for the splash to lift before the first word.
		setTimeout(show, 1400);
		setTimeout(() => hint.classList.add("is-shown"), 2600);
		return hello;
	}

	#letters(text: string): string[] {
		try {
			const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
			return Array.from(seg.segment(text), (s) => s.segment);
		} catch {
			return Array.from(text);
		}
	}

	#sayHello(word: HTMLElement, text: string) {
		word.replaceChildren();
		const spring = this.#spring(0.7, 0.78);
		this.#letters(text).forEach((ch, i) => {
			const span = oobeEl("span", { text: ch === " " ? " " : ch });
			word.append(span);
			if (this.#reduced) return;
			span.animate(
				[
					{ opacity: 0, translate: "0 0.42em", scale: "0.92" },
					{ opacity: 1, translate: "0 0", scale: "1" },
				],
				{
					duration: spring.duration,
					delay: i * 55,
					easing: spring.easing,
					fill: "backwards",
				},
			);
		});
	}

	#byeHello(word: HTMLElement): Promise<void> {
		const spans = Array.from(word.children) as HTMLElement[];
		if (this.#reduced || !spans.length) return Promise.resolve();
		const anims = spans.map((s, i) =>
			s.animate(
				[
					{ opacity: 1, translate: "0 0" },
					{ opacity: 0, translate: "0 -0.28em" },
				],
				{
					duration: 320,
					delay: i * 28,
					easing: "cubic-bezier(0.4, 0, 1, 1)",
					fill: "forwards",
				},
			),
		);
		return Promise.all(anims.map((a) => a.finished)).then(
			() => {},
			() => {},
		);
	}

	#leaveHello() {
		if (this.#index >= 0) return;
		clearTimeout(this.#helloTimer);
		this.#click();
		const hello = this.element.querySelector<HTMLElement>(".oobe-hello")!;
		hello.style.pointerEvents = "none";
		if (!this.#reduced) {
			hello.animate(
				[
					{ opacity: 1, scale: "1" },
					{ opacity: 0, scale: "1.06" },
				],
				{
					duration: 420,
					easing: "cubic-bezier(0.3, 0, 0.6, 1)",
					fill: "forwards",
				},
			);
		}
		setTimeout(() => hello.remove(), this.#reduced ? 0 : 440);
		this.#card.classList.add("is-shown");
		if (!this.#reduced) {
			const spring = this.#spring(0.62, 0.84);
			this.#card.animate(
				[
					{ opacity: 0, translate: "0 48px", scale: "0.94" },
					{ opacity: 1, translate: "0 0", scale: "1" },
				],
				{
					duration: spring.duration,
					delay: 120,
					easing: spring.easing,
					fill: "backwards",
				},
			);
		}
		this.#go(0, 1);
	}

	/* ---- navigation -------------------------------------------------------- */

	forward() {
		if (this.#busy || this.#index < 0) return;
		const step = this.steps[this.#index]!;
		if (step.valid && !step.valid()) {
			this.#nudge();
			return;
		}
		this.#busy = true;
		this.#click();
		Promise.resolve(step.commit?.())
			.catch((e) => console.warn("[setup]", step.id, e))
			.then(() => {
				this.#busy = false;
				let i = this.#index + 1;
				while (i < this.steps.length && this.steps[i]!.skip?.()) i++;
				if (i >= this.steps.length) void this.complete();
				else this.#go(i, 1);
			});
	}

	back() {
		if (this.#busy || this.#index <= 0) return;
		this.#click();
		let i = this.#index - 1;
		while (i > 0 && this.steps[i]!.skip?.()) i--;
		if (this.steps[i]!.id === "installing") return;
		this.#go(i, -1);
	}

	#nudge() {
		if (this.#reduced) return;
		this.#next.animate(
			[
				{ translate: "0 0" },
				{ translate: "-6px 0" },
				{ translate: "5px 0" },
				{ translate: "-3px 0" },
				{ translate: "0 0" },
			],
			{ duration: 360, easing: "ease-out" },
		);
		(globalThis as any).aetherSound?.play?.("error");
	}

	#go(index: number, dir: 1 | -1) {
		const step = this.steps[index]!;
		const old = this.#stage.firstElementChild as HTMLElement | null;
		this.#index = index;

		const screen = this.#screen(step);
		this.#stage.append(screen);
		this.refresh();

		// Progress: every pill up to this one fills; the current one is wide.
		const visible = this.#visibleSteps;
		const at =
			step.id === "installing"
				? visible.findIndex((s) => s.id === "done")
				: visible.indexOf(step);
		Array.from(this.#pills.children).forEach((pill, i) => {
			pill.classList.toggle("is-done", i < at);
			pill.classList.toggle("is-current", i === at);
		});

		if (old) {
			old.style.pointerEvents = "none";
			if (this.#reduced) old.remove();
			else
				old
					.animate(
						[
							{ opacity: 1, translate: "0 0" },
							{ opacity: 0, translate: `${-dir * 36}px 0` },
						],
						{
							duration: 190,
							easing: "cubic-bezier(0.4, 0, 1, 1)",
							fill: "forwards",
						},
					)
					.finished.then(
						() => old.remove(),
						() => old.remove(),
					);
		}

		if (!this.#reduced) {
			const spring = this.#spring(0.54, 0.86);
			screen.querySelectorAll<HTMLElement>(".rv").forEach((el, i) => {
				el.animate(
					[
						{ opacity: 0, translate: `${dir * 44}px 0` },
						{ opacity: 1, translate: "0 0" },
					],
					{
						duration: spring.duration,
						delay: (old ? 90 : 220) + i * 38,
						easing: spring.easing,
						fill: "backwards",
					},
				);
			});
		}
		step.enter?.();
		// Focus the field that wants it, or the card so Enter works.
		requestAnimationFrame(() => {
			const field = screen.querySelector<HTMLElement>("[data-autofocus]");
			(field || this.#card).focus({ preventScroll: true });
		});
	}

	/** Re-evaluate the footer for the current step. */
	refresh() {
		const step = this.steps[this.#index];
		if (!step) return;
		this.#next.replaceChildren(
			oobeEl("span", { text: step.next?.() || "Continue" }),
			oobeIcon(step.id === "done" ? "arrow_forward" : "chevron_right"),
		);
		this.#next.disabled = !!step.valid && !step.valid();
		this.#back.style.visibility =
			this.#index === 0 || step.id === "installing" || step.id === "done"
				? "hidden"
				: "visible";
		this.#next.style.visibility =
			step.id === "installing" ? "hidden" : "visible";
	}

	#screen(step: OobeStep): HTMLElement {
		const visible = this.#visibleSteps;
		const n = visible.length - 1;
		const pos = visible.indexOf(step) + 1;
		const eyebrow =
			step.id === "done"
				? "All done"
				: pos > 0
					? `Step ${pos} of ${n} · ${step.label}`
					: step.label;
		return oobeEl(
			"div",
			{ class: "oobe-screen", attrs: { "data-step": step.id } },
			oobeEl(
				"div",
				{ class: "oobe-title rv" },
				oobeEl("div", { class: "oobe-badge" }, oobeIcon(step.icon)),
				oobeEl(
					"div",
					{},
					oobeEl("div", { class: "oobe-eyebrow", text: eyebrow }),
					oobeEl("h1", { text: step.title() }),
				),
			),
			oobeEl("p", { class: "oobe-sub rv", text: step.subtitle() }),
			step.body(),
		);
	}

	/* ---- controls ---------------------------------------------------------- */

	/** A segmented control with a sliding thumb (transform only). */
	#segmented<T>(
		options: Array<[T, string]>,
		get: () => T,
		set: (v: T) => void,
	): HTMLElement {
		const thumb = oobeEl("div", { class: "seg-thumb" });
		const wrap = oobeEl("div", {
			class: "oobe-seg",
			style: { "--n": String(options.length) } as any,
			attrs: { role: "radiogroup" },
		});
		wrap.append(thumb);
		const place = () => {
			const i = Math.max(
				0,
				options.findIndex(([v]) => v === get()),
			);
			thumb.style.transform = `translateX(${i * 100}%)`;
			buttons.forEach((b, j) =>
				b.setAttribute("aria-checked", String(i === j)),
			);
		};
		const buttons = options.map(([v, label]) =>
			oobeEl("button", {
				text: label,
				attrs: { type: "button", role: "radio" },
				on: {
					click: () => {
						if (get() === v) return;
						set(v);
						this.#click();
						place();
					},
				},
			}),
		);
		wrap.append(...buttons);
		place();
		return wrap;
	}

	/** A labelled row with a switch. */
	#toggle(
		icon: string,
		title: string,
		desc: string,
		get: () => boolean,
		set: (v: boolean) => void,
		extra?: HTMLElement,
	): HTMLElement {
		const sw = oobeEl("button", {
			class: "oobe-switch",
			attrs: { type: "button", role: "switch", "aria-label": title },
		});
		const sync = () => {
			sw.setAttribute("aria-checked", String(get()));
			row.classList.toggle("is-on", get());
		};
		const row = oobeEl(
			"div",
			{ class: "oobe-row rv" },
			oobeEl("div", { class: "row-icon" }, oobeIcon(icon)),
			oobeEl(
				"div",
				{ class: "row-text" },
				oobeEl("div", { class: "row-title", text: title }),
				oobeEl("div", { class: "row-desc", text: desc }),
				extra,
			),
			sw,
		);
		const flip = () => {
			set(!get());
			(globalThis as any).aetherSound?.play?.(get() ? "toggleOn" : "toggleOff");
			sync();
		};
		sw.addEventListener("click", (e) => {
			e.stopPropagation();
			flip();
		});
		row.addEventListener("click", (e) => {
			if ((e.target as Element).closest("input, .oobe-seg")) return;
			flip();
		});
		sync();
		return row;
	}

	#label(text: string) {
		return oobeEl("div", { class: "oobe-label rv", text });
	}

	/* ---- the questions ----------------------------------------------------- */

	steps: OobeStep[] = [
		{
			id: "region",
			label: "Region",
			icon: "language",
			title: () => "Region & formats",
			subtitle: () =>
				"How the clock and the weather should read. Everything else follows your browser's language.",
			body: () => {
				const clock = oobeEl("div", { class: "fmt-time" });
				const date = oobeEl("div", { class: "fmt-date" });
				const temp = oobeEl("div", { class: "fmt-temp" });
				const paint = () => {
					const now = new Date();
					clock.textContent = now.toLocaleTimeString(undefined, {
						hour: "numeric",
						minute: "2-digit",
						hour12: !this.c.hour24,
					});
					date.textContent = now.toLocaleDateString(undefined, {
						weekday: "long",
						month: "long",
						day: "numeric",
					});
					temp.textContent = this.c.imperial ? "72°F" : "22°C";
				};
				paint();
				let region = "";
				try {
					const loc = new Intl.Locale(navigator.language);
					const names = new Intl.DisplayNames([navigator.language], {
						type: "region",
					});
					const langs = new Intl.DisplayNames([navigator.language], {
						type: "language",
					});
					region =
						langs.of(loc.language) +
						(loc.region ? " · " + names.of(loc.region) : "");
				} catch {
					/* optional */
				}
				return oobeEl(
					"div",
					{ class: "oobe-body" },
					oobeEl(
						"div",
						{ class: "fmt-preview rv" },
						oobeEl("div", {}, clock, date),
						oobeEl(
							"div",
							{ class: "fmt-side" },
							oobeIcon("partly_cloudy_day"),
							temp,
						),
					),
					region &&
						oobeEl(
							"div",
							{ class: "oobe-note rv" },
							oobeIcon("translate"),
							"Detected " + region,
						),
					this.#label("Clock"),
					oobeEl(
						"div",
						{ class: "rv" },
						this.#segmented(
							[
								[false, "12-hour"],
								[true, "24-hour"],
							],
							() => this.c.hour24,
							(v) => {
								this.c.hour24 = v;
								paint();
							},
						),
					),
					this.#label("Temperature"),
					oobeEl(
						"div",
						{ class: "rv" },
						this.#segmented(
							[
								[false, "Celsius"],
								[true, "Fahrenheit"],
							],
							() => this.c.imperial,
							(v) => {
								this.c.imperial = v;
								paint();
							},
						),
					),
				);
			},
			commit: async () => {
				await anura.settings.set("sir-yes-sir", this.c.hour24);
				await anura.settings.set(
					"aether.widgets.weather.units",
					this.c.imperial ? "imperial" : "metric",
				);
			},
		},
		{
			id: "profile",
			label: "Profile",
			icon: "person",
			title: () => "Create your profile",
			subtitle: () =>
				"Your name and picture appear on the lock screen. They stay in this browser.",
			body: () => {
				const avatar = oobeEl("div", { class: "prof-avatar" });
				const paint = () =>
					AetherProfile.paint(avatar, {
						name: this.c.name,
						color: this.c.color,
						emoji: this.c.emoji,
					});
				const input = oobeEl("input", {
					class: "oobe-input",
					attrs: {
						type: "text",
						placeholder: "Your name",
						autocomplete: "name",
						"data-autofocus": "",
						maxlength: "40",
						spellcheck: "false",
					},
				});
				input.value = this.c.name;
				input.addEventListener("input", () => {
					this.c.name = input.value;
					paint();
				});
				const colors = oobeEl("div", { class: "prof-colors" });
				AetherProfile.COLORS.forEach(([a, b], i) => {
					const dot = oobeEl("button", {
						class: "prof-color",
						style: { background: `linear-gradient(145deg, ${a}, ${b})` },
						attrs: { type: "button", "aria-label": "Colour " + (i + 1) },
						on: {
							click: () => {
								this.c.color = i;
								this.#click();
								colors
									.querySelectorAll(".prof-color")
									.forEach((d, j) => d.classList.toggle("is-on", j === i));
								paint();
								this.#pop(avatar);
							},
						},
					});
					dot.classList.toggle("is-on", i === this.c.color);
					colors.append(dot);
				});
				const emoji = oobeEl("div", { class: "prof-emoji" });
				["", ...AetherProfile.EMOJI].forEach((e) => {
					const b = oobeEl("button", {
						class: "prof-glyph" + (e ? "" : " is-initials"),
						text: e || "Aa",
						attrs: { type: "button", title: e ? e : "Initials" },
						on: {
							click: () => {
								this.c.emoji = e;
								this.#click();
								emoji
									.querySelectorAll(".prof-glyph")
									.forEach((d) =>
										d.classList.toggle(
											"is-on",
											(d as HTMLElement).dataset.v === e,
										),
									);
								paint();
								this.#pop(avatar);
							},
						},
					});
					b.dataset.v = e;
					b.classList.toggle("is-on", e === this.c.emoji);
					emoji.append(b);
				});
				paint();
				return oobeEl(
					"div",
					{ class: "oobe-body prof" },
					oobeEl("div", { class: "prof-top rv" }, avatar, input),
					this.#label("Colour"),
					oobeEl("div", { class: "rv" }, colors),
					this.#label("Picture"),
					oobeEl("div", { class: "rv" }, emoji),
				);
			},
			commit: () =>
				AetherProfile.set({
					name: this.c.name,
					color: this.c.color,
					emoji: this.c.emoji,
				}),
		},
		{
			id: "appearance",
			label: "Appearance",
			icon: "palette",
			title: () => "Make it yours",
			subtitle: () =>
				"Pick an accent colour and a wallpaper. You'll see them behind this window as you choose.",
			body: () => {
				const accents = oobeEl("div", { class: "acc-row" });
				OOBE_ACCENTS.forEach(([hex, name]) => {
					const b = oobeEl("button", {
						class: "acc",
						style: { "--c": hex } as any,
						attrs: { type: "button", title: name, "aria-label": name },
						on: {
							click: () => {
								this.c.accent = hex;
								this.#click();
								accents
									.querySelectorAll(".acc")
									.forEach((d) => d.classList.toggle("is-on", d === b));
								this.#applyAccent();
							},
						},
					});
					b.classList.toggle("is-on", hex === this.c.accent);
					accents.append(b);
				});
				const walls = oobeEl("div", { class: "wall-grid" });
				OOBE_WALLPAPERS.forEach(([name, url]) => {
					const img = oobeEl("img", {
						attrs: {
							alt: "",
							loading: "lazy",
							decoding: "async",
							draggable: "false",
						},
					});
					img.src = url;
					const b = oobeEl(
						"button",
						{
							class: "wall",
							attrs: { type: "button", title: name },
							on: {
								click: () => {
									this.c.wallpaper = url;
									this.#click();
									walls
										.querySelectorAll(".wall")
										.forEach((d) => d.classList.toggle("is-on", d === b));
									this.#previewWallpaper();
								},
							},
						},
						img,
						oobeEl("span", { class: "wall-name", text: name }),
						oobeEl("span", { class: "wall-check" }, oobeIcon("check")),
					);
					b.classList.toggle("is-on", url === this.c.wallpaper);
					walls.append(b);
				});
				return oobeEl(
					"div",
					{ class: "oobe-body" },
					this.#label("Accent colour"),
					oobeEl("div", { class: "rv" }, accents),
					this.#label("Wallpaper"),
					oobeEl("div", { class: "rv" }, walls),
				);
			},
			enter: () => this.#previewWallpaper(),
			commit: async () => {
				const t = this.#theme?.state as any;
				const theme = t
					? {
							foreground: t.foreground,
							secondaryForeground: t.secondaryForeground,
							border: t.border,
							darkBorder: t.darkBorder,
							background: t.background,
							secondaryBackground: t.secondaryBackground,
							darkBackground: t.darkBackground,
							accent: this.c.accent,
						}
					: { ...(anura.settings.get("theme") || {}), accent: this.c.accent };
				await anura.settings.set("theme", theme);
				await anura.settings.set("wallpaper", this.c.wallpaper);
			},
		},
		{
			id: "desktop",
			label: "Desktop",
			icon: "widgets",
			title: () => "Widgets on your desktop",
			subtitle: () =>
				"Glanceable cards that sit on the wallpaper. Drag them anywhere later, or add more from Spotlight.",
			body: () => {
				const grid = oobeEl("div", { class: "wid-grid" });
				OOBE_WIDGETS.forEach(([id, icon, name, desc]) => {
					const b = oobeEl(
						"button",
						{
							class: "wid rv",
							attrs: { type: "button", "aria-pressed": "false" },
							on: {
								click: () => {
									if (this.c.widgets.has(id)) this.c.widgets.delete(id);
									else this.c.widgets.add(id);
									const on = this.c.widgets.has(id);
									b.classList.toggle("is-on", on);
									b.setAttribute("aria-pressed", String(on));
									(globalThis as any).aetherSound?.play?.(
										on ? "toggleOn" : "toggleOff",
									);
									this.#pop(b.querySelector(".wid-icon"));
								},
							},
						},
						oobeEl("span", { class: "wid-icon" }, oobeIcon(icon)),
						oobeEl("span", { class: "wid-name", text: name }),
						oobeEl("span", { class: "wid-desc", text: desc }),
						oobeEl("span", { class: "wid-check" }, oobeIcon("check")),
					);
					const on = this.c.widgets.has(id);
					b.classList.toggle("is-on", on);
					b.setAttribute("aria-pressed", String(on));
					grid.append(b);
				});
				return oobeEl("div", { class: "oobe-body" }, grid);
			},
		},
		{
			id: "feel",
			label: "Look & feel",
			icon: "tune",
			title: () => "Look & feel",
			subtitle: () =>
				"These take effect right away, so you can try them here. All of them live in Settings too.",
			body: () => {
				const vol = oobeEl("input", {
					class: "oobe-range",
					attrs: {
						type: "range",
						min: "0",
						max: "1",
						step: "0.05",
						"aria-label": "Volume",
					},
				});
				vol.value = String(this.c.volume);
				let last = 0;
				vol.addEventListener("input", () => {
					this.c.volume = Number(vol.value);
					try {
						aetherSound.volume = this.c.volume;
					} catch {
						/* optional */
					}
					vol.style.setProperty("--p", String(this.c.volume));
					// A tick while dragging, so the level can be heard.
					if (performance.now() - last > 140) {
						last = performance.now();
						(globalThis as any).aetherSound?.play?.("click");
					}
				});
				vol.style.setProperty("--p", String(this.c.volume));
				const volWrap = oobeEl(
					"div",
					{ class: "row-extra" },
					oobeIcon("volume_down"),
					vol,
					oobeIcon("volume_up"),
				);
				volWrap.addEventListener("click", (e) => e.stopPropagation());
				return oobeEl(
					"div",
					{ class: "oobe-body rows" },
					this.#toggle(
						"graphic_eq",
						"Interface sounds",
						"Soft clicks and chimes for opening, closing and toggling.",
						() => this.c.sounds,
						(v) => {
							this.c.sounds = v;
							try {
								aetherSound.enabled = v;
							} catch {
								/* optional */
							}
						},
						volWrap,
					),
					this.#toggle(
						"animation",
						"Animations",
						"Springy windows, the Launchpad reveal, the unlock bloom.",
						() => this.c.animations,
						(v) => {
							this.c.animations = v;
							document.body.classList.toggle("reduce-motion", !v);
						},
					),
					this.#toggle(
						"blur_on",
						"Glass",
						"Frosted, see-through panels. Turn off on slower machines.",
						() => this.c.glass,
						(v) => {
							this.c.glass = v;
							document.body.classList.toggle("blur-disable", !v);
						},
					),
					this.#toggle(
						"arrow_selector_tool",
						"Aether cursor",
						"A soft pointer that morphs over buttons and text.",
						() => this.c.cursor,
						(v) => (this.c.cursor = v),
					),
					this.#toggle(
						"nights_stay",
						"Night Shift in the evening",
						"Warmer colours from 7 PM to 7 AM.",
						() => this.c.nightShift,
						(v) => (this.c.nightShift = v),
					),
				);
			},
			commit: async () => {
				try {
					aetherSound.enabled = this.c.sounds;
					aetherSound.volume = this.c.volume;
				} catch {
					/* optional */
				}
				await anura.settings.set("disable-animation", !this.c.animations);
				await anura.settings.set("blur-disable", !this.c.glass);
				await anura.settings.set("custom-cursor", this.c.cursor);
				try {
					AetherNightShift.save({
						on: false,
						schedule: this.c.nightShift ? "evening" : "manual",
					});
				} catch {
					/* optional */
				}
			},
		},
		{
			id: "privacy",
			label: "Privacy",
			icon: "lock",
			title: () => "Lock & privacy",
			subtitle: () =>
				"Ctrl+Alt+L locks the screen any time. A passcode keeps the curious out, though it's a privacy screen, not real security: everything runs in this browser.",
			body: () => {
				const p1 = oobeEl("input", {
					class: "oobe-input pin",
					attrs: {
						type: "password",
						inputmode: "numeric",
						placeholder: this.#hadPin
							? "New passcode (optional)"
							: "Passcode (optional)",
						autocomplete: "new-password",
						maxlength: "12",
					},
				});
				const p2 = oobeEl("input", {
					class: "oobe-input pin",
					attrs: {
						type: "password",
						inputmode: "numeric",
						placeholder: "Confirm passcode",
						autocomplete: "new-password",
						maxlength: "12",
					},
				});
				const status = oobeEl("div", { class: "pin-status" });
				p1.value = this.c.pin;
				p2.value = this.c.pin2;
				const check = () => {
					this.c.pin = p1.value;
					this.c.pin2 = p2.value;
					p2.disabled = !p1.value;
					const bad = this.#pinProblem();
					status.textContent = bad || (p1.value ? "Passcodes match" : "");
					status.classList.toggle("is-bad", !!bad && !!p2.value);
					status.classList.toggle("is-ok", !bad && !!p1.value);
					this.refresh();
				};
				p1.addEventListener("input", check);
				p2.addEventListener("input", check);
				check();
				return oobeEl(
					"div",
					{ class: "oobe-body" },
					this.#label("Passcode"),
					oobeEl("div", { class: "pin-row rv" }, p1, p2),
					oobeEl("div", { class: "rv" }, status),
					this.#label("Lock automatically"),
					oobeEl(
						"div",
						{ class: "rv" },
						this.#segmented(
							[
								[0, "Never"],
								[5, "5 min"],
								[15, "15 min"],
								[30, "30 min"],
							],
							() => this.c.autoLock,
							(v) => (this.c.autoLock = v),
						),
					),
					this.#label("Screen saver"),
					oobeEl(
						"div",
						{ class: "rv" },
						this.#segmented(
							[
								[0, "Off"],
								[2, "2 min"],
								[5, "5 min"],
								[10, "10 min"],
							],
							() => this.c.saver,
							(v) => (this.c.saver = v),
						),
					),
				);
			},
			valid: () => !this.#pinProblem(),
			commit: async () => {
				if (this.c.pin || !this.#hadPin)
					await AetherLockScreen.setPin(this.c.pin || null);
				await anura.settings.set(AetherLockScreen.IDLE_KEY, this.c.autoLock);
				await anura.settings.set(
					AetherScreensaver.MODE_KEY,
					this.c.saver ? "random" : "off",
				);
				if (this.c.saver)
					await anura.settings.set(AetherScreensaver.DELAY_KEY, this.c.saver);
			},
		},
		{
			id: "browsing",
			label: "Browsing",
			icon: "travel_explore",
			title: () => "Browsing",
			subtitle: () =>
				"The browser reaches the web through a Wisp relay. Pick one that answers; you can switch any time from the browser's address bar.",
			body: () => {
				const list = oobeEl("div", { class: "relay-list rv" });
				const custom = oobeEl("input", {
					class: "oobe-input",
					attrs: {
						type: "text",
						placeholder: "wss://your-relay.example/",
						spellcheck: "false",
					},
				});
				custom.value = this.c.customWisp;
				const renderList = () => {
					list.replaceChildren(
						...this.#relays().map((r) => this.#relayRow(r.name, r.url, r.note)),
					);
				};
				const test = oobeEl(
					"button",
					{
						class: "oobe-btn small",
						attrs: { type: "button" },
						on: {
							click: () => {
								const url = custom.value.trim();
								if (!/^wss?:\/\//.test(url)) {
									this.#nudgeEl(custom);
									return;
								}
								this.c.customWisp = url;
								this.c.wisp = url;
								renderList();
								this.#probe(url, renderList);
							},
						},
					},
					oobeIcon("bolt"),
					"Test",
				);
				custom.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						e.stopPropagation();
						test.click();
					}
				});
				(list as any).__render = renderList;
				renderList();
				return oobeEl(
					"div",
					{ class: "oobe-body" },
					list,
					oobeEl("div", { class: "relay-custom rv" }, custom, test),
					this.#label("Search engine"),
					oobeEl(
						"div",
						{ class: "rv" },
						this.#segmented(
							OOBE_SEARCH.map(([name, url]) => [url, name] as [string, string]),
							() => this.c.search,
							(v) => (this.c.search = v),
						),
					),
				);
			},
			enter: () => {
				const list = this.#stage.querySelector<HTMLElement>(
					"[data-step=browsing] .relay-list",
				);
				const render = () => (list as any)?.__render?.();
				for (const r of this.#relays()) this.#probe(r.url, render, true);
			},
			commit: async () => {
				await anura.settings.set("wisp-url", this.c.wisp);
				try {
					if (anura.net?.wispServer !== this.c.wisp)
						anura.net.setWispServer(this.c.wisp);
				} catch (e) {
					console.warn("[setup] couldn't switch relay", e);
				}
				try {
					const s = JSON.parse(localStorage.getItem("settings") || "{}") || {};
					s.searchEngineUrl = this.c.search;
					localStorage.setItem("settings", JSON.stringify(s));
				} catch {
					/* the browser keeps its default */
				}
			},
		},
		{
			id: "features",
			label: "Features",
			icon: "deployed_code",
			title: () => "Choose your experience",
			subtitle: () =>
				"Extras that need a download. All of them can be turned on later in Settings.",
			body: () => {
				const size = oobeEl("span", {});
				const paint = () => {
					size.textContent = this.c.linux
						? "About 1 GB to download"
						: this.c.offline
							? "About 25 MB to download"
							: "Nothing to download";
					this.refresh();
				};
				paint();
				const row = (
					icon: string,
					title: string,
					desc: string,
					key: "offline" | "linux" | "opfs",
				) =>
					this.#toggle(
						icon,
						title,
						desc,
						() => this.c[key],
						(v) => {
							this.c[key] = v;
							paint();
						},
					);
				return oobeEl(
					"div",
					{ class: "oobe-body rows" },
					row(
						"cloud_off",
						"Works offline",
						`Keeps ${BRANDING.name} on this device so it opens without a connection.`,
						"offline",
					),
					row(
						"terminal",
						"Linux",
						"A real Alpine Linux in a virtual machine, with a terminal.",
						"linux",
					),
					row(
						"science",
						"Experimental OPFS file system",
						"Faster storage, less battle-tested. Restarts once to switch over.",
						"opfs",
					),
					oobeEl("div", { class: "oobe-note rv" }, oobeIcon("download"), size),
				);
			},
			next: () => (this.c.offline || this.c.linux ? "Set Up" : "Continue"),
			commit: async () => {
				await anura.settings.set("x86-disabled", !this.c.linux);
				await anura.settings.set("use-sw-cache", this.c.offline);
				const apps: string[] = anura.settings.get("applist") || [];
				const term = this.c.linux ? "anura.term" : "anura.ashell";
				if (!apps.includes(term))
					await anura.settings.set("applist", [...apps, term]);
				if (this.c.opfs) {
					await (window as any).idbKeyval.set("bootFromOPFS", true);
					navigator.serviceWorker.controller?.postMessage({
						anura_target: "anura.bootFromOPFS",
						value: true,
					});
				}
				navigator.serviceWorker.controller?.postMessage({
					anura_target: "anura.cache",
					value: this.c.offline,
				});
			},
		},
		{
			id: "installing",
			label: "Setting up",
			icon: "downloading",
			title: () => "Setting things up",
			subtitle: () =>
				"Downloading what you picked. This only happens once; keep this tab open.",
			body: () =>
				oobeEl(
					"div",
					{ class: "oobe-body" },
					oobeEl(
						"div",
						{ class: "install rv" },
						oobeEl("div", { class: "install-bar" }, oobeEl("i")),
						oobeEl("span", { attrs: { id: "tracker" }, text: "Preparing…" }),
					),
				),
			skip: () => !this.c.offline && !this.c.linux,
			enter: async () => {
				// Nothing to go back to or skip ahead to while this runs.
				this.#busy = true;
				const tracker = this.#stage.querySelector<HTMLElement>("#tracker");
				try {
					const haveLinux = await anura.fs.promises.stat("/boot/bzimage").then(
						() => true,
						() => false,
					);
					if (this.c.linux && !haveLinux) {
						await anura.settings.set("x86-image", "alpine");
						await installx86(tracker);
					}
					if (this.c.offline) await preloadFiles(tracker);
				} catch (e) {
					console.warn("[setup] download failed", e);
				}
				this.#busy = false;
				this.#go(
					this.steps.findIndex((s) => s.id === "done"),
					1,
				);
			},
		},
		{
			id: "done",
			label: "Done",
			icon: "celebration",
			title: () => {
				const first = this.c.name.trim().split(/\s+/)[0];
				return first ? `You're all set, ${first}` : "You're all set";
			},
			subtitle: () =>
				`A few things worth knowing before you dive into ${BRANDING.name}:`,
			body: () => {
				const tip = (keys: string[], title: string, icon: string) =>
					oobeEl(
						"div",
						{ class: "tip rv" },
						oobeEl("span", { class: "tip-icon" }, oobeIcon(icon)),
						oobeEl("span", { class: "tip-title", text: title }),
						oobeEl(
							"span",
							{ class: "tip-keys" },
							...keys.map((k) => oobeEl("kbd", { text: k })),
						),
					);
				return oobeEl(
					"div",
					{ class: "oobe-body" },
					oobeEl(
						"div",
						{ class: "tips" },
						tip(
							["Ctrl", "Space"],
							"Spotlight: search, launch, calculate",
							"search",
						),
						tip(["F3"], "Mission Control: every window at once", "view_quilt"),
						tip(["Ctrl", "Alt", "L"], "Lock the screen", "lock"),
						tip(
							["Ctrl", "Shift", "4"],
							"Screenshot a region",
							"screenshot_region",
						),
						tip(["Ctrl", "Alt", "V"], "Clipboard history", "content_paste"),
						tip(["Ctrl", "/"], "Every other shortcut", "keyboard"),
					),
				);
			},
			next: () => `Start using ${BRANDING.name}`,
		},
	];

	/* ---- helpers for the questions ------------------------------------------ */

	#pinProblem(): string {
		const a = this.c.pin;
		const b = this.c.pin2;
		if (!a) return "";
		if (!/^\d+$/.test(a)) return "Use digits only";
		if (a.length < 4) return "At least 4 digits";
		if (!b) return "Type it again to confirm";
		if (a !== b) return "Passcodes don't match";
		return "";
	}

	/** A quick scale pop on something that just changed. */
	#pop(el: Element | null) {
		if (!el || this.#reduced) return;
		const spring = this.#spring(0.34, 0.5);
		(el as HTMLElement).animate([{ scale: "0.86" }, { scale: "1" }], {
			duration: spring.duration,
			easing: spring.easing,
		});
	}

	#nudgeEl(el: HTMLElement) {
		el.focus();
		if (this.#reduced) return;
		el.animate(
			[
				{ translate: "0 0" },
				{ translate: "-6px 0" },
				{ translate: "5px 0" },
				{ translate: "0 0" },
			],
			{ duration: 300, easing: "ease-out" },
		);
	}

	#previewWallpaper() {
		const url = this.c.wallpaper;
		const next = oobeEl("div", { class: "oobe-wall-img" });
		next.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
		const olds = Array.from(this.#wall.children) as HTMLElement[];
		this.#wall.append(next);
		const done = () => olds.forEach((o) => o.remove());
		if (this.#reduced) return done();
		next
			.animate([{ opacity: 0 }, { opacity: 1 }], {
				duration: 520,
				easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
			})
			.finished.then(done, done);
	}

	#relays(): Array<{ name: string; url: string; note: string }> {
		const list = [
			{
				name: "This site",
				url: OobeView.sameOriginWisp(),
				note: `The server ${BRANDING.name} is running on`,
			},
			{
				name: "Mercury Workshop",
				url: "wss://wisp.mercurywork.shop/",
				note: "Public relay from the anuraOS developers",
			},
		];
		const custom = this.c.customWisp;
		if (custom && !list.some((r) => r.url === custom))
			list.push({ name: "Custom", url: custom, note: custom });
		return list;
	}

	#relayRow(name: string, url: string, note: string): HTMLElement {
		const p = this.#probes.get(url) || { state: "idle" };
		const on = this.c.wisp === url;
		const status =
			p.state === "testing"
				? "Testing…"
				: p.state === "ok"
					? `Connected · ${p.ms} ms`
					: p.state === "fail"
						? p.reason || "Unreachable"
						: "";
		const row = oobeEl(
			"button",
			{
				class: `relay is-${p.state}` + (on ? " is-on" : ""),
				attrs: { type: "button", role: "radio", "aria-checked": String(on) },
				on: {
					click: () => {
						this.c.wisp = url;
						this.#click();
						(this.#stage.querySelector(".relay-list") as any)?.__render?.();
					},
				},
			},
			oobeEl("span", { class: "relay-radio" }),
			oobeEl(
				"span",
				{ class: "relay-text" },
				oobeEl("span", { class: "relay-name", text: name }),
				oobeEl("span", { class: "relay-note", text: note }),
			),
			oobeEl(
				"span",
				{ class: "relay-status" },
				oobeEl("i", { class: "relay-dot" }),
				status,
			),
		);
		return row;
	}

	/**
	 * Test a relay. With `auto`, a failed pick is swapped for the first relay
	 * that answers: on a static host like GitHub Pages "This site" never has a
	 * Wisp server, and a browser that can't load anything is a poor first
	 * impression.
	 */
	#probe(url: string, render: () => void, auto = false) {
		const cur = this.#probes.get(url);
		if (cur?.state === "testing") return;
		this.#probes.set(url, { state: "testing" });
		render();
		const probe = (globalThis as any).Networking?.probeWisp;
		const run: Promise<{ ok: boolean; ms?: number; reason?: string }> = probe
			? probe.call((globalThis as any).Networking, url, 6000)
			: Promise.resolve({ ok: false, reason: "Can't test here" });
		run
			.catch((): { ok: boolean; ms?: number; reason?: string } => ({
				ok: false,
				reason: "Unreachable",
			}))
			.then((r) => {
				this.#probes.set(url, {
					state: r.ok ? "ok" : "fail",
					ms: r.ms,
					reason: r.reason,
				});
				if (auto && this.#probes.get(this.c.wisp)?.state === "fail") {
					const good = this.#relays().find(
						(x) => this.#probes.get(x.url)?.state === "ok",
					);
					if (good) this.c.wisp = good.url;
				}
				if (this.steps[this.#index]?.id === "browsing") render();
			});
	}

	/* ---- finish ------------------------------------------------------------ */

	async complete() {
		this.#busy = true;
		this.#next.disabled = true;
		this.#next.classList.add("is-working");
		this.#next.replaceChildren(
			oobeEl("span", { class: "oobe-spinner" }),
			oobeEl("span", { text: "Starting…" }),
		);
		await anura.settings.set("oobe-complete", true);
		if (this.c.opfs) {
			await anura.fs.promises.writeFile(
				"/opfs/anura_settings.json",
				JSON.stringify(anura.settings.cache),
			);
			window.location.reload(); // need to reboot to go through firstboot again if using new opfs driver
			return;
		}
		const root = this.element;
		// Stay up until the desktop exists behind us, then lift away while it
		// blooms in: the same entrance as an unlock.
		document.addEventListener(
			"aether-desktop-ready",
			() => {
				try {
					const have = new Set(AetherDesktopWidgets.entries.map((e) => e.id));
					for (const id of this.c.widgets)
						if (!have.has(id)) AetherDesktopWidgets.add(id);
					document
						.querySelectorAll<HTMLElement>(".dw-item:not(.is-in)")
						.forEach((el) => el.classList.add("is-in"));
				} catch (e) {
					console.warn("[setup] widgets", e);
				}
				(globalThis as any).AetherMotion?.revealDesktop();
				root.style.pointerEvents = "none";
				if (this.#reduced) return root.remove();
				this.#card.animate(
					[
						{ opacity: 1, translate: "0 0", scale: "1" },
						{ opacity: 0, translate: "0 -28px", scale: "1.03" },
					],
					{
						duration: 380,
						easing: "cubic-bezier(0.3, 0, 0.6, 1)",
						fill: "forwards",
					},
				);
				root
					.animate([{ opacity: 1 }, { opacity: 0 }], {
						duration: 560,
						delay: 80,
						easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
						fill: "forwards",
					})
					.finished.then(
						() => root.remove(),
						() => root.remove(),
					);
			},
			{ once: true },
		);
		document.dispatchEvent(new Event("anura-login-completed"));
	}
}

async function installx86(tracker = document.getElementById("tracker")) {
	console.debug("installing x86");
	await anura.fs.mkdir("/boot");
	const x86image = anura.settings.get("x86-image");
	tracker!.innerText = "Downloading x86 kernel";
	const bzimage = await fetch(anura.config.x86[x86image].bzimage);
	anura.fs.writeFile(
		"/boot/bzimage",
		Filer.Buffer(await bzimage.arrayBuffer()),
	);
	tracker!.innerText = "Downloading x86 initrd";
	const initrd = await fetch(anura.config.x86[x86image].initrd);
	anura.fs.writeFile(
		"/boot/initrd.img",
		Filer.Buffer(await initrd.arrayBuffer()),
	);

	if (typeof anura.config.x86[x86image].rootfs === "string") {
		const rootfs = await fetch(anura.config.x86[x86image].rootfs);
		const blob = await rootfs.blob();
		//@ts-ignore
		await anura.x86hdd.loadfile(blob);
	} else if (anura.config.x86[x86image].rootfs) {
		// TODO: add batching, this will bottleneck and OOM if the rootfs is too large

		console.debug("fetching");
		// const files = await Promise.all(
		//     anura.config.x86[x86image].rootfs.map((part: string) => fetch(part)),
		// );

		const files: Blob[] = [];
		let limit = 4;
		let i = 0;
		let done = false;
		let doneSoFar = 0;
		const doWhenAvail = function () {
			if (limit === 0) return;
			limit--;
			const assigned = i;
			i++;

			fetch(anura.config.x86[x86image].rootfs[assigned])
				.then(async (response) => {
					if (response.status !== 200) {
						console.error("Status code bad on chunk " + assigned);
						console.error(anura.config.x86[x86image].rootfs[assigned]);
						console.error("Finished " + doneSoFar + " chunks before error");
						anura.notifications.add({
							title: "bad chunk on x86 download",
							description: `Chunk ${assigned} gave status code ${response.status}\nClick me to reload`,
							timeout: 50000,
							callback: () => {
								location.reload();
							},
						});
						return;
					}
					files[assigned] = await response.blob();
					limit++;
					doneSoFar++;
					tracker!.innerHTML = `Downloading x86 rootfs. Chunk ${doneSoFar}/${anura.config.x86[x86image].rootfs.length} done`;
					if (i < anura.config.x86[x86image].rootfs.length) {
						doWhenAvail();
					}
					if (doneSoFar === anura.config.x86[x86image].rootfs.length) {
						done = true;
					}
					console.debug(
						anura.config.x86[x86image].rootfs.length -
							doneSoFar +
							" chunks to go",
					);
				})

				.catch((e) => {
					console.error("Error on chunk " + assigned);
					anura.notifications.add({
						title: "bad chunk on x86 download",
						description: `Chunk ${assigned} had a download error ${e}\nClick me to reload`,
						timeout: 50000,
						callback: () => {
							location.reload();
						},
					});
				}); // Peak error handling right there
		};
		doWhenAvail();
		doWhenAvail();
		doWhenAvail();
		doWhenAvail();
		while (!done) {
			await sleep(200);
		}

		console.debug("constructing blobs...");
		tracker!.innerText = "Concatenating and installing x86 rootfs";
		//@ts-ignore
		await anura.x86hdd.loadfile(new Blob(files));
	}

	console.debug("done");
}

async function preloadFiles(tracker = document.getElementById("tracker")) {
	try {
		const list = await (await fetch("cache-load.json")).json();
		/*
		 * The list has a few items that aren't exactly real
		 * as a result of the developers schizophrenia.
		 * Because of this, there will be a few errors on the fetch.
		 * These can safely be ignored, just like the voices in
		 * the developers head.
		 */
		const chunkSize = 10;
		const promises = [];
		let i = 0;
		for (const item in list) {
			promises.push(fetch(list[item]));
			if (Number(item) % chunkSize === chunkSize - 1) {
				await Promise.all(promises);
			}
			tracker!.innerText = `Downloading system files · ${i} of ${list.length}`;
			tracker?.parentElement?.style.setProperty("--p", String(i / list.length));
			i++;
		}
		await Promise.all(promises);
	} catch (e) {
		console.warn("error durring oobe preload", e);
	}
}
