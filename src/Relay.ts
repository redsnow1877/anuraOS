/**
 * Dimension — the browsing relay
 * ---------------------------------------------------------------------------
 * No web page can open a network connection by itself, so the browser (and
 * everything else that goes online from inside Dimension) sends its
 * connections through a Wisp relay. This picks one that's actually up.
 *
 * In order of preference:
 *   1. Your laptop: dimension-relay.mjs running on this computer, at
 *      ws://localhost:7171. Fastest and private. Only tried once you've said
 *      you run it: probing localhost makes Chrome ask about local network
 *      access, and nobody should get that prompt unasked.
 *   2. The server Dimension is hosted on, when it has one (a self-hosted
 *      anuraOS server does; GitHub Pages never will).
 *   3. Public relays, fastest first.
 *
 * In Auto (the default) it re-checks every minute: if the relay in use stops
 * answering it moves to the next one, and if you start the laptop relay
 * later it moves over to that. Picking one by hand (in the browser or in
 * Settings) turns Auto off.
 */

interface RelayCandidate {
	id: string;
	name: string;
	url: string;
	note: string;
}

interface RelayProbe {
	ok: boolean;
	ms?: number;
	reason?: string;
}

class DimensionRelay {
	static readonly LOCAL = "ws://localhost:7171/";
	static readonly PUBLIC: RelayCandidate[] = [
		{
			id: "mercury",
			name: "Mercury Workshop",
			url: "wss://wisp.mercurywork.shop/",
			note: "Public relay from the anuraOS developers",
		},
		{
			id: "anura",
			name: "anura.pro",
			url: "wss://anura.pro/",
			note: "The public anuraOS demo server",
		},
	];
	static readonly KEY_MODE = "relay-mode"; // "auto" | "manual"
	static readonly KEY_LOCAL = "relay-local"; // the laptop relay is set up

	static events = new EventTarget();
	static state: "idle" | "checking" | "ok" | "down" = "idle";
	static latency: number | null = null;
	static #timer = 0;
	static #picking: Promise<string | null> | null = null;

	static get auto(): boolean {
		try {
			return anura.settings.get(this.KEY_MODE) !== "manual";
		} catch {
			return true;
		}
	}

	static get localEnabled(): boolean {
		try {
			return !!anura.settings.get(this.KEY_LOCAL);
		} catch {
			return false;
		}
	}

	static get current(): string {
		try {
			return anura.net?.wispServer || anura.settings.get("wisp-url") || "";
		} catch {
			return "";
		}
	}

	static sameOrigin(): string {
		return (
			(location.protocol === "https:" ? "wss://" : "ws://") +
			location.host +
			"/"
		);
	}

	/** Static hosts that can't run a relay: not worth a probe. */
	static get staticHost(): boolean {
		return /\.github\.io$|\.pages\.dev$|\.netlify\.app$|\.vercel\.app$/.test(
			location.hostname,
		);
	}

	/** Everything worth offering, in order of preference. */
	static candidates(): RelayCandidate[] {
		const list: RelayCandidate[] = [
			{
				id: "local",
				name: "Your laptop",
				url: this.LOCAL,
				note: "dimension-relay on this computer",
			},
		];
		if (!this.staticHost)
			list.push({
				id: "self",
				name: "This site",
				url: this.sameOrigin(),
				note: `The server ${BRANDING.name} is running on`,
			});
		return [...list, ...this.PUBLIC];
	}

	static name(url: string): string {
		return this.candidates().find((c) => c.url === url)?.name || url;
	}

	static probe(url: string, timeout = 5000): Promise<RelayProbe> {
		return Networking.probeWisp(url, timeout);
	}

	/** Switch to `url` now. `byHand` turns Auto off. */
	static async use(url: string, byHand = false) {
		if (byHand) await anura.settings.set(this.KEY_MODE, "manual");
		if (url !== this.current) {
			anura.net.setWispServer(url);
			await anura.settings.set("wisp-url", url);
		}
		this.#emit();
	}

