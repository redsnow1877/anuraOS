/**
 * Aether — Spotlight
 * ---------------------------------------------------------------------------
 * A system-wide search palette (Ctrl+Space, Ctrl+K, or the menu bar's search
 * icon). One text field, several providers, keyboard-first:
 *
 *   Applications   every registered, non-hidden app (recently used first)
 *   Windows        open windows, by title — Enter brings one forward
 *   Commands       anything registered with AetherCommands (Lock Screen,
 *                  Mission Control, the settings toggles below, …)
 *   Calculator     "12*(3+4)" evaluates inline via the Calculator app's own
 *                  parser — never eval(); Enter copies the result
 *   Conversion     "5 km to mi", "72 f in c", "3 gb to mb"
 *   Files          filenames across the filesystem, indexed lazily
 *   Web            a URL opens in the browser; anything else can be searched
 *
 * Built with plain DOM rather than dreamland JSX: the result list is rebuilt
 * on every keystroke, and reactive bindings would only add overhead here.
 */

interface SpotlightResult {
	id: string;
	title: string;
	subtitle?: string;
	/** An image URL, or a Material Symbols name when `symbol` is true. */
	icon: string;
	symbol?: boolean;
	score: number;
	/** Right-aligned hint: a shortcut, or what Enter will do. */
	accessory?: string;
	run: () => void;
	/** Text to highlight the query in; defaults to title. */
	matchText?: string;
}

interface SpotlightProvider {
	id: string;
	label: string;
	limit: number;
	search: (query: string) => SpotlightResult[];
}

/**
 * Case-insensitive match score, or -1 for no match. Ranks, best first:
 * exact → prefix → word-prefix → initials → substring → in-order subsequence.
 */
function aetherMatch(query: string, text: string): number {
	const q = query.toLowerCase().trim();
	const t = (text || "").toLowerCase();
	if (!q || !t) return -1;
	if (t === q) return 1000;
	if (t.startsWith(q)) return 900 - Math.min(99, t.length - q.length);
	const words = t.split(/[\s\-_./:()]+/).filter(Boolean);
	const wordIndex = words.findIndex((w) => w.startsWith(q));
	if (wordIndex >= 0) return 760 - wordIndex * 10;
	const initials = words.map((w) => w[0]).join("");
	if (q.length > 1 && initials.startsWith(q)) return 650;
	const idx = t.indexOf(q);
	if (idx >= 0) return 520 - Math.min(100, idx);
	// In-order subsequence ("sttng" → "settings"), but only when the letters
	// stay close together: a scattered match like "calc" inside
	// "v86 terminal" is noise, not a result.
	if (q.length < 3) return -1;
	let from = 0;
	let last = -1;
	let gaps = 0;
	for (const ch of q) {
		if (ch === " ") continue;
		const found = t.indexOf(ch, from);
		if (found < 0) return -1;
		if (last >= 0) gaps += found - last - 1;
		last = found;
		from = found + 1;
	}
	if (gaps > q.length) return -1;
	return 300 - gaps * 30;
}

/* ---------------------------------------------------------------------- */
/* Unit conversion                                                         */
/* ---------------------------------------------------------------------- */

const AETHER_UNITS: Record<
	string,
	{ dim: string; factor: number; name: string }
