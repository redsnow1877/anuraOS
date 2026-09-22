/**
 * Clock — world clock, alarms, stopwatch and timer.
 *
 * Everything time-based is stored as timestamps rather than counted in
 * intervals, so the display is always computed from `Date.now()` and can't
 * drift, and nothing needs to tick while no one is looking. Alarms and a
 * running timer live on the app, not the window: close the window and they
 * still go off, as a notification with a sound.
 */

interface ClockAlarm {
	id: string;
	/** "HH:MM", 24-hour. */
	time: string;
	label: string;
	enabled: boolean;
	/** Day stamp of the last firing, so a minute-long window fires once. */
	lastFired?: string;
}

const CLOCK_ZONES: { city: string; tz: string }[] = [
	{ city: "Honolulu", tz: "Pacific/Honolulu" },
	{ city: "Los Angeles", tz: "America/Los_Angeles" },
	{ city: "Denver", tz: "America/Denver" },
	{ city: "Chicago", tz: "America/Chicago" },
	{ city: "New York", tz: "America/New_York" },
	{ city: "São Paulo", tz: "America/Sao_Paulo" },
	{ city: "London", tz: "Europe/London" },
	{ city: "Paris", tz: "Europe/Paris" },
	{ city: "Berlin", tz: "Europe/Berlin" },
	{ city: "Cairo", tz: "Africa/Cairo" },
	{ city: "Moscow", tz: "Europe/Moscow" },
	{ city: "Dubai", tz: "Asia/Dubai" },
	{ city: "Mumbai", tz: "Asia/Kolkata" },
	{ city: "Bangkok", tz: "Asia/Bangkok" },
	{ city: "Ho Chi Minh City", tz: "Asia/Ho_Chi_Minh" },
	{ city: "Singapore", tz: "Asia/Singapore" },
	{ city: "Hong Kong", tz: "Asia/Hong_Kong" },
	{ city: "Shanghai", tz: "Asia/Shanghai" },
	{ city: "Seoul", tz: "Asia/Seoul" },
	{ city: "Tokyo", tz: "Asia/Tokyo" },
	{ city: "Sydney", tz: "Australia/Sydney" },
	{ city: "Auckland", tz: "Pacific/Auckland" },
];

class ClockApp extends App {
	name = "Clock";
	package = "anura.clock";
	icon = "/assets/icons/clock.svg";

	static readonly CITIES_KEY = "aether.clock.cities";
	static readonly ALARMS_KEY = "aether.clock.alarms";

	/* ---- shared state (outlives any window) ---------------------------- */

	stopwatch = {
		startedAt: 0,
		elapsed: 0,
		running: false,
		laps: [] as number[],
	};
	timer = { endsAt: 0, remaining: 0, total: 0, running: false, active: false };
	#timerCheck = 0;