	static async setAuto(on: boolean) {
		await anura.settings.set(this.KEY_MODE, on ? "auto" : "manual");
		if (on) await this.pick(true);
		this.#emit();
	}

	/**
	 * Probe the candidates and move to the best one that answers. Returns the
	 * relay in use afterwards, or null when nothing answered.
	 */
	static pick(announce = false): Promise<string | null> {
		if (this.#picking) return this.#picking;
		this.#picking = (async () => {
			this.state = "checking";
			this.#emit();
			const list = this.candidates().filter(
				(c) => c.id !== "local" || this.localEnabled,
			);
			const results = await Promise.all(
				list.map(async (c) => ({ c, r: await this.probe(c.url) })),
			);
			const up = results.filter((x) => x.r.ok);
			// The laptop and the home server win whenever they answer; among
			// public relays, the quickest.
			const best =
				up.find((x) => x.c.id === "local") ||
				up.find((x) => x.c.id === "self") ||
				up.sort((a, b) => (a.r.ms ?? 1e9) - (b.r.ms ?? 1e9))[0];
			if (!best) {
				this.state = "down";
				this.latency = null;
				this.#emit();
				if (announce)
					AetherIsland.alert({
						icon: "cloud_off",
						tone: "red",
						title: "Browsing is offline",
						body: "No relay answered. Run the relay on your laptop to browse.",
						actions: [
							{
								label: "Set up",
								primary: true,
								run: () => anura.apps["anura.settings"]?.open(["browsing"]),
							},
						],
					});
				return null;
			}
			const changed = best.c.url !== this.current;
			await this.use(best.c.url);
			this.state = "ok";
			this.latency = best.r.ms ?? null;
			this.#emit();
			if (changed && announce)
				AetherIsland.alert({
					icon: best.c.id === "local" ? "laptop_chromebook" : "public",
					tone: best.c.id === "local" ? "green" : "accent",
					title:
						best.c.id === "local"
							? "Browsing through your laptop"
							: `Browsing through ${best.c.name}`,
					body: `Relay answered in ${best.r.ms} ms.`,
				});
			return best.c.url;
		})().finally(() => {
			this.#picking = null;
		});
		return this.#picking;
	}

	/** Is the relay in use still answering? */
	static async check(): Promise<RelayProbe> {
		this.state = "checking";
		this.#emit();
		const r = await this.probe(this.current);
		this.state = r.ok ? "ok" : "down";
		this.latency = r.ok ? (r.ms ?? null) : null;
		this.#emit();
		return r;
	}

	static async #heartbeat() {
		if (!this.auto || document.hidden) return;
		const onLocal = this.current === this.LOCAL;
		// Not on the laptop relay but it's set up: has it come up?
		if (this.localEnabled && !onLocal) {
			const r = await this.probe(this.LOCAL, 2500);
			if (r.ok) {
				await this.use(this.LOCAL);
				this.state = "ok";
				this.latency = r.ms ?? null;
				this.#emit();
				AetherIsland.alert({
					icon: "laptop_chromebook",
					tone: "green",
					title: "Browsing through your laptop",
					body: `Your relay came online. ${r.ms} ms.`,
				});
				return;
			}
		}
		const r = await this.check();
		if (!r.ok) await this.pick(true);
	}

	/** Start of day: make sure there's a relay that works. */
	static init() {
		const go = async () => {
			if (this.auto) {
				// The saved relay first: if it answers, nothing changes.
				const saved = this.current;
				const r = saved ? await this.probe(saved, 4000) : { ok: false };
				const preferLocal = this.localEnabled && saved !== this.LOCAL;
				if (!r.ok || preferLocal) await this.pick(!r.ok);
				else {
					this.state = "ok";
					this.latency = (r as RelayProbe).ms ?? null;
					this.#emit();
				}
			} else await this.check();
		};
		setTimeout(() => void go(), 1500);
		clearInterval(this.#timer);
		this.#timer = window.setInterval(() => void this.#heartbeat(), 60000);
	}

	static #emit() {
		this.events.dispatchEvent(new Event("change"));
	}

	/* ---- the laptop relay -------------------------------------------------- */

	/** Where this deployment serves the relay script. */
	static get scriptURL(): string {
		return new URL("relay/dimension-relay.mjs", document.baseURI).href;
	}

	/**
	 * A one-file launcher for the relay. It fetches the script from this site
	 * (so it's always the version that matches), installs Node.js if it's
	 * missing (with permission), allows this site's address, and starts it.
	 */
	static launcher(os: "windows" | "unix"): { name: string; blob: Blob } {
		const script = this.scriptURL;
		const origin = location.origin;
		if (os === "windows") {
			const bat = [
				"@echo off",
				"title Dimension relay",
				"setlocal",
				'cd /d "%~dp0"',
				"where node >nul 2>nul",
				"if errorlevel 1 (",
				"  echo Dimension relay needs Node.js, which isn't installed.",
				'  choice /m "Install it now with winget"',
				"  if errorlevel 2 exit /b 1",
				"  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements",
				'  set "PATH=%PATH%;%ProgramFiles%\\nodejs"',
				")",
				"echo Fetching the relay...",
				`powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri '${script}' -OutFile 'dimension-relay.mjs'"`,
				"if not exist dimension-relay.mjs (",
				"  echo Couldn't download the relay. Check your connection and try again.",
				"  pause",
				"  exit /b 1",
				")",
				`node dimension-relay.mjs --origin ${origin}`,
				"pause",
				"",
			].join("\r\n");
			return {
				name: "Dimension Relay.bat",
				blob: new Blob([bat], { type: "application/octet-stream" }),
			};
		}
		const sh = [
			"#!/bin/sh",
			"# Dimension relay: chmod +x this file and run it, or: sh dimension-relay.sh",
			'cd "$(dirname "$0")"',
			"if ! command -v node >/dev/null 2>&1; then",
			'  echo "Dimension relay needs Node.js: https://nodejs.org (or: brew install node)"',
			"  exit 1",
			"fi",
			`curl -fsSL '${script}' -o dimension-relay.mjs || { echo "Couldn't download the relay."; exit 1; }`,
			`exec node dimension-relay.mjs --origin ${origin}`,
			"",
		].join("\n");
		return {
			name: "dimension-relay.sh",
			blob: new Blob([sh], { type: "application/x-sh" }),
		};
	}

	static download(os: "windows" | "unix") {
		const { name, blob } = this.launcher(os);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	}

	/** The user says the relay is running: remember, and go find it. */
	static async enableLocal(on = true): Promise<RelayProbe> {
		await anura.settings.set(this.KEY_LOCAL, on);
		if (!on) {
			if (this.current === this.LOCAL) await this.pick();
			return { ok: false };
		}
		const r = await this.probe(this.LOCAL, 6000);
		if (r.ok) {
			await anura.settings.set(this.KEY_MODE, "auto");
			await this.use(this.LOCAL);
			this.state = "ok";
			this.latency = r.ms ?? null;
			this.#emit();
		}
		return r;
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).DimensionRelay = DimensionRelay;