> = {
	// length, metres
	mm: { dim: "length", factor: 0.001, name: "millimetres" },
	cm: { dim: "length", factor: 0.01, name: "centimetres" },
	m: { dim: "length", factor: 1, name: "metres" },
	km: { dim: "length", factor: 1000, name: "kilometres" },
	in: { dim: "length", factor: 0.0254, name: "inches" },
	ft: { dim: "length", factor: 0.3048, name: "feet" },
	yd: { dim: "length", factor: 0.9144, name: "yards" },
	mi: { dim: "length", factor: 1609.344, name: "miles" },
	// mass, grams
	mg: { dim: "mass", factor: 0.001, name: "milligrams" },
	g: { dim: "mass", factor: 1, name: "grams" },
	kg: { dim: "mass", factor: 1000, name: "kilograms" },
	oz: { dim: "mass", factor: 28.349523125, name: "ounces" },
	lb: { dim: "mass", factor: 453.59237, name: "pounds" },
	// data, bytes (binary multiples, as a file manager shows them)
	b: { dim: "data", factor: 1, name: "bytes" },
	kb: { dim: "data", factor: 1024, name: "kilobytes" },
	mb: { dim: "data", factor: 1024 ** 2, name: "megabytes" },
	gb: { dim: "data", factor: 1024 ** 3, name: "gigabytes" },
	tb: { dim: "data", factor: 1024 ** 4, name: "terabytes" },
	// time, seconds
	ms: { dim: "time", factor: 0.001, name: "milliseconds" },
	s: { dim: "time", factor: 1, name: "seconds" },
	min: { dim: "time", factor: 60, name: "minutes" },
	h: { dim: "time", factor: 3600, name: "hours" },
	day: { dim: "time", factor: 86400, name: "days" },
	week: { dim: "time", factor: 604800, name: "weeks" },
	// volume, litres
	ml: { dim: "volume", factor: 0.001, name: "millilitres" },
	l: { dim: "volume", factor: 1, name: "litres" },
	gal: { dim: "volume", factor: 3.785411784, name: "US gallons" },
	cup: { dim: "volume", factor: 0.2365882365, name: "US cups" },
	// temperature is affine; handled separately
	c: { dim: "temp", factor: 1, name: "°C" },
	f: { dim: "temp", factor: 1, name: "°F" },
	k: { dim: "temp", factor: 1, name: "kelvin" },
};

const AETHER_UNIT_ALIASES: Record<string, string> = {
	millimeter: "mm",
	millimeters: "mm",
	millimetre: "mm",
	millimetres: "mm",
	centimeter: "cm",
	centimeters: "cm",
	centimetre: "cm",
	centimetres: "cm",
	meter: "m",
	meters: "m",
	metre: "m",
	metres: "m",
	kilometer: "km",
	kilometers: "km",
	kilometre: "km",
	kilometres: "km",
	inch: "in",
	inches: "in",
	foot: "ft",
	feet: "ft",
	yard: "yd",
	yards: "yd",
	mile: "mi",
	miles: "mi",
	gram: "g",
	grams: "g",
	kilogram: "kg",
	kilograms: "kg",
	kgs: "kg",
	ounce: "oz",
	ounces: "oz",
	pound: "lb",
	pounds: "lb",
	lbs: "lb",
	byte: "b",
	bytes: "b",
	kib: "kb",
	mib: "mb",
	gib: "gb",
	tib: "tb",
	sec: "s",
	secs: "s",
	second: "s",
	seconds: "s",
	mins: "min",
	minute: "min",
	minutes: "min",
	hr: "h",
	hrs: "h",
	hour: "h",
	hours: "h",
	days: "day",
	d: "day",
	weeks: "week",
	wk: "week",
	liter: "l",
	liters: "l",
	litre: "l",
	litres: "l",
	milliliter: "ml",
	milliliters: "ml",
	gallon: "gal",
	gallons: "gal",
	cups: "cup",
	"°c": "c",
	celsius: "c",
	"°f": "f",
	fahrenheit: "f",
	kelvin: "k",
};

function aetherUnit(raw: string): string | null {
	const u = raw.toLowerCase();
	if (AETHER_UNITS[u]) return u;
	return AETHER_UNIT_ALIASES[u] || null;
}

function aetherConvert(
	query: string,
): { value: number; from: string; to: string; result: number } | null {
	const m = query
		.trim()
		.match(
			/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z°]+)\s+(?:to|in|as|->|=)\s+([a-zA-Z°]+)$/,
		);
	if (!m) return null;
	const value = parseFloat(m[1]!);
	const from = aetherUnit(m[2]!);
	const to = aetherUnit(m[3]!);
	if (!from || !to || from === to) return null;
	const a = AETHER_UNITS[from]!;
	const b = AETHER_UNITS[to]!;
	if (a.dim !== b.dim) return null;
	let result: number;
	if (a.dim === "temp") {
		const celsius =
			from === "c"
				? value
				: from === "f"
					? ((value - 32) * 5) / 9
					: value - 273.15;
		result =
			to === "c"
				? celsius
				: to === "f"
					? (celsius * 9) / 5 + 32
					: celsius + 273.15;
	} else {
		result = (value * a.factor) / b.factor;
	}
	return { value, from, to, result };
}

