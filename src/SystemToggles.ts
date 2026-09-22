/**
 * Aether — Do Not Disturb, Night Shift, and the keyboard cheat sheet
 * ---------------------------------------------------------------------------
 * Do Not Disturb     notifications still land in the notification centre
 *                    (the badge still counts them), but no toast slides in
 *                    and no sound plays. Alarms from the Clock app still
 *                    ring: an alarm you set is a notification you asked for.
 *
 * Night Shift        a warm, multiply-blended layer over the whole screen,
 *                    pointer-events: none. It's a single composited layer,
 *                    so it costs one blend on the GPU rather than a filter
 *                    over every window (a `filter:` on an ancestor would
 *                    re-rasterise every iframe). Optional schedule.
 *
 * Shortcuts          Ctrl+/ shows every registered shortcut, generated from
 *                    AetherShortcuts rather than kept by hand, so it can't
 *                    fall out of date.
 */

class AetherDND {
	static readonly KEY = "aether.dnd";

	static get on(): boolean {
		try {
			return !!anura.settings.get(this.KEY);
		} catch {
			return false;
		}
	}

	static set(on: boolean) {
		anura.settings.set(this.KEY, on);
		this.sync();
	}

	static toggle() {
		this.set(!this.on);
	}

	static sync() {
		document.body.classList.toggle("dnd-on", this.on);
	}
}

class AetherNightShift {
	static readonly KEY = "aether.nightshift";
	static #el: HTMLElement | null = null;

	static get config(): {
		on: boolean;
		strength: number;
		schedule: "manual" | "evening";
	} {
		try {
			return {
				on: false,
				strength: 0.45,
				schedule: "manual",
				...(anura.settings.get(this.KEY) || {}),
			};
		} catch {
			return { on: false, strength: 0.45, schedule: "manual" };
		}
	}

	static save(
		patch: Partial<{
			on: boolean;
			strength: number;
			schedule: "manual" | "evening";
		}>,
	) {
		const next = { ...this.config, ...patch };
		anura.settings.set(this.KEY, next);
		// Mirrored flat so Control Center's tile (which reads one boolean key)
		// stays in step however Night Shift was switched.
		anura.settings.set("aether.nightshift.on", next.on);
		this.sync();
	}

	static toggle() {
		this.save({ on: !this.active });
	}

	/** Scheduled mode runs from 19:00 to 07:00 local time. */
	static get active(): boolean {
		const c = this.config;
		if (c.schedule === "evening") {
			const h = new Date().getHours();
			return h >= 19 || h < 7;
		}
		return c.on;
	}

	static sync() {
		if (!this.#el) {
			this.#el = document.createElement("div");
			this.#el.id = "night-shift";
			this.#el.setAttribute("aria-hidden", "true");
			document.body.appendChild(this.#el);
		}
		const c = this.config;
		this.#el.style.setProperty(
			"--ns",
			String(Math.max(0.05, Math.min(1, c.strength))),
		);
		this.#el.classList.toggle("is-on", this.active);
	}

	static init() {
		this.sync();
		// Re-evaluate the schedule each minute; a no-op in manual mode.
		setInterval(() => {
			if (this.config.schedule === "evening") this.sync();
		}, 60_000);
	}
}

/**
 * Brightness: a black layer over everything, like Night Shift a single
 * composited layer with pointer-events: none. Floored at 30% so it's
 * impossible to dim the screen into total darkness and lose the slider.
 */
class AetherBrightness {
	static readonly KEY = "aether.brightness";
	static readonly MIN = 0.3;
	static #el: HTMLElement | null = null;

	static get value(): number {
		try {
			const v = Number(anura.settings.get(this.KEY));
			return Number.isFinite(v) && v > 0
				? Math.max(this.MIN, Math.min(1, v))
				: 1;
		} catch {
			return 1;
		}
	}

	static set(v: number) {
		anura.settings.set(this.KEY, Math.max(this.MIN, Math.min(1, v)));
		this.sync();
	}

