/**
 * Aether — widget system
 * ==========================================================================
 *
 * A small, dependency-free widget framework for the launcher's start-menu
 * style widget rail. Every widget is an `AetherWidget` subclass that knows
 * its own title/icon/size and builds a plain DOM body; `WidgetHost` lays
 * them out in a grid, isolates their failures, and drives their timers.
 *
 * Design rules that matter here:
 *
 *  - No modules. Everything in `src/` is concatenated into one global
 *    script, so `AetherWidget`, `WidgetHost` and `registerAetherWidget`
 *    are simply global.
 *  - `anura` may not exist yet when this file evaluates, so every access
 *    goes through the lazy `anuraGlobal()` helper. Never touch `anura` at
 *    script-eval time.
 *  - dreamland's `class={[...]}` iterates the array and calls
 *    `classList.add()` with no filtering: `""` throws, `false` adds a
 *    literal "false" class. So this file only ever uses plain template
 *    strings for `class`, or the `class:name={pointer}` sugar, which is
 *    safe by construction.
 *  - No SVG. dreamland re-parses SVG subtrees (`elm.innerHTML =
 *    elm.innerHTML`) which destroys reactive bindings and `bind:this`
 *    refs inside them, so the analog clock and the sparklines are built
 *    from divs and CSS transforms instead.
 *
 * All presentation lives in `src/Widgets.css`.
 */

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

/** Widget footprint on the 2-column rail grid. */
type AetherWidgetSize = "small" | "medium" | "wide" | "tall" | "large";

/** Wall-clock reference for the uptime readout. */
const AETHER_WIDGETS_BOOT: number =
	typeof performance !== "undefined" && performance.timeOrigin
		? performance.timeOrigin
		: Date.now();

/** Lazy, defensive handle on the global `anura` object. */
function anuraGlobal(): any {
	try {
		const g = globalThis as any;
		return g.anura || null;
	} catch {
		return null;
	}
}

const AETHER_WIDGET_PREFIX = "aether.widgets.";

/** Read a widget setting, tolerating a missing/half-booted `anura`. */
function widgetSetting<T>(key: string, fallback: T): T {
	try {
		const a = anuraGlobal();
		if (!a || !a.settings) return fallback;
		const v = a.settings.get(AETHER_WIDGET_PREFIX + key);
		return v === undefined || v === null ? fallback : (v as T);
	} catch {
		return fallback;
	}
}

/** Write a widget setting. Fire-and-forget; never throws into a render. */
function setWidgetSetting(key: string, value: any): void {
	try {
		const a = anuraGlobal();
		if (!a || !a.settings) return;
		const r = a.settings.set(AETHER_WIDGET_PREFIX + key, value);
		if (r && typeof r.catch === "function") r.catch(() => {});
	} catch {
		/* settings are a nicety, never a hard dependency */
	}
}

/** `fetch` with a hard timeout, so a hostile proxy can't hang a widget. */
async function widgetFetchJSON(url: string, timeoutMs = 9000): Promise<any> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) throw new Error("HTTP " + res.status);
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