function aetherFormatNumber(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0))
		return n.toExponential(6);
	return parseFloat(n.toPrecision(12)).toLocaleString(undefined, {
		maximumFractionDigits: 10,
	});
}

/* ---------------------------------------------------------------------- */
/* File index                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Built on first use and refreshed at most every 30s. Skips the OS's own
 * offline cache and mounted OPFS (which can be arbitrarily large), and is
 * capped so a huge tree can't stall the palette.
 */
class AetherFileIndex {
	static entries: { path: string; name: string; dir: boolean }[] = [];
	static builtAt = 0;
	static building: Promise<void> | null = null;
	static readonly SKIP = ["/anura_files", "/opfs", "/proc", "/dev"];
	static readonly MAX = 4000;

	static ensure(): Promise<void> | null {
		if (Date.now() - this.builtAt < 30_000) return null;
		if (this.building) return this.building;
		this.building = this.build().finally(() => {
			this.building = null;
		});
		return this.building;
	}

	static async build() {
		const out: { path: string; name: string; dir: boolean }[] = [];
		const queue: [string, number][] = [["/", 0]];
		const fs = anura.fs.promises;
		while (queue.length && out.length < this.MAX) {
			const [dir, depth] = queue.shift()!;
			let names: string[];
			try {
				names = await fs.readdir(dir);
			} catch {
				continue;
			}
			for (const name of names) {
				const path = (dir === "/" ? "" : dir) + "/" + name;
				if (this.SKIP.includes(path)) continue;
				let isDir = false;
				try {
					isDir = (await fs.stat(path)).isDirectory();
				} catch {
					continue;
				}
				out.push({ path, name, dir: isDir });
				if (isDir && depth < 6) queue.push([path, depth + 1]);
				if (out.length >= this.MAX) break;
			}
		}
		this.entries = out;
		this.builtAt = Date.now();
	}

	static icon(name: string, dir: boolean): string {
		if (dir) return "folder";
		const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
		if (
			["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)
		)
			return "image";
		if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "music_note";
		if (["mp4", "webm", "mkv", "mov"].includes(ext)) return "movie";
		if (
			["js", "mjs", "ts", "tsx", "json", "css", "html", "sh", "py"].includes(
				ext,
			)
		)
			return "code";
		if (["zip", "tar", "gz", "7z"].includes(ext)) return "folder_zip";
		if (ext === "app") return "apps";
		return "description";
	}
}

/* ---------------------------------------------------------------------- */
/* Spotlight                                                               */
/* ---------------------------------------------------------------------- */

class AetherSpotlight {
	static instance: AetherSpotlight | null = null;
	static readonly RECENT_KEY = "aether.spotlight.recent";

	/**
	 * Providers contributed by apps (Notes registers one). They're searched
	 * after the built-ins, and `search` must be synchronous — keep an index
	 * and return from it.
	 */
	static readonly extraProviders: SpotlightProvider[] = [];

	static registerProvider(provider: SpotlightProvider) {
		const i = AetherSpotlight.extraProviders.findIndex(
			(p) => p.id === provider.id,
		);
		if (i >= 0) AetherSpotlight.extraProviders[i] = provider;
		else AetherSpotlight.extraProviders.push(provider);
	}

	element: HTMLElement;
	private panel: HTMLElement;
	private input: HTMLInputElement;
	private list: HTMLElement;
	private toast: HTMLElement;
	private items: { el: HTMLElement; result: SpotlightResult }[] = [];
	private selected = 0;
	private isOpen = false;
	private providers: SpotlightProvider[] = [];

	static init(): AetherSpotlight {
		if (!this.instance) this.instance = new AetherSpotlight();
		return this.instance;
	}