/**
 * Settings › Browsing: which relay is in use, every relay with a live test,
 * and the laptop relay's download and switch.
 */
function dimensionRelayPanel(): HTMLElement {
	const R = DimensionRelay;
	const el = (tag: string, cls = "", text = "") => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text) e.textContent = text;
		return e;
	};
	const icon = (name: string) => el("span", "material-symbols-outlined", name);
	const root = el("div", "relay-panel");
	const probes = new Map<string, RelayProbe | "testing">();

	// ---- status ---------------------------------------------------------
	const status = el("div", "rl-status");
	const dot = el("i", "rl-dot");
	const statusText = el("div", "rl-status-text");
	const test = el("button", "rl-btn", "Test");
	const autoWrap = el("label", "rl-auto");
	const autoBox = document.createElement("input");
	autoBox.type = "checkbox";
	autoBox.className = "aether-switch";
	autoWrap.append(el("span", "", "Auto"), autoBox);
	status.append(dot, statusText, autoWrap, test);
	test.addEventListener("click", () => {
		void R.check();
		testAll();
	});
	autoBox.addEventListener("change", () => void R.setAuto(autoBox.checked));

	// ---- the list -------------------------------------------------------
	const list = el("div", "rl-list");

	// ---- the laptop -----------------------------------------------------
	const laptop = el("div", "rl-laptop");
	const lhead = el("div", "rl-laptop-head");
	lhead.append(
		icon("laptop_chromebook"),
		el("div", "rl-laptop-title", "Run the relay on your laptop"),
	);
	const ltext = el(
		"p",
		"rl-laptop-text",
		"The fastest and most private way to browse: your own computer opens the connections instead of a stranger's server. Download the launcher, open it, and keep its window open while you browse. It only answers this site, and won't reach devices on your network.",
	);
	const lbtns = el("div", "rl-laptop-btns");
	const win = el("button", "rl-btn is-primary");
	win.append(icon("download"), el("span", "", "Windows"));
	const unix = el("button", "rl-btn");
	unix.append(icon("download"), el("span", "", "macOS / Linux"));
	win.addEventListener("click", () => R.download("windows"));
	unix.addEventListener("click", () => R.download("unix"));
	const running = el("label", "rl-running");
	const runBox = document.createElement("input");
	runBox.type = "checkbox";
	runBox.className = "aether-switch";
	running.append(el("span", "", "It's running"), runBox);
	lbtns.append(win, unix, running);
	const lnote = el("div", "rl-laptop-note");
	runBox.addEventListener("change", async () => {
		lnote.textContent = runBox.checked ? "Looking for it…" : "";
		const r = await R.enableLocal(runBox.checked);
		if (!runBox.checked) return;
		probes.set(R.LOCAL, r);
		lnote.textContent = r.ok
			? `Found it: ${r.ms} ms. Browsing goes through your laptop now.`
			: "Not answering yet. Start the launcher; Chrome may ask to allow access to apps on this device, so click Allow. Dimension will switch to it as soon as it's up.";
		render();
	});
	laptop.append(lhead, ltext, lbtns, lnote);

	root.append(status, list, laptop);

	function render() {
		autoBox.checked = R.auto;
		runBox.checked = R.localEnabled;
		const cur = R.current;
		dot.dataset.state = R.state;
		statusText.textContent =
			R.state === "checking"
				? "Checking…"
				: R.state === "down"
					? "No relay is answering"
					: `${R.name(cur)}${R.latency != null ? ` · ${R.latency} ms` : ""}`;

		list.replaceChildren(
			...R.candidates()
				.filter((c) => c.id !== "local" || R.localEnabled)
				.map((c) => {
					const p = probes.get(c.url);
					const row = el("button", "rl-row" + (c.url === cur ? " is-on" : ""));
					const text = el("span", "rl-row-text");
					text.append(
						el("span", "rl-row-name", c.name),
						el("span", "rl-row-note", c.note),
					);
					const st = el("span", "rl-row-status");
					const sdot = el("i", "rl-dot");
					sdot.dataset.state =
						p === "testing" ? "checking" : p ? (p.ok ? "ok" : "down") : "idle";
					st.append(
						sdot,
						document.createTextNode(
							p === "testing"
								? "Testing…"
								: p
									? p.ok
										? `${p.ms} ms`
										: p.reason || "Unreachable"
									: "",
						),
					);
					row.append(el("span", "rl-radio"), text, st);
					row.addEventListener(
						"click",
						() => void R.use(c.url, true).then(render),
					);
					return row;
				}),
		);
	}

	function testAll() {
		for (const c of R.candidates()) {
			if (c.id === "local" && !R.localEnabled) continue;
			probes.set(c.url, "testing");
			void R.probe(c.url).then((r) => {
				probes.set(c.url, r);
				render();
			});
		}
		render();
	}

	R.events.addEventListener("change", () => {
		if (root.isConnected) render();
	});
	render();
	// Test once it's on screen.
	requestAnimationFrame(() => setTimeout(testAll, 200));
	return root;
}

(globalThis as any).dimensionRelayPanel = dimensionRelayPanel;