	static sync() {
		if (!this.#el) {
			this.#el = document.createElement("div");
			this.#el.id = "brightness-dim";
			this.#el.setAttribute("aria-hidden", "true");
			document.body.appendChild(this.#el);
		}
		this.#el.style.opacity = String(1 - this.value);
	}
}

/** Control Center's slider rows: brightness and master volume. */
function aetherControlSliders(): HTMLElement {
	const wrap = document.createElement("div");
	wrap.className = "cc-sliders";
	const row = (
		icons: [string, string],
		label: string,
		value: number,
		onInput: (v: number) => void,
	) => {
		const r = document.createElement("label");
		r.className = "cc-slider-row";
		const title = document.createElement("span");
		title.className = "cc-slider-label";
		title.textContent = label;
		const line = document.createElement("div");
		line.className = "aether-slider-row";
		const lo = document.createElement("span");
		lo.className = "material-symbols-outlined";
		lo.textContent = icons[0];
		const input = document.createElement("input");
		input.type = "range";
		input.className = "aether-slider";
		input.min = "0";
		input.max = "100";
		input.value = String(Math.round(value * 100));
		input.setAttribute("aria-label", label);
		const paint = () => input.style.setProperty("--v", input.value + "%");
		paint();
		input.addEventListener("input", () => {
			paint();
			onInput(Number(input.value) / 100);
		});
		const hi = document.createElement("span");
		hi.className = "material-symbols-outlined";
		hi.textContent = icons[1];
		line.append(lo, input, hi);
		r.append(title, line);
		return r;
	};
	const min = AetherBrightness.MIN;
	wrap.append(
		row(
			["brightness_low", "brightness_high"],
			"Display",
			(AetherBrightness.value - min) / (1 - min),
			(v) => AetherBrightness.set(min + v * (1 - min)),
		),
		row(
			["volume_mute", "volume_up"],
			"Sound",
			(() => {
				const v = Number(anura.settings.get("sound-volume"));
				return Number.isFinite(v) ? v : 0.4;
			})(),
			(v) => {
				anura.settings.set("sound-volume", v);
				(globalThis as any).AetherVolume?.dispatchEvent?.(new Event("change"));
			},
		),
	);
	// A tick on release, at the new volume, so the level is audible.
	wrap
		.querySelectorAll("input")[1]
		?.addEventListener("change", () =>
			(globalThis as any).aetherSound?.play?.("click"),
		);
	return wrap;
}

/** Broadcasts master-volume changes to anything playing audio (Music). */
const AetherVolume = new EventTarget();

class AetherShortcutSheet {
	static #el: HTMLElement | null = null;

	/** Shortcuts owned by other parts of the shell, not the registry. */
	static readonly BUILTIN: {
		group: string;
		combo: string;
		description: string;
	}[] = [
		{ group: "System", combo: "Meta", description: "Launchpad (press alone)" },
		{ group: "Windows", combo: "Shift+Tab", description: "Switch windows" },
	];

	static toggle() {
		if (this.#el) this.close();
		else this.open();
	}

	static open() {
		if (this.#el) return;
		const groups = new Map<string, { combo: string; description: string }[]>();
		const add = (g: string, combo: string, description: string) => {
			if (!groups.has(g)) groups.set(g, []);
			// Several combos for one action read better as one row.
			const rows = groups.get(g)!;
			const same = rows.find((r) => r.description === description);
			if (same) same.combo += "  or  " + combo;
			else rows.push({ combo, description });
		};
		for (const b of this.BUILTIN) add(b.group, b.combo, b.description);
		for (const s of AetherShortcuts.list) add(s.group, s.combo, s.description);

		const el = document.createElement("div");
		el.id = "shortcut-sheet";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-label", "Keyboard shortcuts");
		const panel = document.createElement("div");
		panel.className = "ss-panel";
		const title = document.createElement("div");
		title.className = "ss-title";
		title.innerHTML =
			'<span class="material-symbols-outlined">keyboard</span>Keyboard Shortcuts';
		const grid = document.createElement("div");
		grid.className = "ss-grid";
		for (const [group, rows] of groups) {
			const section = document.createElement("section");
			const h = document.createElement("h3");
			h.textContent = group;
			section.appendChild(h);
			for (const r of rows) {
				const row = document.createElement("div");
				row.className = "ss-row";
				const d = document.createElement("span");
				d.textContent = r.description;
				const keys = document.createElement("span");
				keys.className = "ss-keys";
				r.combo.split("  or  ").forEach((combo, i) => {
					if (i) {
						const or = document.createElement("span");
						or.className = "ss-or";
						or.textContent = "or";
						keys.appendChild(or);
					}
					for (const k of AetherShortcuts.pretty(combo)) {
						const kbd = document.createElement("kbd");
						kbd.textContent = k;
						keys.appendChild(kbd);
					}
				});
				row.append(d, keys);
				section.appendChild(row);
			}
			grid.appendChild(section);
		}
		const foot = document.createElement("div");
		foot.className = "ss-foot";
		foot.textContent = "Press Ctrl+/ or Esc to close";
		panel.append(title, grid, foot);
		el.appendChild(panel);
		el.addEventListener("pointerdown", (e) => {
			if (e.target === el) this.close();
		});
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				this.close();
			}
		};
		document.addEventListener("keydown", onKey, true);
		(el as any)._onKey = onKey;
		document.body.appendChild(el);
		requestAnimationFrame(() => el.classList.add("is-shown"));
		this.#el = el;
	}

	static close() {
		const el = this.#el;
		if (!el) return;
		this.#el = null;
		document.removeEventListener("keydown", (el as any)._onKey, true);
		el.classList.remove("is-shown");
		setTimeout(() => el.remove(), 200);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherDND = AetherDND;
(globalThis as any).AetherNightShift = AetherNightShift;
(globalThis as any).AetherShortcutSheet = AetherShortcutSheet;
(globalThis as any).AetherBrightness = AetherBrightness;
(globalThis as any).AetherVolume = AetherVolume;
(globalThis as any).aetherControlSliders = aetherControlSliders;