	static toggle() {
		const s = AetherSpotlight.init();
		if (s.isOpen) s.close();
		else s.open();
	}

	constructor() {
		this.element = document.createElement("div");
		this.element.id = "spotlight";
		this.element.setAttribute("role", "dialog");
		this.element.setAttribute("aria-label", "Spotlight search");
		this.element.addEventListener("pointerdown", (e) => {
			if (e.target === this.element) this.close();
		});

		this.panel = document.createElement("div");
		this.panel.className = "spotlight-panel";

		const bar = document.createElement("div");
		bar.className = "spotlight-bar";
		const glass = document.createElement("span");
		glass.className = "material-symbols-outlined spotlight-glass";
		glass.textContent = "search";
		this.input = document.createElement("input");
		this.input.className = "spotlight-input";
		this.input.placeholder = "Search apps, files, commands, or type math";
		this.input.spellcheck = false;
		this.input.autocomplete = "off";
		this.input.setAttribute("aria-autocomplete", "list");
		const esc = document.createElement("kbd");
		esc.className = "spotlight-kbd";
		esc.textContent = "esc";
		bar.append(glass, this.input, esc);

		this.list = document.createElement("div");
		this.list.className = "spotlight-results";
		this.list.setAttribute("role", "listbox");

		this.toast = document.createElement("div");
		this.toast.className = "spotlight-toast";

		const foot = document.createElement("div");
		foot.className = "spotlight-foot";
		foot.innerHTML =
			"<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>⏎</kbd> open</span><span><kbd>esc</kbd> close</span>";

		this.panel.append(bar, this.list, foot, this.toast);
		this.element.appendChild(this.panel);
		document.body.appendChild(this.element);

		this.input.addEventListener("input", () => this.search());
		this.input.addEventListener("keydown", (e) => this.onKey(e));

		this.providers = this.buildProviders();
		this.registerCommands();
	}

	/* ---- open / close ------------------------------------------------- */

	open(query = "") {
		if (this.isOpen) {
			this.input.focus();
			return;
		}
		this.isOpen = true;
		try {
			launcher?.hide?.();
			quickSettings?.close?.();
			calendar?.close?.();
		} catch {
			/* shell pieces may not exist yet */
		}
		this.element.classList.remove("is-closing");
		this.element.classList.add("is-open");
		this.input.value = query;
		this.search();
		requestAnimationFrame(() => this.input.focus());
		(globalThis as any).aetherSound?.play?.("launchpadOpen");
		// Warm the file index in the background so files are ready by the
		// time the user has typed a few characters.
		AetherFileIndex.ensure()?.then(() => {
			if (this.isOpen && this.input.value.trim()) this.search();
		});
	}

	close() {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.element.classList.add("is-closing");
		this.element.classList.remove("is-open");
		setTimeout(() => this.element.classList.remove("is-closing"), 180);
		this.input.blur();
	}

	/* ---- searching ---------------------------------------------------- */

	private recent(): string[] {
		try {
			const r = anura.settings.get(AetherSpotlight.RECENT_KEY);
			return Array.isArray(r) ? r : [];
		} catch {
			return [];
		}
	}

	private remember(id: string) {
		const next = [id, ...this.recent().filter((r) => r !== id)].slice(0, 8);
		try {
			anura.settings.set(AetherSpotlight.RECENT_KEY, next);
		} catch {
			/* settings unavailable */
		}
	}