function formatBytes(bytes: number): string {
	if (!isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let v = bytes;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(total / 86400);
	const h = Math.floor((total % 86400) / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

// ---------------------------------------------------------------------------
// base widget
// ---------------------------------------------------------------------------

/**
 * Base class for every widget.
 *
 * Subclasses override `render()` (build the body once) plus, optionally,
 * `onShow()` / `onHide()` for live data. Timers registered through
 * `this.every()` are torn down automatically when the rail is hidden, so a
 * closed launcher costs nothing.
 */
class AetherWidget {
	/** Stable identifier, used for the settings order list and `data-widget`. */
	id = "widget";
	/** Human title shown in the card header. */
	title = "Widget";
	/** Material Symbols glyph name shown beside the title. */
	icon = "widgets";
	/** Footprint on the rail grid. */
	size: AetherWidgetSize = "medium";
	/** Set false to suppress the stock header (widget draws its own). */
	chrome = true;

	/** Injected by the host: closes the launcher when a widget navigates. */
	onLaunch: () => void = () => {};

	private timers: number[] = [];
	private frames: number[] = [];

	/** Synchronous capability probe. A false result hides the widget. */
	available(): boolean {
		return true;
	}

	/** Build the widget body. Called once, at host construction. */
	render(): HTMLElement {
		return (<div class="widget-note">Nothing to show.</div>) as HTMLElement;
	}

	/** Optional right-hand header accessory (status pill, %, location…). */
	renderAccessory(): HTMLElement | null {
		return null;
	}

	/** Rail became visible. Start polling here. */
	onShow(): void {}

	/** Rail was hidden. Timers are already cleared for you. */
	onHide(): void {}

	/** Register a guarded interval, cleared on hide. */
	every(ms: number, fn: () => void, immediate = true): void {
		const tick = () => {
			try {
				fn();
			} catch (e) {
				console.warn(`[widgets] ${this.id} tick failed`, e);
			}
		};
		if (immediate) tick();
		this.timers.push(setInterval(tick, ms) as unknown as number);
	}

	/** Register a guarded rAF loop, cancelled on hide. */
	frame(fn: (now: number) => void): void {
		const step = (now: number) => {
			try {
				fn(now);
			} catch (e) {
				console.warn(`[widgets] ${this.id} frame failed`, e);
				return;
			}
			this.frames.push(requestAnimationFrame(step));
		};
		this.frames.push(requestAnimationFrame(step));
	}

	/** Internal — called by the host. */
	start(): void {
		try {
			this.onShow();
		} catch (e) {
			console.warn(`[widgets] ${this.id} failed to start`, e);
		}
	}

	/** Internal — called by the host. */
	stop(): void {
		for (const t of this.timers) clearInterval(t);
		for (const f of this.frames) cancelAnimationFrame(f);
		this.timers = [];
		this.frames = [];
		try {
			this.onHide();
		} catch (e) {
			console.warn(`[widgets] ${this.id} failed to stop`, e);
		}
	}
}

/** id -> factory. Anything registered here can appear in the rail. */
const AetherWidgetRegistry: { [id: string]: () => AetherWidget } = {};

function registerAetherWidget(id: string, factory: () => AetherWidget): void {
	AetherWidgetRegistry[id] = factory;
}

/** Default rail order, top to bottom. */
const AETHER_WIDGET_DEFAULT_ORDER = [
	"weather",
	"clock",
	"system",
	"calendar",
	"battery",
	"worldclock",
	"notes",
	"calculator",
	"shortcuts",
];

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

interface WeatherHour {
	label: string;
	temp: number;
	code: number;
	day: boolean;
}
interface WeatherDay {
	label: string;
	hi: number;
	lo: number;
	code: number;
}
interface WeatherPayload {
	place: string;
	unitLabel: string;
	temp: number;
	feels: number;
	code: number;
	day: boolean;
	hi: number;
	lo: number;
	humidity: number;
	wind: number;
	windLabel: string;
	hours: WeatherHour[];
	days: WeatherDay[];
	ts: number;
}

/** WMO weather interpretation codes -> glyph + label. */
function weatherGlyph(code: number, day: boolean): string {
	if (code === 0) return day ? "clear_day" : "clear_night";
	if (code === 1 || code === 2)
		return day ? "partly_cloudy_day" : "partly_cloudy_night";
	if (code === 3) return "cloud";
	if (code === 45 || code === 48) return "foggy";
	if (code >= 51 && code <= 57) return "rainy_light";
	if (code >= 61 && code <= 67) return "rainy";
	if (code >= 71 && code <= 77) return "weather_snowy";
	if (code >= 80 && code <= 82) return "rainy_heavy";
	if (code === 85 || code === 86) return "snowing";
	if (code >= 95) return "thunderstorm";
	return "cloud";
}

function weatherLabel(code: number): string {
	if (code === 0) return "Clear";
	if (code === 1) return "Mainly clear";
	if (code === 2) return "Partly cloudy";
	if (code === 3) return "Overcast";
	if (code === 45 || code === 48) return "Fog";
	if (code >= 51 && code <= 55) return "Drizzle";
	if (code === 56 || code === 57) return "Freezing drizzle";
	if (code >= 61 && code <= 65) return "Rain";
	if (code === 66 || code === 67) return "Freezing rain";
	if (code >= 71 && code <= 75) return "Snow";
	if (code === 77) return "Snow grains";
	if (code >= 80 && code <= 82) return "Rain showers";
	if (code === 85 || code === 86) return "Snow showers";
	if (code === 95) return "Thunderstorm";
	if (code >= 96) return "Thunderstorm, hail";
	return "—";
}

/**
 * Shown when Open-Meteo can't be reached and nothing has ever been cached.
 * Deliberately generic and always labelled "Sample" in the UI so it is never
 * mistaken for a real forecast.
 */
const WEATHER_SAMPLE: WeatherPayload = {
	place: "Sample forecast",
	unitLabel: "°C",
	temp: 18,
	feels: 17,
	code: 2,
	day: true,
	hi: 21,
	lo: 12,
	humidity: 58,
	wind: 11,
	windLabel: "km/h",
	hours: [
		{ label: "Now", temp: 18, code: 2, day: true },
		{ label: "1p", temp: 19, code: 2, day: true },
		{ label: "2p", temp: 20, code: 3, day: true },
		{ label: "3p", temp: 21, code: 3, day: true },
		{ label: "4p", temp: 20, code: 61, day: true },
		{ label: "5p", temp: 18, code: 61, day: true },
	],
	days: [
		{ label: "Tue", hi: 21, lo: 12, code: 2 },
		{ label: "Wed", hi: 23, lo: 13, code: 0 },
		{ label: "Thu", hi: 19, lo: 12, code: 61 },
		{ label: "Fri", hi: 17, lo: 11, code: 80 },
	],
	ts: 0,
};

/** Fallback coordinates when geolocation is denied or unavailable. */
const WEATHER_DEFAULT_PLACE = {
	lat: 37.7749,
	lon: -122.4194,
	name: "San Francisco",
};

class WeatherWidget extends AetherWidget {
	override id = "weather";
	override title = "Weather";
	override icon = "partly_cloudy_day";
	override size: AetherWidgetSize = "large";

	state: Stateful<{
		status: "loading" | "live" | "cached" | "sample" | "error";
		statusLabel: string;
		place: string;
		temp: string;
		feels: string;
		cond: string;
		glyph: string;
		hi: string;
		lo: string;
		humidity: string;
		wind: string;
		hours: WeatherHour[];
		days: WeatherDay[];
		unitLabel: string;
	}> = $state({
		status: "loading" as "loading" | "live" | "cached" | "sample" | "error",
		statusLabel: "Loading…",
		place: "Locating…",
		temp: "--",
		feels: "--",
		cond: "—",
		glyph: "cloud",
		hi: "--",
		lo: "--",
		humidity: "--",
		wind: "--",
		hours: [] as WeatherHour[],
		days: [] as WeatherDay[],
		unitLabel: "°",
	});

	private inflight = false;

	private imperial(): boolean {
		const pref = widgetSetting<string>("weather.units", "");
		if (pref === "imperial") return true;
		if (pref === "metric") return false;
		// Sensible default: the three countries that still use Fahrenheit.
		try {
			return /^en-(US|us)|^en$/.test(navigator.language || "");
		} catch {
			return false;
		}
	}

	override renderAccessory(): HTMLElement {
		return (
			<div
				class="wx-status"
				class:is-live={use(this.state.status, (s) => s === "live")}
				class:is-stale={use(
					this.state.status,
					(s) => s === "cached" || s === "sample" || s === "error",
				)}
			>
				<span class="wx-status-dot"></span>
				<span>{use(this.state.statusLabel)}</span>
			</div>
		) as HTMLElement;
	}

	override render(): HTMLElement {
		return (
			<div class="wx">
				<div class="wx-hero">
					<span class="wx-hero-glyph material-symbols-outlined">
						{use(this.state.glyph)}
					</span>
					<div class="wx-hero-text">
						<div class="wx-temp">
							{use(this.state.temp)}
							<span class="wx-unit">{use(this.state.unitLabel)}</span>
						</div>
						<div class="wx-cond">{use(this.state.cond)}</div>
						<div class="wx-place">{use(this.state.place)}</div>
					</div>
					<div class="wx-hilo">
						<div class="wx-hilo-row">
							<span class="material-symbols-outlined">arrow_upward</span>
							<span>{use(this.state.hi)}</span>
						</div>
						<div class="wx-hilo-row">
							<span class="material-symbols-outlined">arrow_downward</span>
							<span>{use(this.state.lo)}</span>
						</div>
					</div>
				</div>

				<div class="wx-strip">
					{use(this.state.hours, (hours) =>
						// Not `h` — JSX compiles to calls to the pragma `h`, and a
						// parameter of that name shadows it inside the callback.
						hours.map((hour) => (
							<div class="wx-hour">
								<div class="wx-hour-label">{hour.label}</div>
								<span class="wx-hour-glyph material-symbols-outlined">
									{weatherGlyph(hour.code, hour.day)}
								</span>
								<div class="wx-hour-temp">{Math.round(hour.temp) + "°"}</div>
							</div>
						)),
					)}
				</div>

				<div class="wx-days">
					{use(this.state.days, (days) =>
						days.map((d) => (
							<div class="wx-day">
								<div class="wx-day-label">{d.label}</div>
								<span class="wx-day-glyph material-symbols-outlined">
									{weatherGlyph(d.code, true)}
								</span>
								<div class="wx-day-range">
									<span class="wx-day-lo">{Math.round(d.lo) + "°"}</span>
									<span class="wx-day-bar"></span>
									<span class="wx-day-hi">{Math.round(d.hi) + "°"}</span>
								</div>
							</div>
						)),
					)}
				</div>

				<div class="wx-footer">
					<div class="wx-metric">
						<span class="material-symbols-outlined">humidity_percentage</span>
						<span>{use(this.state.humidity)}</span>
					</div>
					<div class="wx-metric">
						<span class="material-symbols-outlined">air</span>
						<span>{use(this.state.wind)}</span>
					</div>
					<div class="wx-metric">
						<span class="material-symbols-outlined">device_thermostat</span>
						<span>
							{"Feels "}
							{use(this.state.feels)}
						</span>
					</div>
				</div>
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		// Paint the cache instantly so the card is never blank, then refresh.
		const cached = widgetSetting<WeatherPayload | null>("weather.cache", null);
		if (cached && typeof cached === "object" && cached.hours) {
			this.apply(cached, "cached");
		}
		// Refresh on show, then hourly for a long-lived session.
		this.every(30 * 60 * 1000, () => void this.load());
	}

	private async locate(): Promise<{ lat: number; lon: number; name: string }> {
		const pinned = widgetSetting<{
			lat: number;
			lon: number;
			name: string;
		} | null>("weather.place", null);
		if (pinned && typeof pinned.lat === "number") return pinned;

		return await new Promise((resolve) => {
			let settled = false;
			const done = (v: { lat: number; lon: number; name: string }) => {
				if (settled) return;
				settled = true;
				resolve(v);
			};
			try {
				if (!navigator.geolocation) return done(WEATHER_DEFAULT_PLACE);
				// Belt and braces: some embedders never call either callback.
				setTimeout(() => done(WEATHER_DEFAULT_PLACE), 7000);
				navigator.geolocation.getCurrentPosition(
					(pos) =>
						done({
							lat: pos.coords.latitude,
							lon: pos.coords.longitude,
							name: "Current location",
						}),
					() => done(WEATHER_DEFAULT_PLACE),
					{ timeout: 6000, maximumAge: 30 * 60 * 1000 },
				);
			} catch {
				done(WEATHER_DEFAULT_PLACE);
			}
		});
	}

	/** Fetch, normalise, cache. Degrades to cache, then to sample data. */
	async load(): Promise<void> {
		if (this.inflight) return;
		this.inflight = true;

		const cached = widgetSetting<WeatherPayload | null>("weather.cache", null);
		const hasCache = !!(cached && typeof cached === "object" && cached.hours);

		try {
			if (typeof navigator !== "undefined" && navigator.onLine === false) {
				throw new Error("offline");
			}

			const place = await this.locate();
			const imperial = this.imperial();
			const params = new URLSearchParams({
				latitude: String(place.lat),
				longitude: String(place.lon),
				current:
					"temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m",
				hourly: "temperature_2m,weather_code,is_day",
				daily: "weather_code,temperature_2m_max,temperature_2m_min",
				forecast_days: "5",
				timezone: "auto",
			});
			if (imperial) {
				params.set("temperature_unit", "fahrenheit");
				params.set("wind_speed_unit", "mph");
			}

			const json = await widgetFetchJSON(
				"https://api.open-meteo.com/v1/forecast?" + params.toString(),
				9000,
			);
			const payload = this.normalize(json, place, imperial);
			setWidgetSetting("weather.cache", payload);
			this.apply(payload, "live");
		} catch (e) {
			console.warn("[widgets] weather fetch failed", e);
			if (hasCache) {
				this.apply(cached as WeatherPayload, "cached");
			} else {
				this.apply(WEATHER_SAMPLE, "sample");
			}
		} finally {
			this.inflight = false;
		}
	}

	private normalize(
		json: any,
		place: { lat: number; lon: number; name: string },
		imperial: boolean,
	): WeatherPayload {
		const unitLabel = imperial ? "°F" : "°C";
		const cur = json.current || {};
		const hourly = json.hourly || {};
		const daily = json.daily || {};

		const hourTimes: string[] = hourly.time || [];
		const now = Date.now();
		let start = hourTimes.findIndex(
			(t) => new Date(t).getTime() >= now - 1800000,
		);
		if (start < 0) start = 0;

		const hourFmt = new Intl.DateTimeFormat(navigator.language, {
			hour: "numeric",
		});
		const hours: WeatherHour[] = [];
		for (let i = start; i < Math.min(start + 7, hourTimes.length); i++) {
			const d = new Date(hourTimes[i]!);
			hours.push({
				label:
					hours.length === 0 ? "Now" : hourFmt.format(d).replace(/\s/g, ""),
				temp: Number(hourly.temperature_2m?.[i] ?? 0),
				code: Number(hourly.weather_code?.[i] ?? 0),
				day: (hourly.is_day?.[i] ?? 1) === 1,
			});
		}

		const dayFmt = new Intl.DateTimeFormat(navigator.language, {
			weekday: "short",
		});
		const dayTimes: string[] = daily.time || [];
		const days: WeatherDay[] = [];
		for (let i = 0; i < Math.min(5, dayTimes.length); i++) {
			const d = new Date(dayTimes[i] + "T12:00:00");
			days.push({
				label: i === 0 ? "Today" : dayFmt.format(d),
				hi: Number(daily.temperature_2m_max?.[i] ?? 0),
				lo: Number(daily.temperature_2m_min?.[i] ?? 0),
				code: Number(daily.weather_code?.[i] ?? 0),
			});
		}

		return {
			place: place.name,
			unitLabel,
			temp: Number(cur.temperature_2m ?? 0),
			feels: Number(cur.apparent_temperature ?? cur.temperature_2m ?? 0),
			code: Number(cur.weather_code ?? 0),
			day: (cur.is_day ?? 1) === 1,
			hi: Number(daily.temperature_2m_max?.[0] ?? cur.temperature_2m ?? 0),
			lo: Number(daily.temperature_2m_min?.[0] ?? cur.temperature_2m ?? 0),
			humidity: Number(cur.relative_humidity_2m ?? 0),
			wind: Number(cur.wind_speed_10m ?? 0),
			windLabel: imperial ? "mph" : "km/h",
			hours,
			days: days.slice(0, 4),
			ts: Date.now(),
		};
	}

	private apply(p: WeatherPayload, status: "live" | "cached" | "sample"): void {
		try {
			this.state.status = status;
			this.state.statusLabel =
				status === "live"
					? "Live"
					: status === "cached"
						? "Cached " + this.relative(p.ts)
						: "Sample";
			this.state.place =
				status === "sample" ? "Offline — sample data" : p.place || "—";
			this.state.unitLabel = p.unitLabel || "°";
			this.state.temp = String(Math.round(p.temp));
			this.state.feels = Math.round(p.feels) + "°";
			this.state.cond = weatherLabel(p.code);
			this.state.glyph = weatherGlyph(p.code, p.day);
			this.state.hi = Math.round(p.hi) + "°";
			this.state.lo = Math.round(p.lo) + "°";
			this.state.humidity = Math.round(p.humidity) + "%";
			this.state.wind = Math.round(p.wind) + " " + (p.windLabel || "");
			this.state.hours = p.hours || [];
			this.state.days = p.days || [];
		} catch (e) {
			console.warn("[widgets] weather apply failed", e);
		}
	}

	private relative(ts: number): string {
		if (!ts) return "";
		const mins = Math.round((Date.now() - ts) / 60000);
		if (mins < 1) return "just now";
		if (mins < 60) return mins + "m ago";
		const hrs = Math.round(mins / 60);
		if (hrs < 24) return hrs + "h ago";
		return Math.round(hrs / 24) + "d ago";
	}
}
registerAetherWidget("weather", () => new WeatherWidget());

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

class ClockWidget extends AetherWidget {
	override id = "clock";
	override title = "Clock";
	override icon = "schedule";
	override size: AetherWidgetSize = "medium";

	state: Stateful<{
		time: string;
		date: string;
		hourDeg: number;
		minuteDeg: number;
		secondDeg: number;
		altZoneName: string;
		altZoneTime: string;
	}> = $state({
		time: "--:--",
		date: "",
		hourDeg: 0,
		minuteDeg: 0,
		secondDeg: 0,
		altZoneName: "",
		altZoneTime: "",
	});

	private altZone = "UTC";

	override render(): HTMLElement {
		const ticks: HTMLElement[] = [];
		for (let i = 0; i < 12; i++) {
			ticks.push(
				(
					<span
						class={i % 3 === 0 ? "clock-tick clock-tick-major" : "clock-tick"}
						style={`transform: rotate(${i * 30}deg)`}
					></span>
				) as HTMLElement,
			);
		}

		return (
			<div class="clock">
				<div class="clock-face">
					{ticks}
					<span
						class="clock-hand clock-hand-hour"
						style={use(this.state.hourDeg, (d) => `transform: rotate(${d}deg)`)}
					></span>
					<span
						class="clock-hand clock-hand-minute"
						style={use(
							this.state.minuteDeg,
							(d) => `transform: rotate(${d}deg)`,
						)}
					></span>
					<span
						class="clock-hand clock-hand-second"
						style={use(
							this.state.secondDeg,
							(d) => `transform: rotate(${d}deg)`,
						)}
					></span>
					<span class="clock-pin"></span>
				</div>
				<div class="clock-readout">
					<div class="clock-time">{use(this.state.time)}</div>
					<div class="clock-date">{use(this.state.date)}</div>
					<div class="clock-alt">
						<span class="clock-alt-zone">{use(this.state.altZoneName)}</span>
						<span class="clock-alt-time">{use(this.state.altZoneTime)}</span>
					</div>
				</div>
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		this.altZone = widgetSetting<string>("clock.zone", "UTC");
		this.every(1000, () => this.tick());
	}

	private tick(): void {
		const now = new Date();
		const h = now.getHours();
		const m = now.getMinutes();
		const s = now.getSeconds();

		this.state.hourDeg = ((h % 12) + m / 60) * 30;
		this.state.minuteDeg = (m + s / 60) * 6;
		this.state.secondDeg = s * 6;

		this.state.time = now.toLocaleTimeString(navigator.language, {
			hour: "numeric",
			minute: "2-digit",
		});
		this.state.date = now.toLocaleDateString(navigator.language, {
			weekday: "long",
			month: "long",
			day: "numeric",
		});

		try {
			this.state.altZoneName = this.altZone
				.split("/")
				.pop()!
				.replace(/_/g, " ");
			this.state.altZoneTime = now.toLocaleTimeString(navigator.language, {
				hour: "numeric",
				minute: "2-digit",
				timeZone: this.altZone,
			});
		} catch {
			this.state.altZoneName = "";
			this.state.altZoneTime = "";
		}
	}
}
registerAetherWidget("clock", () => new ClockWidget());

// ---------------------------------------------------------------------------
// World clocks
// ---------------------------------------------------------------------------

class WorldClockWidget extends AetherWidget {
	override id = "worldclock";
	override title = "World Clock";
	override icon = "public";
	override size: AetherWidgetSize = "medium";

	state: Stateful<{
		zones: Array<{ name: string; time: string; meta: string; night: boolean }>;
	}> = $state({
		zones: [] as Array<{
			name: string;
			time: string;
			meta: string;
			night: boolean;
		}>,
	});

	private list: string[] = [];

	override render(): HTMLElement {
		return (
			<div class="wclock">
				{use(this.state.zones, (zones) =>
					zones.map((z) => (
						<div class="wclock-row">
							<span
								class={
									z.night
										? "wclock-glyph material-symbols-outlined is-night"
										: "wclock-glyph material-symbols-outlined"
								}
							>
								{z.night ? "bedtime" : "light_mode"}
							</span>
							<div class="wclock-labels">
								<div class="wclock-city">{z.name}</div>
								<div class="wclock-meta">{z.meta}</div>
							</div>
							<div class="wclock-time">{z.time}</div>
						</div>
					)),
				)}
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		this.list = widgetSetting<string[]>("worldclock.zones", [
			"America/Los_Angeles",
			"America/New_York",
			"Europe/London",
			"Asia/Tokyo",
		]);
		this.every(1000, () => this.tick());
	}

	private tick(): void {
		const now = new Date();
		const rows: Array<{
			name: string;
			time: string;
			meta: string;
			night: boolean;
		}> = [];
		for (const zone of this.list) {
			try {
				const time = now.toLocaleTimeString(navigator.language, {
					hour: "numeric",
					minute: "2-digit",
					timeZone: zone,
				});
				const hour = Number(
					new Intl.DateTimeFormat("en-GB", {
						hour: "2-digit",
						hour12: false,
						timeZone: zone,
					}).format(now),
				);
				const day = new Intl.DateTimeFormat("en-GB", {
					weekday: "short",
					timeZone: zone,
				}).format(now);
				rows.push({
					name: zone.split("/").pop()!.replace(/_/g, " "),
					time,
					meta: day,
					night: hour < 6 || hour >= 19,
				});
			} catch {
				/* an unknown zone shouldn't kill the rest of the list */
			}
		}
		this.state.zones = rows;
	}
}
registerAetherWidget("worldclock", () => new WorldClockWidget());

// ---------------------------------------------------------------------------
// System monitor
// ---------------------------------------------------------------------------

class SystemWidget extends AetherWidget {
	override id = "system";
	override title = "System";
	override icon = "monitoring";
	override size: AetherWidgetSize = "tall";

	state: Stateful<{
		fps: number[];
		fpsNow: string;
		memLabel: string;
		memPct: number;
		memOk: boolean;
		diskLabel: string;
		diskPct: number;
		diskOk: boolean;
		netLabel: string;
		netMeta: string;
		online: boolean;
		uptime: string;
	}> = $state({
		fps: [] as number[],
		fpsNow: "—",
		memLabel: "Unavailable",
		memPct: 0,
		memOk: false,
		diskLabel: "Measuring…",
		diskPct: 0,
		diskOk: false,
		netLabel: "—",
		netMeta: "",
		online: true,
		uptime: "0s",
	});

	private frameCount = 0;
	private windowStart = 0;

	override render(): HTMLElement {
		return (
			<div class="sys">
				<div class="sys-spark">
					<div class="sys-spark-head">
						<span class="sys-spark-title">Render rate</span>
						<span class="sys-spark-value">{use(this.state.fpsNow)}</span>
					</div>
					<div class="sys-spark-bars">
						{use(this.state.fps, (samples) =>
							samples.map((v) => (
								<span
									class="sys-spark-bar"
									style={`height: ${clamp(Math.round((v / 60) * 100), 4, 100)}%`}
								></span>
							)),
						)}
					</div>
				</div>

				<div class="sys-row">
					<div class="sys-row-head">
						<span class="material-symbols-outlined">memory</span>
						<span class="sys-row-name">Memory</span>
						<span class="sys-row-value">{use(this.state.memLabel)}</span>
					</div>
					<div class="sys-meter">
						<span
							class="sys-meter-fill"
							style={use(
								this.state.memPct,
								(p) => `width: ${clamp(p, 0, 100)}%`,
							)}
						></span>
					</div>
				</div>

				<div class="sys-row">
					<div class="sys-row-head">
						<span class="material-symbols-outlined">hard_drive</span>
						<span class="sys-row-name">Storage</span>
						<span class="sys-row-value">{use(this.state.diskLabel)}</span>
					</div>
					<div class="sys-meter">
						<span
							class="sys-meter-fill"
							style={use(
								this.state.diskPct,
								(p) => `width: ${clamp(p, 0, 100)}%`,
							)}
						></span>
					</div>
				</div>

				<div class="sys-facts">
					<div class="sys-fact">
						<span
							class="sys-fact-glyph material-symbols-outlined"
							class:is-off={use(this.state.online, (o) => !o)}
						>
							{use(this.state.online, (o) => (o ? "wifi" : "wifi_off"))}
						</span>
						<div class="sys-fact-body">
							<div class="sys-fact-value">{use(this.state.netLabel)}</div>
							<div class="sys-fact-label">{use(this.state.netMeta)}</div>
						</div>
					</div>
					<div class="sys-fact">
						<span class="sys-fact-glyph material-symbols-outlined">
							timelapse
						</span>
						<div class="sys-fact-body">
							<div class="sys-fact-value">{use(this.state.uptime)}</div>
							<div class="sys-fact-label">Uptime</div>
						</div>
					</div>
				</div>
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		this.frameCount = 0;
		this.windowStart = performance.now();
		this.frame((now) => {
			this.frameCount++;
			if (now - this.windowStart >= 1000) {
				const fps = (this.frameCount * 1000) / (now - this.windowStart);
				this.frameCount = 0;
				this.windowStart = now;
				this.state.fps = [...this.state.fps, fps].slice(-36);
				this.state.fpsNow = Math.round(fps) + " fps";
			}
		});

		this.every(1000, () => {
			this.state.uptime = formatDuration(Date.now() - AETHER_WIDGETS_BOOT);
		});
		this.every(2500, () => this.sampleMemory());
		this.every(15000, () => void this.sampleStorage());
		this.every(5000, () => this.sampleNetwork());
	}

	private sampleMemory(): void {
		const mem = (performance as any).memory;
		if (!mem || !mem.jsHeapSizeLimit) {
			this.state.memOk = false;
			this.state.memLabel = "Unavailable";
			this.state.memPct = 0;
			return;
		}
		this.state.memOk = true;
		this.state.memPct = (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100;
		this.state.memLabel = `${formatBytes(mem.usedJSHeapSize)} / ${formatBytes(
			mem.jsHeapSizeLimit,
		)}`;
	}

	private async sampleStorage(): Promise<void> {
		try {
			if (!navigator.storage || !navigator.storage.estimate) {
				this.state.diskOk = false;
				this.state.diskLabel = "Unavailable";
				this.state.diskPct = 0;
				return;
			}
			const est = await navigator.storage.estimate();
			const usage = est.usage || 0;
			const quota = est.quota || 0;
			this.state.diskOk = true;
			this.state.diskPct = quota ? (usage / quota) * 100 : 0;
			this.state.diskLabel = quota
				? `${formatBytes(usage)} / ${formatBytes(quota)}`
				: formatBytes(usage);
		} catch {
			this.state.diskOk = false;
			this.state.diskLabel = "Unavailable";
			this.state.diskPct = 0;
		}
	}

	private sampleNetwork(): void {
		const online =
			typeof navigator.onLine === "boolean" ? navigator.onLine : true;
		this.state.online = online;
		const conn =
			(navigator as any).connection ||
			(navigator as any).mozConnection ||
			(navigator as any).webkitConnection;
		if (!online) {
			this.state.netLabel = "Offline";
			this.state.netMeta = "No connection";
			return;
		}
		if (conn && conn.effectiveType) {
			this.state.netLabel = String(conn.effectiveType).toUpperCase();
			this.state.netMeta = conn.downlink ? `${conn.downlink} Mb/s` : "Online";
		} else {
			this.state.netLabel = "Online";
			this.state.netMeta = "Link details N/A";
		}
	}
}
registerAetherWidget("system", () => new SystemWidget());

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

interface CalCell {
	label: string;
	muted: boolean;
	today: boolean;
	weekend: boolean;
}

class CalendarWidget extends AetherWidget {
	override id = "calendar";
	override title = "Calendar";
	override icon = "calendar_month";
	override size: AetherWidgetSize = "medium";

	state: Stateful<{
		month: string;
		weekday: string;
		dayNum: string;
		cells: CalCell[];
		dows: string[];
	}> = $state({
		month: "",
		weekday: "",
		dayNum: "",
		cells: [] as CalCell[],
		dows: ["S", "M", "T", "W", "T", "F", "S"],
	});

	private renderedFor = "";

	override render(): HTMLElement {
		return (
			<div class="cal">
				<div class="cal-head">
					<div class="cal-today">
						<div class="cal-today-weekday">{use(this.state.weekday)}</div>
						<div class="cal-today-num">{use(this.state.dayNum)}</div>
					</div>
					<div class="cal-month">{use(this.state.month)}</div>
				</div>
				<div class="cal-grid">
					{use(this.state.dows, (dows) =>
						dows.map((d) => <div class="cal-dow">{d}</div>),
					)}
					{use(this.state.cells, (cells) =>
						cells.map((c) => {
							let cls = "cal-cell";
							if (c.muted) cls += " is-muted";
							if (c.weekend) cls += " is-weekend";
							if (c.today) cls += " is-today";
							return <div class={cls}>{c.label}</div>;
						}),
					)}
				</div>
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		// Cheap poll so the highlight rolls over at midnight without a timer
		// that has to survive a suspend.
		this.every(30000, () => this.build());
	}

	private build(): void {
		const now = new Date();
		const key = now.toDateString();
		if (key === this.renderedFor) return;
		this.renderedFor = key;

		const year = now.getFullYear();
		const month = now.getMonth();
		const firstDow = new Date(year, month, 1).getDay();
		const lastDate = new Date(year, month + 1, 0).getDate();
		const prevLast = new Date(year, month, 0).getDate();

		const cells: CalCell[] = [];
		for (let i = firstDow; i > 0; i--) {
			cells.push({
				label: String(prevLast - i + 1),
				muted: true,
				today: false,
				weekend: false,
			});
		}
		for (let d = 1; d <= lastDate; d++) {
			const dow = new Date(year, month, d).getDay();
			cells.push({
				label: String(d),
				muted: false,
				today: d === now.getDate(),
				weekend: dow === 0 || dow === 6,
			});
		}
		// Pad to whole weeks so the grid never reflows height between months.
		let next = 1;
		while (cells.length % 7 !== 0) {
			cells.push({
				label: String(next++),
				muted: true,
				today: false,
				weekend: false,
			});
		}

		this.state.cells = cells;
		this.state.month = now.toLocaleDateString(navigator.language, {
			month: "long",
			year: "numeric",
		});
		this.state.weekday = now.toLocaleDateString(navigator.language, {
			weekday: "short",
		});
		this.state.dayNum = String(now.getDate());
	}
}
registerAetherWidget("calendar", () => new CalendarWidget());

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

class NotesWidget extends AetherWidget {
	override id = "notes";
	override title = "Scratchpad";
	override icon = "edit_note";
	override size: AetherWidgetSize = "wide";

	state: Stateful<{ saved: boolean; count: string }> = $state({
		saved: true,
		count: "",
	});

	private area: HTMLTextAreaElement | null = null;
	private saveTimer: number | null = null;

	override renderAccessory(): HTMLElement {
		return (
			<div class="notes-status">
				<span>{use(this.state.count)}</span>
				<span
					class="notes-saved"
					class:is-dirty={use(this.state.saved, (s) => !s)}
				>
					{use(this.state.saved, (s) => (s ? "Saved" : "Saving…"))}
				</span>
			</div>
		) as HTMLElement;
	}

	override render(): HTMLElement {
		const area = (
			<textarea
				class="notes-area"
				spellcheck={false}
				placeholder="Jot something down…"
				on:input={() => this.queueSave()}
				on:keydown={(e: KeyboardEvent) => e.stopPropagation()}
			></textarea>
		) as HTMLTextAreaElement;
		this.area = area;
		return (<div class="notes">{area}</div>) as HTMLElement;
	}

	override onShow(): void {
		if (this.area && this.area.value === "") {
			this.area.value = widgetSetting<string>("notes", "");
		}
		this.updateCount();
	}

	override onHide(): void {
		this.flush();
	}

	private updateCount(): void {
		const v = this.area?.value || "";
		const words = v.trim() ? v.trim().split(/\s+/).length : 0;
		this.state.count =
			words === 0 ? "" : `${words} word${words === 1 ? "" : "s"}`;
	}

	private queueSave(): void {
		this.state.saved = false;
		this.updateCount();
		if (this.saveTimer !== null) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.flush(), 600) as unknown as number;
	}

	private flush(): void {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		try {
			setWidgetSetting("notes", this.area?.value || "");
			this.state.saved = true;
		} catch {
			this.state.saved = false;
		}
	}
}
registerAetherWidget("notes", () => new NotesWidget());

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

class BatteryWidget extends AetherWidget {
	override id = "battery";
	override title = "Battery";
	override icon = "battery_horiz_075";
	override size: AetherWidgetSize = "small";

	state: Stateful<{
		pct: number;
		pctLabel: string;
		charging: boolean;
		detail: string;
		low: boolean;
	}> = $state({
		pct: 0,
		pctLabel: "--%",
		charging: false,
		detail: "Reading…",
		low: false,
	});

	private battery: any = null;
	private listener: (() => void) | null = null;

	override available(): boolean {
		try {
			return typeof (navigator as any).getBattery === "function";
		} catch {
			return false;
		}
	}

	override render(): HTMLElement {
		return (
			<div class="batt">
				<div class="batt-shell" class:is-low={use(this.state.low)}>
					<span
						class="batt-fill"
						style={use(this.state.pct, (p) => `width: ${clamp(p, 2, 100)}%`)}
					></span>
					<span class="batt-cap"></span>
					{$if(
						use(this.state.charging),
						(
							<span class="batt-bolt material-symbols-outlined">bolt</span>
						) as HTMLElement,
					)}
				</div>
				<div class="batt-pct">{use(this.state.pctLabel)}</div>
				<div class="batt-detail">{use(this.state.detail)}</div>
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		void this.attach();
	}

	override onHide(): void {
		if (this.battery && this.listener) {
			for (const ev of [
				"levelchange",
				"chargingchange",
				"chargingtimechange",
				"dischargingtimechange",
			]) {
				try {
					this.battery.removeEventListener(ev, this.listener);
				} catch {
					/* older implementations only expose on* handlers */
				}
			}
		}
		this.listener = null;
	}

	private async attach(): Promise<void> {
		try {
			if (!this.battery) {
				this.battery = await (navigator as any).getBattery();
			}
			const update = () => this.update();
			this.listener = update;
			for (const ev of [
				"levelchange",
				"chargingchange",
				"chargingtimechange",
				"dischargingtimechange",
			]) {
				try {
					this.battery.addEventListener(ev, update);
				} catch {
					/* ignore */
				}
			}
			update();
		} catch (e) {
			console.warn("[widgets] battery unavailable", e);
			this.state.detail = "Unavailable";
		}
	}

	private update(): void {
		const b = this.battery;
		if (!b) return;
		const pct = Math.round((b.level ?? 0) * 100);
		this.state.pct = pct;
		this.state.pctLabel = pct + "%";
		this.state.charging = !!b.charging;
		this.state.low = !b.charging && pct <= 20;

		if (b.charging) {
			this.state.detail =
				b.chargingTime && isFinite(b.chargingTime) && b.chargingTime > 0
					? formatDuration(b.chargingTime * 1000) + " to full"
					: pct >= 100
						? "Fully charged"
						: "Charging";
		} else {
			this.state.detail =
				b.dischargingTime && isFinite(b.dischargingTime)
					? formatDuration(b.dischargingTime * 1000) + " left"
					: "On battery";
		}
	}
}
registerAetherWidget("battery", () => new BatteryWidget());

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

class CalculatorWidget extends AetherWidget {
	override id = "calculator";
	override title = "Calculator";
	override icon = "calculate";
	override size: AetherWidgetSize = "tall";

	state: Stateful<{ display: string; expr: string }> = $state({
		display: "0",
		expr: "",
	});

	private acc: number | null = null;
	private op: string | null = null;
	private fresh = true;

	override render(): HTMLElement {
		const keys: Array<{ label: string; kind: string; act: () => void }> = [
			{ label: "AC", kind: "fn", act: () => this.clear() },
			{ label: "±", kind: "fn", act: () => this.negate() },
			{ label: "%", kind: "fn", act: () => this.percent() },
			{ label: "÷", kind: "op", act: () => this.setOp("/") },
			{ label: "7", kind: "num", act: () => this.digit("7") },
			{ label: "8", kind: "num", act: () => this.digit("8") },
			{ label: "9", kind: "num", act: () => this.digit("9") },
			{ label: "×", kind: "op", act: () => this.setOp("*") },
			{ label: "4", kind: "num", act: () => this.digit("4") },
			{ label: "5", kind: "num", act: () => this.digit("5") },
			{ label: "6", kind: "num", act: () => this.digit("6") },
			{ label: "−", kind: "op", act: () => this.setOp("-") },
			{ label: "1", kind: "num", act: () => this.digit("1") },
			{ label: "2", kind: "num", act: () => this.digit("2") },
			{ label: "3", kind: "num", act: () => this.digit("3") },
			{ label: "+", kind: "op", act: () => this.setOp("+") },
			{ label: "0", kind: "num wide", act: () => this.digit("0") },
			{ label: ".", kind: "num", act: () => this.digit(".") },
			{ label: "=", kind: "eq", act: () => this.equals() },
		];

		return (
			<div class="calc">
				<div class="calc-screen">
					<div class="calc-expr">{use(this.state.expr)}</div>
					<div class="calc-display">{use(this.state.display)}</div>
				</div>
				<div class="calc-keys">
					{keys.map((k) => (
						<button
							type="button"
							class={`calc-key calc-key-${k.kind.split(" ")[0]}${
								k.kind.indexOf("wide") >= 0 ? " calc-key-wide" : ""
							}`}
							on:click={() => {
								try {
									k.act();
								} catch (e) {
									console.warn("[widgets] calculator", e);
									this.clear();
								}
							}}
						>
							{k.label}
						</button>
					))}
				</div>
			</div>
		) as HTMLElement;
	}

	private fmt(n: number): string {
		if (!isFinite(n)) return "Error";
		const r = Math.round(n * 1e10) / 1e10;
		if (Math.abs(r) >= 1e12 || (r !== 0 && Math.abs(r) < 1e-6)) {
			return r.toExponential(4);
		}
		return String(r);
	}

	private digit(d: string): void {
		if (this.fresh) {
			this.state.display = d === "." ? "0." : d;
			this.fresh = false;
			return;
		}
		const cur = this.state.display;
		if (d === "." && cur.indexOf(".") >= 0) return;
		if (cur.replace(/[-.]/g, "").length >= 12) return;
		this.state.display = cur === "0" && d !== "." ? d : cur + d;
	}

	private current(): number {
		const v = parseFloat(this.state.display);
		return isFinite(v) ? v : 0;
	}

	private compute(): void {
		const cur = this.current();
		if (this.acc === null || this.op === null) {
			this.acc = cur;
			return;
		}
		let out = this.acc;
		if (this.op === "+") out = this.acc + cur;
		else if (this.op === "-") out = this.acc - cur;
		else if (this.op === "*") out = this.acc * cur;
		else if (this.op === "/") out = cur === 0 ? NaN : this.acc / cur;
		this.acc = out;
		this.state.display = this.fmt(out);
	}

	private setOp(op: string): void {
		if (!this.fresh || this.acc === null) this.compute();
		this.op = op;
		this.fresh = true;
		const sym = op === "*" ? "×" : op === "/" ? "÷" : op === "-" ? "−" : "+";
		this.state.expr = `${this.fmt(this.acc ?? 0)} ${sym}`;
	}

	private equals(): void {
		if (this.op === null) {
			this.acc = this.current();
			this.fresh = true;
			return;
		}
		const rhs = this.current();
		const sym =
			this.op === "*"
				? "×"
				: this.op === "/"
					? "÷"
					: this.op === "-"
						? "−"
						: "+";
		const lhs = this.acc ?? 0;
		this.compute();
		this.state.expr = `${this.fmt(lhs)} ${sym} ${this.fmt(rhs)} =`;
		this.op = null;
		this.fresh = true;
	}

	private negate(): void {
		this.state.display = this.fmt(this.current() * -1);
	}

	private percent(): void {
		this.state.display = this.fmt(this.current() / 100);
		this.fresh = false;
	}

	private clear(): void {
		this.acc = null;
		this.op = null;
		this.fresh = true;
		this.state.display = "0";
		this.state.expr = "";
	}
}
registerAetherWidget("calculator", () => new CalculatorWidget());

// ---------------------------------------------------------------------------
// Shortcuts (pinned apps)
// ---------------------------------------------------------------------------

class ShortcutsWidget extends AetherWidget {
	override id = "shortcuts";
	override title = "Pinned";
	override icon = "push_pin";
	override size: AetherWidgetSize = "wide";

	state: Stateful<{
		apps: Array<{ name: string; icon: string; pkg: string }>;
	}> = $state({
		apps: [] as Array<{ name: string; icon: string; pkg: string }>,
	});

	override available(): boolean {
		const a = anuraGlobal();
		return !!(a && a.apps);
	}

	override render(): HTMLElement {
		return (
			<div class="pins">
				{use(this.state.apps, (apps) =>
					apps.length === 0
						? [
								(
									<div class="widget-note">Nothing pinned yet.</div>
								) as HTMLElement,
							]
						: apps.map((a) => (
								<button
									type="button"
									class="pin"
									title={a.name}
									on:click={() => this.launch(a.pkg)}
								>
									<img class="pin-icon" src={a.icon} alt="" />
									<span class="pin-name">{a.name}</span>
								</button>
							)),
				)}
			</div>
		) as HTMLElement;
	}

	override onShow(): void {
		this.every(4000, () => this.collect());
	}

	private collect(): void {
		const a = anuraGlobal();
		if (!a || !a.apps) return;
		let list: string[] = [];
		try {
			list = a.settings?.get("applist") || [];
		} catch {
			list = [];
		}
		const out: Array<{ name: string; icon: string; pkg: string }> = [];
		for (const pkg of list) {
			const app = a.apps[pkg];
			if (!app || app.hidden) continue;
			out.push({
				name: app.name || pkg,
				icon: app.icon || "",
				pkg,
			});
			if (out.length >= 8) break;
		}
		// Only reassign when something actually changed; otherwise every poll
		// tears down and rebuilds the tile list.
		const sig = out.map((o) => o.pkg).join("|");
		if (sig !== this.state.apps.map((o) => o.pkg).join("|")) {
			this.state.apps = out;
		}
	}

	private launch(pkg: string): void {
		try {
			const a = anuraGlobal();
			this.onLaunch();
			a?.apps?.[pkg]?.open();
		} catch (e) {
			console.warn("[widgets] failed to launch " + pkg, e);
		}
	}
}
registerAetherWidget("shortcuts", () => new ShortcutsWidget());

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

interface WidgetHostOptions {
	/** Explicit widget id order. Defaults to the saved order, then the stock one. */
	ids?: string[];
	/** Heading above the rail. Pass "" for no heading. */
	heading?: string;
	/** Called when a widget wants the launcher dismissed (e.g. app launch). */
	onLaunch?: () => void;
}

/**
 * Lays widgets out in the rail and owns their lifecycle.
 *
 * ```ts
 * const host = new WidgetHost({ onLaunch: () => this.hide() });
 * // …put host.element in the DOM…
 * host.setActive(true);   // start timers + network
 * host.setActive(false);  // stop everything
 * ```
 */
class WidgetHost {
	element: HTMLElement;
	widgets: AetherWidget[] = [];

	private active = false;

	constructor(options: WidgetHostOptions = {}) {
		const order =
			options.ids ||
			widgetSetting<string[]>("order", AETHER_WIDGET_DEFAULT_ORDER) ||
			AETHER_WIDGET_DEFAULT_ORDER;

		for (const id of order) {
			const factory = AetherWidgetRegistry[id];
			if (!factory) continue;
			try {
				const w = factory();
				if (!w.available()) continue;
				if (options.onLaunch) w.onLaunch = options.onLaunch;
				this.widgets.push(w);
			} catch (e) {
				console.warn(`[widgets] ${id} failed to construct`, e);
			}
		}

		const heading = options.heading === undefined ? "Widgets" : options.heading;

		this.element = (
			<div class="widget-rail">
				{heading
					? ((
							<div class="widget-rail-head">
								<span class="widget-rail-title">{heading}</span>
								<span class="widget-rail-sub">
									{new Date().toLocaleDateString(navigator.language, {
										weekday: "long",
										month: "long",
										day: "numeric",
									})}
								</span>
							</div>
						) as HTMLElement)
					: ""}
				<div class="widget-grid">{this.widgets.map((w) => this.card(w))}</div>
			</div>
		) as HTMLElement;
	}

	/** Build one card. A throwing widget yields a placeholder, not a crash. */
	private card(w: AetherWidget): HTMLElement {
		let body: HTMLElement;
		try {
			body = w.render();
		} catch (e) {
			console.error(`[widgets] ${w.id} failed to render`, e);
			body = (
				<div class="widget-fail">
					<span class="material-symbols-outlined">error</span>
					<span>Couldn't load this widget.</span>
				</div>
			) as HTMLElement;
		}

		let accessory: HTMLElement | null = null;
		try {
			accessory = w.renderAccessory();
		} catch (e) {
			console.warn(`[widgets] ${w.id} accessory failed`, e);
		}

		const head = w.chrome
			? ((
					<div class="widget-head">
						<span class="widget-head-icon material-symbols-outlined">
							{w.icon}
						</span>
						<span class="widget-head-title">{w.title}</span>
						<span class="widget-head-accessory">{accessory || ""}</span>
					</div>
				) as HTMLElement)
			: "";

		return (
			<section class={`widget-card widget-${w.size}`} data-widget={w.id}>
				{head}
				<div class="widget-body">{body}</div>
			</section>
		) as HTMLElement;
	}

	/** Start every widget (timers, fetches). Idempotent. */
	mount(): void {
		if (this.active) return;
		this.active = true;
		for (const w of this.widgets) w.start();
	}

	/** Stop every widget. Idempotent. */
	unmount(): void {
		if (!this.active) return;
		this.active = false;
		for (const w of this.widgets) w.stop();
	}

	/** Convenience for `useChange(use(this.state.active), …)` in the launcher. */
	setActive(active: boolean): void {
		if (active) this.mount();
		else this.unmount();
	}

	/** Restart every widget — a cheap "refresh all". */
	refresh(): void {
		if (!this.active) return;
		for (const w of this.widgets) {
			w.stop();
			w.start();
		}
	}
}

/*
 * Everything here compiles to a plain script sharing one global scope, but a
 * `class` declaration creates a *lexical* binding rather than a property on
 * globalThis — so `globalThis.WidgetHost` is undefined even though bare
 * `WidgetHost` resolves. Consumers that feature-detect the rail (Launcher does,
 * so a missing Widgets.js degrades to a plain app grid) need the property form.
 */
(globalThis as any).AetherWidget = AetherWidget;
(globalThis as any).WidgetHost = WidgetHost;