	constructor() {
		super();
		// Alarms fire with or without a window open. A 15s check is plenty
		// for minute-resolution alarms and costs nothing measurable.
		setInterval(() => this.#checkAlarms(), 15_000);
	}

	css = css`
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--theme-bg);
		color: var(--ink);
		user-select: none;
		font-variant-numeric: tabular-nums;

		.clk-tabs {
			display: flex;
			justify-content: center;
			padding: 12px 12px 6px;
			flex-shrink: 0;
		}

		.clk-body {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: 8px 18px 18px;
		}

		.clk-row {
			display: flex;
			align-items: center;
			gap: 14px;
			padding: 12px 4px;
			border-bottom: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			position: relative;
		}

		.clk-face {
			position: relative;
			width: 46px;
			height: 46px;
			border-radius: 50%;
			flex-shrink: 0;
			background: radial-gradient(circle at 50% 35%, #34343f, #1a1a22);
			box-shadow:
				inset 0 0 0 1px rgba(255, 255, 255, 0.12),
				0 2px 8px rgba(0, 0, 0, 0.35);
		}

		.clk-face.is-night {
			background: radial-gradient(circle at 50% 35%, #1b1b28, #0b0b12);
		}

		.clk-face.is-day {
			background: radial-gradient(circle at 50% 35%, #f4f4f8, #cfd0da);
		}

		.clk-hand {
			position: absolute;
			left: 50%;
			bottom: 50%;
			transform-origin: 50% 100%;
			border-radius: 2px;
			background: #f2f2f5;
		}

		.clk-face.is-day .clk-hand {
			background: #1b1b22;
		}

		.clk-hand.h {
			width: 3px;
			height: 12px;
			margin-left: -1.5px;
		}

		.clk-hand.m {
			width: 2px;
			height: 17px;
			margin-left: -1px;
		}

		.clk-hand.s {
			width: 1px;
			height: 18px;
			margin-left: -0.5px;
			background: var(--theme-accent) !important;
		}

		.clk-city {
			flex: 1;
			min-width: 0;
		}

		.clk-city-name {
			font-size: 15px;
			font-weight: 500;
		}

		.clk-city-sub {
			font-size: 12px;
			color: var(--ink-faint);
			margin-top: 2px;
		}

		.clk-city-time {
			font-size: 30px;
			font-weight: 300;
			letter-spacing: -0.02em;
		}

		.clk-remove {
			position: absolute;
			right: -6px;
			top: 50%;
			transform: translateY(-50%);
			opacity: 0;
			border: none;
			background: #ff5f57;
			color: #fff;
			width: 20px;
			height: 20px;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			padding: 0;
			transition: opacity 0.12s;
		}

		.clk-row:hover .clk-remove {
			opacity: 1;
		}

		.clk-remove .material-symbols-outlined {
			font-size: 14px;
		}

		.clk-add {
			display: flex;
			gap: 8px;
			align-items: center;
			padding-top: 14px;
		}

		.clk-add .aether-select,
		.clk-add input {
			flex: 1;
		}

		.clk-input {
			font-family: inherit;
			font-size: 13px;
			color: var(--ink);
			padding: 6px 10px;
			border-radius: 8px;
			border: 1px solid var(--glass-stroke, rgba(255, 255, 255, 0.14));
			background: rgba(255, 255, 255, 0.08);
			outline: none;
			min-width: 0;
			color-scheme: dark;
		}

		.clk-btn {
			font-family: inherit;
			font-size: 13px;
			font-weight: 500;
			border: none;
			border-radius: 8px;
			padding: 7px 14px;
			color: #fff;
			background: var(--theme-accent);
			cursor: pointer;
			flex-shrink: 0;
		}

		.clk-btn.secondary {
			background: rgba(255, 255, 255, 0.12);
			color: var(--ink);
		}

		/* stopwatch + timer */
		.clk-big {
			font-size: 64px;
			font-weight: 200;
			letter-spacing: -0.03em;
			text-align: center;
			padding: 22px 0 18px;
		}

		.clk-controls {
			display: flex;
			justify-content: space-between;
			padding: 0 10px 16px;
		}

		.clk-round {
			width: 76px;
			height: 76px;
			border-radius: 50%;
			border: none;
			font-family: inherit;
			font-size: 15px;
			font-weight: 500;
			cursor: pointer;
			color: #fff;
			background: rgba(255, 255, 255, 0.14);
			box-shadow:
				0 0 0 3px var(--theme-bg),
				0 0 0 4.5px rgba(255, 255, 255, 0.14);
			transition: transform 0.1s var(--ease-out);
		}

		.clk-round:active {
			transform: scale(0.94);
		}

		.clk-round.go {
			color: #6ee7a0;
			background: rgba(52, 199, 89, 0.22);
			box-shadow:
				0 0 0 3px var(--theme-bg),
				0 0 0 4.5px rgba(52, 199, 89, 0.3);
		}

		.clk-round.stop {
			color: #ff8a80;
			background: rgba(255, 69, 58, 0.22);
			box-shadow:
				0 0 0 3px var(--theme-bg),
				0 0 0 4.5px rgba(255, 69, 58, 0.3);
		}

		.clk-round:disabled {
			opacity: 0.4;
			cursor: default;
		}

		.clk-lap {
			display: flex;
			justify-content: space-between;
			padding: 9px 6px;
			border-top: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			font-size: 14px;
		}

		.clk-lap.best {
			color: #6ee7a0;
		}

		.clk-lap.worst {
			color: #ff8a80;
		}

		.clk-ring {
			position: relative;
			width: 220px;
			height: 220px;
			margin: 18px auto 20px;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.clk-ring::before {
			content: "";
			position: absolute;
			inset: 0;
			border-radius: 50%;
			background: conic-gradient(
				var(--theme-accent) calc(var(--p, 1) * 360deg),
				rgba(255, 255, 255, 0.08) 0
			);
			-webkit-mask: radial-gradient(
				farthest-side,
				transparent calc(100% - 7px),
				#000 calc(100% - 6px)
			);
			mask: radial-gradient(
				farthest-side,
				transparent calc(100% - 7px),
				#000 calc(100% - 6px)
			);
		}

		.clk-ring .clk-big {
			font-size: 46px;
			padding: 0;
		}

		.clk-presets {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 10px;
			padding: 14px 0;
		}

		.clk-preset {
			padding: 14px 0;
			border-radius: 12px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			background: rgba(255, 255, 255, 0.06);
			color: var(--ink);
			font-family: inherit;
			font-size: 15px;
			cursor: pointer;
		}

		.clk-preset:hover {
			background: rgba(255, 255, 255, 0.11);
		}

		.clk-alarm-time {
			font-size: 32px;
			font-weight: 300;
		}

		.clk-alarm-row.off .clk-alarm-time,
		.clk-alarm-row.off .clk-city-sub {
			opacity: 0.45;
		}

		.clk-empty {
			text-align: center;
			color: var(--ink-faint);
			font-size: 13px;
			padding: 30px 0 10px;
		}
	`;

	/* ---- helpers --------------------------------------------------------- */

	static pad(n: number, w = 2) {
		return String(Math.floor(n)).padStart(w, "0");
	}

	/** mm:ss.cc, with hours when needed. */
	static formatElapsed(ms: number) {
		const cs = Math.floor(ms / 10) % 100;
		const s = Math.floor(ms / 1000) % 60;
		const m = Math.floor(ms / 60000) % 60;
		const h = Math.floor(ms / 3600000);
		return (
			(h ? h + ":" + ClockApp.pad(m) : ClockApp.pad(m)) +
			":" +
			ClockApp.pad(s) +
			"." +
			ClockApp.pad(cs)
		);
	}

	static formatRemaining(ms: number) {
		const total = Math.ceil(ms / 1000);
		const s = total % 60;
		const m = Math.floor(total / 60) % 60;
		const h = Math.floor(total / 3600);
		return (h ? h + ":" + ClockApp.pad(m) : String(m)) + ":" + ClockApp.pad(s);
	}

	get cities(): string[] {
		const saved = anura.settings.get(ClockApp.CITIES_KEY);
		return Array.isArray(saved)
			? saved
			: ["America/Los_Angeles", "Europe/London", "Asia/Tokyo"];
	}

	set cities(v: string[]) {
		anura.settings.set(ClockApp.CITIES_KEY, v);
	}

	get alarms(): ClockAlarm[] {
		const saved = anura.settings.get(ClockApp.ALARMS_KEY);
		return Array.isArray(saved) ? saved : [];
	}

	set alarms(v: ClockAlarm[]) {
		anura.settings.set(ClockApp.ALARMS_KEY, v);
	}

	#hour12(): boolean {
		return !anura.settings.get("sir-yes-sir");
	}