	private search() {
		const query = this.input.value;
		const q = query.trim();
		const groups: { label: string; results: SpotlightResult[] }[] = [];

		if (!q) {
			const recent = this.recent()
				.map((id) => this.appResult(anura.apps[id], 0))
				.filter((r): r is SpotlightResult => !!r)
				.slice(0, 6);
			if (recent.length) groups.push({ label: "Recent", results: recent });
			const suggested = [
				"mission-control",
				"lock-screen",
				"shortcuts",
				"settings-feel",
				"wallpaper",
			]
				.map((id) => AetherCommands.list.find((c) => c.id === id))
				.filter((c): c is AetherCommand => !!c)
				.map((c) => this.commandResult(c, 0));
			if (suggested.length)
				groups.push({ label: "Suggestions", results: suggested });
			this.render(groups, "");
			return;
		}

		const all: { provider: SpotlightProvider; results: SpotlightResult[] }[] =
			[];
		// Built-ins first, then app-contributed providers, with web search
		// kept last so it stays the fallback at the bottom of the list.
		const ordered = [
			...this.providers.filter((p) => p.id !== "web"),
			...AetherSpotlight.extraProviders,
			...this.providers.filter((p) => p.id === "web"),
		];
		for (const provider of ordered) {
			let results: SpotlightResult[] = [];
			try {
				results = provider
					.search(q)
					.filter((r) => r.score >= 0)
					.sort((a, b) => b.score - a.score);
			} catch (e) {
				console.warn(`[spotlight] ${provider.id} failed`, e);
			}
			all.push({ provider, results });
		}

		// A single strong match gets promoted to "Top Hit", like macOS.
		let top: SpotlightResult | null = null;
		for (const { results } of all) {
			const best = results[0];
			if (best && best.score >= 600 && (!top || best.score > top.score))
				top = best;
		}
		if (top) groups.push({ label: "Top Hit", results: [top] });
		for (const { provider, results } of all) {
			const rest = results.filter((r) => r !== top).slice(0, provider.limit);
			if (rest.length) groups.push({ label: provider.label, results: rest });
		}
		this.render(groups, q);
	}

	private render(
		groups: { label: string; results: SpotlightResult[] }[],
		query: string,
	) {
		this.list.textContent = "";
		this.items = [];
		for (const group of groups) {
			const section = document.createElement("div");
			section.className = "spotlight-group";
			const heading = document.createElement("div");
			heading.className = "spotlight-group-title";
			heading.textContent = group.label;
			section.appendChild(heading);
			for (const result of group.results) {
				const row = this.row(result, query, group.label === "Top Hit");
				section.appendChild(row);
				this.items.push({ el: row, result });
			}
			this.list.appendChild(section);
		}
		if (!this.items.length) {
			const empty = document.createElement("div");
			empty.className = "spotlight-empty";
			empty.textContent = query
				? `No results for “${query}”`
				: "Start typing to search";
			this.list.appendChild(empty);
		}
		this.select(0);
	}

	private row(
		result: SpotlightResult,
		query: string,
		big: boolean,
	): HTMLElement {
		const row = document.createElement("div");
		row.className = "spotlight-item" + (big ? " is-top" : "");
		row.setAttribute("role", "option");

		const icon = document.createElement(result.symbol ? "span" : "img");
		if (result.symbol) {
			icon.className = "spotlight-icon material-symbols-outlined";
			icon.textContent = result.icon;
		} else {
			icon.className = "spotlight-icon";
			(icon as HTMLImageElement).src = result.icon;
			(icon as HTMLImageElement).alt = "";
			(icon as HTMLImageElement).loading = "lazy";
		}

		const text = document.createElement("div");
		text.className = "spotlight-text";
		const title = document.createElement("div");
		title.className = "spotlight-title";
		this.highlight(title, result.title, query);
		text.appendChild(title);
		if (result.subtitle) {
			const sub = document.createElement("div");
			sub.className = "spotlight-subtitle";
			sub.textContent = result.subtitle;
			text.appendChild(sub);
		}
		row.append(icon, text);

		if (result.accessory) {
			const acc = document.createElement("span");
			acc.className = "spotlight-accessory";
			acc.textContent = result.accessory;
			row.appendChild(acc);
		}

		row.addEventListener("pointermove", () => {
			const i = this.items.findIndex((it) => it.el === row);
			if (i >= 0 && i !== this.selected) this.select(i, false);
		});
		row.addEventListener("click", () => this.activate(result));
		return row;
	}

