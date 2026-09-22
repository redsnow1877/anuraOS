/**
 * Aether — battery status in the menu bar.
 * ---------------------------------------------------------------------------
 * A drawn battery whose fill tracks the charge (green while charging, red
 * when low), with the percentage beside it. Plugging in flashes a charging
 * level in the menu bar island; dropping to 20% and 10% on battery warns once
 * each, with a notification and a red flash.
 *
 * Browsers without the Battery Status API (Firefox, Safari) show nothing.
 * Desktops report "charging, full, zero time to full" forever, which is
 * indistinguishable from a laptop sitting full on its charger; the indicator
 * hides in that state and appears as soon as anything changes.
 */

class AetherBattery {
	static readonly PERCENT_KEY = "aether.battery.percent";

	static #battery: any = null;
	static #el: HTMLElement | null = null;
	static #warned = new Set<number>();

	static get showPercent(): boolean {
		return anura.settings.get(this.PERCENT_KEY) !== false;
	}

	static #looksLikeDesktop(b: any): boolean {
		return b.charging && b.level >= 1 && b.chargingTime === 0;
	}

	static #build(): HTMLElement {
		const el = document.createElement("div");
		el.className = "menubar-item battery-indicator";
		el.innerHTML = `
			<span class="batt-pct"></span>
			<svg class="batt-svg" viewBox="0 0 27 13" aria-hidden="true">
				<rect x="0.75" y="0.75" width="22.5" height="11.5" rx="3.4" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5"/>
				<rect class="batt-lvl" x="2.5" y="2.5" width="19" height="8" rx="1.9"/>
				<path d="M24.8 4.4v4.2a2.1 2.1 0 0 0 0-4.2Z" fill="currentColor" fill-opacity="0.45"/>
				<path class="batt-bolt" d="M13.4 1.6 8.6 7.3h3.3l-1.3 4.1 4.8-5.7h-3.3Z"/>
			</svg>`;
		el.addEventListener("click", () => this.#flash());
		return el;
	}

	static #describe(): string {
		const b = this.#battery;
		const pct = Math.round(b.level * 100);
		const time = (s: number) => {
			const m = Math.round(s / 60);
			return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
		};
		if (b.charging) {
			if (pct >= 100) return `Battery ${pct}%: fully charged`;
			return Number.isFinite(b.chargingTime) && b.chargingTime > 0
				? `Battery ${pct}%: ${time(b.chargingTime)} until full`
				: `Battery ${pct}%: charging`;
		}
		return Number.isFinite(b.dischargingTime) && b.dischargingTime > 0
			? `Battery ${pct}%: ${time(b.dischargingTime)} remaining`
			: `Battery ${pct}%`;
	}

	static #update() {
		const b = this.#battery;
		const el = this.#el;
		if (!b || !el) return;
		const pct = Math.round(b.level * 100);
		el.hidden = this.#looksLikeDesktop(b);
		el.classList.toggle("is-charging", !!b.charging);
		el.classList.toggle("is-low", !b.charging && pct <= 20);
		el.querySelector(".batt-pct")!.textContent = this.showPercent
			? pct + "%"
			: "";
		el.querySelector(".batt-lvl")!.setAttribute(
			"width",
			String(Math.max(1.5, 19 * b.level)),
		);
		el.title = this.#describe();

		if (b.charging) {
			this.#warned.clear();
			return;
		}
		// Warn once per threshold crossed; starting at 8% counts as both.
		const crossed = [20, 10].filter((at) => pct <= at);
		if (crossed.some((at) => !this.#warned.has(at))) {
			crossed.forEach((at) => this.#warned.add(at));
			anura.notifications.add({
				title: "Low Battery",
				description: `${pct}% remaining. Plug in soon.`,
				timeout: 8000,
			});
			this.#flash();
		}
	}

	/** Show the level in the island: green while charging, red when low. */
	static #flash() {
		const b = this.#battery;
		if (!b) return;
		const pct = Math.round(b.level * 100);
		(globalThis as any).AetherIsland?.hud(
			b.charging ? "bolt" : pct <= 20 ? "battery_alert" : "battery_full",
			b.level,
			{
				label: pct + "%",
				tone: b.charging ? "green" : pct <= 20 ? "red" : "",
				ms: 2600,
			},
		);
	}

	static async init() {
		const nav = navigator as any;
		if (typeof nav.getBattery !== "function") return;
		try {
			this.#battery = await nav.getBattery();
		} catch {
			return;
		}
		const host = document.getElementById("menubar-right");
		if (!host) return;
		// Written out so the Settings switch shows the default (on) as on.
		if (!anura.settings.has(this.PERCENT_KEY))
			anura.settings.set(this.PERCENT_KEY, true);
		this.#el = this.#build();
		// Beside the Spotlight button, before Control Center.
		const spot = host.querySelector('[title^="Spotlight"]');
		if (spot) spot.after(this.#el);
		else host.prepend(this.#el);

		const b = this.#battery;
		for (const type of [
			"levelchange",
			"chargingtimechange",
			"dischargingtimechange",
		])
			b.addEventListener(type, () => this.#update());
		b.addEventListener("chargingchange", () => {
			this.#update();
			if (b.charging) {
				(globalThis as any).aetherSound?.play?.("toggleOn");
				this.#flash();
			}
		});
		this.#update();
	}

	/** Settings calls this after the percentage switch changes. */
	static refresh() {
		this.#update();
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherBattery = AetherBattery;