	#notify(title: string, description: string) {
		(globalThis as any).aetherSound?.play?.("notify");
		setTimeout(() => (globalThis as any).aetherSound?.play?.("notify"), 700);
		anura.notifications.add({
			title,
			description,
			timeout: "never",
			buttons: [
				{
					text: "Open Clock",
					style: "text",
					callback: () => this.open(),
					close: true,
				},
			],
		});
	}

	#checkAlarms() {
		const now = new Date();
		const hhmm =
			ClockApp.pad(now.getHours()) + ":" + ClockApp.pad(now.getMinutes());
		const today = now.toDateString();
		let changed = false;
		const alarms = this.alarms.map((a) => {
			if (a.enabled && a.time === hhmm && a.lastFired !== today) {
				changed = true;
				this.#notify("⏰ " + (a.label || "Alarm"), this.#formatAlarm(a.time));
				return { ...a, lastFired: today };
			}
			return a;
		});
		if (changed) this.alarms = alarms;
	}

	#formatAlarm(time: string) {
		const [h, m] = time.split(":").map(Number);
		const d = new Date();
		d.setHours(h!, m!, 0, 0);
		return d.toLocaleTimeString(navigator.language, {
			hour: "numeric",
			minute: "2-digit",
			hour12: this.#hour12(),
		});
	}

	/* ---- timer (app-level, survives the window) --------------------------- */

	/** The menu bar island shows a running timer. */
	#timerChanged() {
		(globalThis as any).AetherIsland?.refresh();
	}

	startTimer(ms: number) {
		if (ms <= 0) return;
		this.timer = {
			endsAt: Date.now() + ms,
			remaining: ms,
			total: ms,
			running: true,
			active: true,
		};
		this.#armTimer();
		this.#timerChanged();
	}

	#armTimer() {
		clearTimeout(this.#timerCheck);
		if (!this.timer.running) return;
		this.#timerCheck = window.setTimeout(() => {
			if (!this.timer.running) return;
			this.timer = {
				endsAt: 0,
				remaining: 0,
				total: this.timer.total,
				running: false,
				active: false,
			};
			this.#notify(
				"Timer done",
				ClockApp.formatRemaining(this.timer.total) + " is up",
			);
			this.#timerChanged();
		}, this.timer.endsAt - Date.now());
	}

	pauseTimer() {
		if (!this.timer.running) return;
		this.timer.remaining = Math.max(0, this.timer.endsAt - Date.now());
		this.timer.running = false;
		clearTimeout(this.#timerCheck);
		this.#timerChanged();
	}

	resumeTimer() {
		if (this.timer.running || !this.timer.active) return;
		this.timer.endsAt = Date.now() + this.timer.remaining;
		this.timer.running = true;
		this.#armTimer();
		this.#timerChanged();
	}

	cancelTimer() {
		clearTimeout(this.#timerCheck);
		this.timer = {
			endsAt: 0,
			remaining: 0,
			total: 0,
			running: false,
			active: false,
		};
		this.#timerChanged();
	}

	/* ---- window ---------------------------------------------------------- */

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "Clock",
			width: "400px",
			height: "560px",
		});
		const root = document.createElement("div");
		root.className = this.css;
		win.content.appendChild(root);

		const tabsWrap = document.createElement("div");
		tabsWrap.className = "clk-tabs";
		const tabs = document.createElement("div");
		tabs.className = "aether-segmented";
		tabsWrap.appendChild(tabs);
		const body = document.createElement("div");
		body.className = "clk-body";
		root.append(tabsWrap, body);

		let tab = (["world", "alarm", "stopwatch", "timer"] as const).includes(
			args[0] as any,
		)
			? (args[0] as "world" | "alarm" | "stopwatch" | "timer")
			: this.timer.active
				? "timer"
				: "world";
		let frame = 0;
		let lastSecond = -1;
		const buttons: Record<string, HTMLButtonElement> = {};
		for (const [id, label] of [
			["world", "World Clock"],
			["alarm", "Alarms"],
			["stopwatch", "Stopwatch"],
			["timer", "Timer"],
		] as const) {
			const b = document.createElement("button");
			b.textContent = label;
			b.addEventListener("click", () => {
				tab = id;
				render();
			});
			tabs.appendChild(b);
			buttons[id] = b;
		}

		const el = <K extends keyof HTMLElementTagNameMap>(
			tag: K,
			cls = "",
			text = "",
		) => {
			const e = document.createElement(tag);
			if (cls) e.className = cls;
			if (text) e.textContent = text;
			return e;
		};

		/* world clock */
		const world = () => {
			const rows: {
				face: HTMLElement;
				time: HTMLElement;
				sub: HTMLElement;
				tz: string;
				hands: HTMLElement[];
			}[] = [];
			const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			for (const tz of this.cities) {
				const zone = CLOCK_ZONES.find((z) => z.tz === tz);
				const row = el("div", "clk-row");
				const face = el("div", "clk-face");
				const hands = ["h", "m", "s"].map((k) => {
					const hand = el("div", "clk-hand " + k);
					face.appendChild(hand);
					return hand;
				});
				const info = el("div", "clk-city");
				info.append(
					el(
						"div",
						"clk-city-name",
						zone?.city || tz.split("/").pop()!.replace(/_/g, " "),
					),
				);
				const sub = el("div", "clk-city-sub");
				info.appendChild(sub);
				const time = el("div", "clk-city-time");
				const remove = el("button", "clk-remove");
				remove.title = "Remove";
				remove.innerHTML =
					'<span class="material-symbols-outlined">close</span>';
				remove.addEventListener("click", () => {
					this.cities = this.cities.filter((c) => c !== tz);
					render();
				});
				row.append(face, info, time, remove);
				body.appendChild(row);
				rows.push({ face, time, sub, tz, hands });
			}
			if (!rows.length)
				body.appendChild(
					el("div", "clk-empty", "No cities yet — add one below."),
				);

			const add = el("div", "clk-add");
			const select = el("select", "aether-select") as HTMLSelectElement;
			select.appendChild(new Option("Add a city…", ""));
			for (const z of CLOCK_ZONES)
				if (!this.cities.includes(z.tz))
					select.appendChild(new Option(z.city, z.tz));
			select.addEventListener("change", () => {
				if (!select.value) return;
				this.cities = [...this.cities, select.value];
				render();
			});
			add.appendChild(select);
			body.appendChild(add);

			const offsetLabel = (tz: string, now: Date) => {
				// Minutes difference between the zone and local wall time.
				const wall = (z: string) =>
					new Date(now.toLocaleString("en-US", { timeZone: z })).getTime();
				const diff = Math.round((wall(tz) - wall(localTz)) / 60000);
				const dayDiff =
					new Date(wall(tz)).getDate() - new Date(wall(localTz)).getDate();
				const day =
					dayDiff === 0
						? "Today"
						: dayDiff === 1 || dayDiff < -1
							? "Tomorrow"
							: "Yesterday";
				if (diff === 0) return `${day}, same time`;
				const h = Math.trunc(Math.abs(diff) / 60);
				const m = Math.abs(diff) % 60;
				return `${day}, ${diff > 0 ? "+" : "−"}${h}${m ? ":" + ClockApp.pad(m) : ""}h`;
			};
			return (now: Date) => {
				for (const r of rows) {
					const parts = new Intl.DateTimeFormat("en-US", {
						timeZone: r.tz,
						hour: "numeric",
						minute: "numeric",
						second: "numeric",
						hour12: false,
					}).formatToParts(now);
					const get = (t: string) =>
						Number(parts.find((p) => p.type === t)?.value || 0) % 24;
					const h = get("hour");
					const m = get("minute");
					const s = Number(parts.find((p) => p.type === "second")?.value || 0);
					r.hands[0]!.style.transform = `rotate(${(h % 12) * 30 + m * 0.5}deg)`;
					r.hands[1]!.style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
					r.hands[2]!.style.transform = `rotate(${s * 6}deg)`;
					r.face.classList.toggle("is-day", h >= 7 && h < 19);
					r.face.classList.toggle("is-night", h < 7 || h >= 19);
					r.time.textContent = now.toLocaleTimeString(navigator.language, {
						timeZone: r.tz,
						hour: "numeric",
						minute: "2-digit",
						hour12: this.#hour12(),
					});
					r.sub.textContent = offsetLabel(r.tz, now);
				}
			};
		};

		/* alarms */
		const alarms = () => {
			const list = this.alarms
				.slice()
				.sort((a, b) => a.time.localeCompare(b.time));
			if (!list.length)
				body.appendChild(
					el(
						"div",
						"clk-empty",
						"No alarms. Alarms ring even with this window closed.",
					),
				);
			for (const a of list) {
				const row = el(
					"div",
					"clk-row clk-alarm-row" + (a.enabled ? "" : " off"),
				);
				const info = el("div", "clk-city");
				info.append(
					el("div", "clk-alarm-time", this.#formatAlarm(a.time)),
					el("div", "clk-city-sub", a.label || "Alarm"),
				);
				const sw = el("input", "aether-switch") as HTMLInputElement;
				sw.type = "checkbox";
				sw.checked = a.enabled;
				sw.addEventListener("change", () => {
					this.alarms = this.alarms.map((x) =>
						x.id === a.id
							? { ...x, enabled: sw.checked, lastFired: undefined }
							: x,
					);
					render();
				});
				const remove = el("button", "clk-remove");
				remove.title = "Delete alarm";
				remove.innerHTML =
					'<span class="material-symbols-outlined">close</span>';
				remove.style.right = "52px";
				remove.addEventListener("click", () => {
					this.alarms = this.alarms.filter((x) => x.id !== a.id);
					render();
				});
				row.append(info, remove, sw);
				body.appendChild(row);
			}
			const add = el("div", "clk-add");
			const time = el("input", "clk-input") as HTMLInputElement;
			time.type = "time";
			const now = new Date(Date.now() + 60_000);
			time.value =
				ClockApp.pad(now.getHours()) + ":" + ClockApp.pad(now.getMinutes());
			const label = el("input", "clk-input") as HTMLInputElement;
			label.placeholder = "Label";
			const btn = el("button", "clk-btn", "Add");
			btn.addEventListener("click", () => {
				if (!time.value) return;
				this.alarms = [
					...this.alarms,
					{
						id: Math.random().toString(36).slice(2),
						time: time.value,
						label: label.value.trim(),
						enabled: true,
					},
				];
				render();
			});
			add.append(time, label, btn);
			body.appendChild(add);
			return null;
		};

		/* stopwatch */
		const stopwatch = () => {
			const sw = this.stopwatch;
			const big = el("div", "clk-big");
			const controls = el("div", "clk-controls");
			const left = el("button", "clk-round") as HTMLButtonElement;
			const right = el("button", "clk-round") as HTMLButtonElement;
			controls.append(left, right);
			const laps = el("div");
			body.append(big, controls, laps);
			const elapsed = () =>
				sw.elapsed + (sw.running ? Date.now() - sw.startedAt : 0);
			const paintButtons = () => {
				left.textContent = sw.running ? "Lap" : "Reset";
				left.disabled = !sw.running && elapsed() === 0;
				right.textContent = sw.running ? "Stop" : "Start";
				right.className = "clk-round " + (sw.running ? "stop" : "go");
			};
			const paintLaps = () => {
				laps.textContent = "";
				const all = [...sw.laps];
				if (sw.running || elapsed() > 0)
					all.push(elapsed() - sw.laps.reduce((a, b) => a + b, 0));
				const done = sw.laps;
				const best = done.length > 1 ? Math.min(...done) : -1;
				const worst = done.length > 1 ? Math.max(...done) : -1;
				for (let i = all.length - 1; i >= 0; i--) {
					const row = el(
						"div",
						"clk-lap" +
							(all[i] === best && i < done.length
								? " best"
								: all[i] === worst && i < done.length
									? " worst"
									: ""),
					);
					row.dataset.live =
						i === all.length - 1 && i >= done.length ? "1" : "";
					row.append(
						el("span", "", "Lap " + (i + 1)),
						el("span", "", ClockApp.formatElapsed(all[i]!)),
					);
					laps.appendChild(row);
				}
			};
			right.addEventListener("click", () => {
				if (sw.running) {
					sw.elapsed = elapsed();
					sw.running = false;
				} else {
					sw.startedAt = Date.now();
					sw.running = true;
				}
				paintButtons();
				paintLaps();
			});
			left.addEventListener("click", () => {
				if (sw.running)
					sw.laps.push(elapsed() - sw.laps.reduce((a, b) => a + b, 0));
				else
					Object.assign(sw, {
						startedAt: 0,
						elapsed: 0,
						running: false,
						laps: [],
					});
				paintButtons();
				paintLaps();
			});
			paintButtons();
			paintLaps();
			return () => {
				const t = elapsed();
				big.textContent = ClockApp.formatElapsed(t);
				const live = laps.querySelector<HTMLElement>(
					'[data-live="1"] span:last-child',
				);
				if (live)
					live.textContent = ClockApp.formatElapsed(
						t - sw.laps.reduce((a, b) => a + b, 0),
					);
			};
		};

		/* timer */
		const timer = () => {
			const t = this.timer;
			if (!t.active) {
				const presets = el("div", "clk-presets");
				for (const [label, ms] of [
					["1 min", 60e3],
					["3 min", 180e3],
					["5 min", 300e3],
					["10 min", 600e3],
					["15 min", 900e3],
					["25 min", 1500e3],
				] as const) {
					const b = el("button", "clk-preset", label);
					b.addEventListener("click", () => {
						this.startTimer(ms);
						render();
					});
					presets.appendChild(b);
				}
				const custom = el("div", "clk-add");
				const mins = el("input", "clk-input") as HTMLInputElement;
				mins.type = "number";
				mins.min = "0";
				mins.placeholder = "Minutes";
				const secs = el("input", "clk-input") as HTMLInputElement;
				secs.type = "number";
				secs.min = "0";
				secs.max = "59";
				secs.placeholder = "Seconds";
				const go = el("button", "clk-btn", "Start");
				go.addEventListener("click", () => {
					this.startTimer(
						(Number(mins.value) || 0) * 60e3 + (Number(secs.value) || 0) * 1e3,
					);
					render();
				});
				custom.append(mins, secs, go);
				body.append(presets, custom);
				return null;
			}
			const ring = el("div", "clk-ring");
			const big = el("div", "clk-big");
			ring.appendChild(big);
			const controls = el("div", "clk-controls");
			const cancel = el("button", "clk-round", "Cancel");
			const toggle = el("button", "clk-round");
			controls.append(cancel, toggle);
			body.append(ring, controls);
			const paint = () => {
				toggle.textContent = t.running ? "Pause" : "Resume";
				toggle.className = "clk-round " + (t.running ? "stop" : "go");
			};
			cancel.addEventListener("click", () => {
				this.cancelTimer();
				render();
			});
			toggle.addEventListener("click", () => {
				if (this.timer.running) this.pauseTimer();
				else this.resumeTimer();
				paint();
			});
			paint();
			return () => {
				const cur = this.timer;
				if (!cur.active) return render();
				const left = cur.running
					? Math.max(0, cur.endsAt - Date.now())
					: cur.remaining;
				big.textContent = ClockApp.formatRemaining(left);
				ring.style.setProperty("--p", String(cur.total ? left / cur.total : 0));
			};
		};

		let update: ((now: Date) => void) | null = null;
		const render = () => {
			for (const [id, b] of Object.entries(buttons))
				b.classList.toggle("is-selected", id === tab);
			body.textContent = "";
			lastSecond = -1;
			update =
				tab === "world"
					? world()
					: tab === "alarm"
						? alarms()
						: tab === "stopwatch"
							? stopwatch()
							: timer();
		};

		// One frame loop for whichever tab is showing. The stopwatch needs
		// every frame for its centiseconds; the others only repaint when the
		// second changes. Hidden or minimised windows skip the work.
		const loop = () => {
			frame = requestAnimationFrame(loop);
			if (document.hidden || win.element.style.display === "none" || !update)
				return;
			const now = new Date();
			const second = Math.floor(now.getTime() / 1000);
			if (tab !== "stopwatch" && second === lastSecond) return;
			lastSecond = second;
			update(now);
		};
		render();
		frame = requestAnimationFrame(loop);
		win.addEventListener("close", () => cancelAnimationFrame(frame));
		return win;
	}
}