	/** Wrap the matched part of `text` in <mark>, built from text nodes. */
	private highlight(el: HTMLElement, text: string, query: string) {
		const q = query.toLowerCase();
		const t = text.toLowerCase();
		const idx = q ? t.indexOf(q) : -1;
		if (idx < 0) {
			el.textContent = text;
			return;
		}
		const mark = document.createElement("mark");
		mark.textContent = text.slice(idx, idx + q.length);
		el.append(text.slice(0, idx), mark, text.slice(idx + q.length));
	}

	private select(i: number, scroll = true) {
		if (!this.items.length) return;
		this.selected = (i + this.items.length) % this.items.length;
		this.items.forEach((it, j) => {
			const on = j === this.selected;
			it.el.classList.toggle("is-selected", on);
			it.el.setAttribute("aria-selected", String(on));
		});
		if (scroll)
			this.items[this.selected]!.el.scrollIntoView({ block: "nearest" });
	}

	private onKey(e: KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			this.select(this.selected + 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this.select(this.selected - 1);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = this.items[this.selected];
			if (item) this.activate(item.result);
		} else if (e.key === "Escape") {
			e.preventDefault();
			if (this.input.value) {
				this.input.value = "";
				this.search();
			} else this.close();
		}
	}

	private activate(result: SpotlightResult) {
		(globalThis as any).aetherSound?.play?.("click");
		if (!result.id.startsWith("copy:")) this.close();
		try {
			result.run();
		} catch (e) {
			console.error("[spotlight] action failed", e);
		}
	}

	private flash(message: string) {
		this.toast.textContent = message;
		this.toast.classList.remove("is-shown");
		void this.toast.offsetWidth;
		this.toast.classList.add("is-shown");
	}

	/* ---- providers ---------------------------------------------------- */

	private appResult(app: any, score: number): SpotlightResult | null {
		if (!app || app.hidden || !app.name) return null;
		return {
			id: "app:" + app.package,
			title: app.name,
			subtitle: "Application",
			icon: app.icon || "/assets/icons/generic.svg",
			score,
			accessory: "Open",
			run: () => {
				this.remember(app.package);
				app.open();
			},
		};
	}

	private commandResult(c: AetherCommand, score: number): SpotlightResult {
		return {
			id: "cmd:" + c.id,
			title: AetherCommands.title(c),
			subtitle: AetherCommands.subtitle(c) || "Command",
			icon: c.icon,
			symbol: true,
			score,
			accessory: c.shortcut
				? AetherShortcuts.pretty(c.shortcut).join(" ")
				: undefined,
			run: c.run,
		};
	}

	private buildProviders(): SpotlightProvider[] {
		const recentBoost = (pkg: string) => {
			const i = this.recent().indexOf(pkg);
			return i < 0 ? 0 : 40 - i * 4;
		};

		const calculator: SpotlightProvider = {
			id: "math",
			label: "Calculator",
			limit: 1,
			search: (q) => {
				const expr = q
					.replace(/^=/, "")
					.replace(/×/g, "*")
					.replace(/÷/g, "/")
					.trim();
				if (!/^[\d\s.+\-*/%^()]+$/.test(expr)) return [];
				if (!/\d/.test(expr) || !/[+\-*/%^]/.test(expr.replace(/^-/, "")))
					return [];
				let value: number;
				try {
					value = CalculatorApp.evaluate(expr);
				} catch {
					return [];
				}
				if (!Number.isFinite(value)) return [];
				const shown = aetherFormatNumber(value);
				return [
					{
						id: "copy:math",
						title: "= " + shown,
						subtitle: expr + "  ·  Enter to copy",
						icon: "calculate",
						symbol: true,
						score: 2000,
						accessory: "Copy",
						run: () => {
							navigator.clipboard?.writeText(String(value)).catch(() => {});
							this.flash("Copied " + shown);
						},
					},
				];
			},
		};

		const conversion: SpotlightProvider = {
			id: "convert",
			label: "Conversion",
			limit: 1,
			search: (q) => {
				const c = aetherConvert(q);
				if (!c) return [];
				const shown = aetherFormatNumber(c.result);
				const toName = AETHER_UNITS[c.to]!.name;
				return [
					{
						id: "copy:convert",
						title: `${shown} ${toName}`,
						subtitle: `${aetherFormatNumber(c.value)} ${AETHER_UNITS[c.from]!.name}  ·  Enter to copy`,
						icon: "straighten",
						symbol: true,
						score: 2000,
						accessory: "Copy",
						run: () => {
							navigator.clipboard?.writeText(String(c.result)).catch(() => {});
							this.flash(`Copied ${shown} ${toName}`);
						},
					},
				];
			},
		};

		const apps: SpotlightProvider = {
			id: "apps",
			label: "Applications",
			limit: 6,
			search: (q) =>
				Object.values(anura.apps as Record<string, any>)
					.map((app) => {
						if (!app || app.hidden || !app.name) return null;
						const s = Math.max(
							aetherMatch(q, app.name),
							aetherMatch(q, app.package) * 0.5,
						);
						return s < 0
							? null
							: this.appResult(app, s + recentBoost(app.package));
					})
					.filter((r): r is SpotlightResult => !!r),
		};

		const windows: SpotlightProvider = {
			id: "windows",
			label: "Windows",
			limit: 4,
			search: (q) => {
				const out: SpotlightResult[] = [];
				for (const app of Object.values(anura.apps as Record<string, any>)) {
					for (const win of app?.windows || []) {
						if (!win?.element?.isConnected) continue;
						const title = win.title || app.name;
						const s = Math.max(
							aetherMatch(q, title),
							aetherMatch(q, app.name) - 50,
						);
						if (s < 0) continue;
						out.push({
							id: "win:" + (win.pid ?? title),
							title,
							subtitle: `Window · ${app.name}${win.minimizing || win.element.style.display === "none" ? " · minimised" : ""}`,
							icon: app.icon || "/assets/icons/generic.svg",
							score: s - 30,
							accessory: "Switch",
							run: () => {
								try {
									win.unminimize?.();
								} catch {
									/* already visible */
								}
								win.focus?.();
							},
						});
					}
				}
				return out;
			},
		};

		const commands: SpotlightProvider = {
			id: "commands",
			label: "Commands",
			limit: 5,
			search: (q) =>
				AetherCommands.list
					.map((c) => {
						const s = Math.max(
							aetherMatch(q, AetherCommands.title(c)),
							...(c.keywords || []).map((k) => aetherMatch(q, k) - 40),
						);
						return s < 0 ? null : this.commandResult(c, s - 10);
					})
					.filter((r): r is SpotlightResult => !!r),
		};

		const files: SpotlightProvider = {
			id: "files",
			label: "Files",
			limit: 6,
			search: (q) => {
				if (q.length < 2) return [];
				AetherFileIndex.ensure();
				return AetherFileIndex.entries
					.map((f) => {
						const s = aetherMatch(q, f.name);
						if (s < 0) return null;
						return {
							id: "file:" + f.path,
							title: f.name,
							subtitle: f.path,
							icon: AetherFileIndex.icon(f.name, f.dir),
							symbol: true,
							// Files rank under apps and commands at equal match quality.
							score: s - 120,
							accessory: f.dir ? "Show" : "Open",
							run: () => {
								if (f.dir) anura.apps["anura.fsapp"]?.open([f.path]);
								else anura.files.open(f.path);
							},
						} as SpotlightResult;
					})
					.filter((r): r is SpotlightResult => !!r);
			},
		};

		const web: SpotlightProvider = {
			id: "web",
			label: "Web",
			limit: 2,
			search: (q) => {
				const out: SpotlightResult[] = [];
				const looksLikeUrl =
					/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(q);
				if (looksLikeUrl) {
					const url = /^https?:\/\//i.test(q) ? q : "https://" + q;
					out.push({
						id: "web:open",
						title: "Open " + q,
						subtitle: "In Browser",
						icon: "public",
						symbol: true,
						score: 640,
						accessory: "Open",
						run: () => anura.apps["anura.browser"]?.open([url]),
					});
				}
				out.push({
					id: "web:search",
					title: `Search the web for “${q}”`,
					subtitle: "DuckDuckGo, in Browser",
					icon: "travel_explore",
					symbol: true,
					score: 0,
					accessory: "Search",
					run: () =>
						anura.apps["anura.browser"]?.open([
							"https://duckduckgo.com/?q=" + encodeURIComponent(q),
						]),
				});
				return out;
			},
		};

		return [calculator, conversion, apps, windows, commands, files, web];
	}

	/* ---- built-in commands ------------------------------------------- */

	private registerCommands() {
		const toggle = (
			id: string,
			setting: string,
			label: string,
			icon: string,
			keywords: string[],
			after?: (on: boolean) => void,
			invert = false,
		) =>
			AetherCommands.register({
				id,
				icon,
				keywords,
				title: () => {
					const on = !!anura.settings.get(setting) !== invert;
					return `Turn ${on ? "Off" : "On"} ${label}`;
				},
				subtitle: "Setting",
				run: () => {
					const next = !anura.settings.get(setting);
					anura.settings.set(setting, next);
					after?.(next !== invert);
				},
			});

		toggle(
			"toggle-sounds",
			"sound-enabled",
			"Interface Sounds",
			"volume_up",
			["sound", "audio", "mute"],
			(on) => {
				if (on) (globalThis as any).aetherSound?.play?.("toggleOn");
			},
		);
		toggle(
			"toggle-cursor",
			"custom-cursor",
			"Custom Cursor",
			"arrow_selector_tool",
			["pointer", "mouse"],
			() => (globalThis as any).AetherCursor?.init(),
		);
		toggle(
			"toggle-motion",
			"disable-animation",
			"Animations",
			"animation",
			["reduce motion", "motion"],
			() => (globalThis as any).AetherMotion?.sync(),
			true,
		);
		toggle(
			"toggle-blur",
			"blur-disable",
			"Performance Mode",
			"speed",
			["blur", "transparency", "fast"],
			(on) => document.body.classList.toggle("blur-disable", on),
		);
		toggle(
			"toggle-magnetic",
			"magnetic-icons",
			"Magnetic Icons",
			"attractions",
			["magnet"],
		);

		const openSettings = (anchor?: string) => {
			anura.apps["anura.settings"]?.open();
			if (!anchor) return;
			// The settings window renders in-document; give it a frame to mount.
			setTimeout(
				() =>
					document.getElementById(anchor)?.scrollIntoView({ block: "start" }),
				400,
			);
		};
		AetherCommands.register({
			id: "settings",
			title: "Open System Settings",
			icon: "settings",
			keywords: ["preferences", "config"],
			run: () => openSettings(),
		});
		AetherCommands.register({
			id: "settings-feel",
			title: "Sound & Feel Settings",
			icon: "graphic_eq",
			keywords: ["sound", "cursor", "loading"],
			subtitle: "Settings",
			run: () => openSettings("feel"),
		});
		AetherCommands.register({
			id: "wallpaper",
			title: "Change Wallpaper",
			icon: "wallpaper",
			keywords: ["background", "theme", "accent", "color"],
			subtitle: "Wallpaper & Style",
			run: () => anura.apps["anura.wallpaper"]?.open(),
		});
		AetherCommands.register({
			id: "restart",
			title: "Restart",
			icon: "restart_alt",
			keywords: ["reboot", "reload"],
			run: () => location.reload(),
		});
		AetherCommands.register({
			id: "about",
			title: `About ${BRANDING.name}`,
			icon: "info",
			keywords: ["version", "system"],
			run: () => anura.apps["anura.about"]?.open(),
		});
		AetherCommands.register({
			id: "launchpad",
			title: "Show Launchpad",
			icon: "apps",
			keywords: ["start", "apps", "launcher"],
			run: () => launcher?.toggleVisible?.(),
		});
		AetherCommands.register({
			id: "close-all",
			title: "Close All Windows",
			icon: "close",
			keywords: ["quit", "clear"],
			run: () => {
				for (const app of Object.values(anura.apps as Record<string, any>)) {
					for (const win of [...(app?.windows || [])]) win?.close?.();
				}
			},
		});
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherSpotlight = AetherSpotlight;
(globalThis as any).aetherMatch = aetherMatch;
