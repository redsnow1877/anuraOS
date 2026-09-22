/**
 * Aether — desktop widgets
 * ---------------------------------------------------------------------------
 * Any widget from the Launchpad rail can be pinned to the desktop (the pin on
 * a rail card, or "Widgets…" in the desktop's right-click menu). Pinned
 * widgets sit above the wallpaper and below every window, drag by their
 * header — their bodies hold real controls, like the scratchpad and the
 * calculator — and remember where they were put. Positions are stored as
 * fractions of the screen, so a resize or a different display keeps the
 * layout's shape rather than stranding widgets off-screen.
 */

interface DesktopWidgetEntry {
	/** Instance key, so the same widget type can be pinned twice. */
	key: string;
	id: string;
	x: number;
	y: number;
}

class AetherDesktopWidgets {
	static readonly KEY = "aether.desktopWidgets";
	static #layer: HTMLElement | null = null;
	static #live = new Map<string, { widget: AetherWidget; el: HTMLElement }>();

	static get entries(): DesktopWidgetEntry[] {
		try {
			const v = anura.settings.get(this.KEY);
			return Array.isArray(v) ? v : [];
		} catch {
			return [];
		}
	}

	static #save(entries: DesktopWidgetEntry[]) {
		anura.settings.set(this.KEY, entries);
	}

	static #width(size: string): number {
		return size === "wide" || size === "large" ? 380 : 184;
	}

	static init() {
		if (anura.platform.type === "mobile") return;
		const layer = document.createElement("div");
		// `widget-rail` scopes the widget styles (Widgets.css) to this layer.
		layer.id = "desktop-widgets";
		layer.className = "widget-rail";
		document.body.appendChild(layer);
		this.#layer = layer;
		for (const e of this.entries) this.#mount(e);
		// Widgets poll (clock, weather, system stats); pause while the tab is hidden.
		document.addEventListener("visibilitychange", () => {
			for (const { widget } of this.#live.values()) {
				if (document.hidden) widget.stop();
				else widget.start();
			}
		});
		window.addEventListener("resize", () => {
			for (const e of this.entries) {
				const live = this.#live.get(e.key);
				if (live) this.#place(live.el, e);
			}
		});
	}

	static #place(el: HTMLElement, e: DesktopWidgetEntry) {
		const layer = this.#layer!;
		const w = layer.clientWidth;
		const h = layer.clientHeight;
		const x = Math.max(0, Math.min(w - el.offsetWidth, e.x * w));
		const y = Math.max(0, Math.min(h - el.offsetHeight, e.y * h));
		el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
	}

	static #mount(entry: DesktopWidgetEntry) {
		const factory = AetherWidgetRegistry[entry.id];
		if (!factory || !this.#layer) return;
		let widget: AetherWidget;
		try {
			widget = factory();
			if (!widget.available()) return;
		} catch (e) {
			console.warn("[desktop widgets]", entry.id, e);
			return;
		}
		const card = WidgetHost.card(widget);
		const item = document.createElement("div");
		item.className = "dw-item";
		item.style.width = this.#width(widget.size) + "px";
		item.dataset.key = entry.key;
		const remove = document.createElement("button");
		remove.className = "dw-remove";
		remove.title = "Remove from desktop";
		remove.innerHTML = '<span class="material-symbols-outlined">close</span>';
		remove.addEventListener("click", () => this.remove(entry.key));
		item.append(card, remove);
		this.#layer.appendChild(item);
		this.#place(item, entry);
		widget.start();
		this.#live.set(entry.key, { widget, el: item });
		requestAnimationFrame(() => item.classList.add("is-in"));

		// Drag by the header only; everything else is the widget's to use.
		const grip = card.querySelector<HTMLElement>(".widget-head") || card;
		grip.classList.add("dw-grip");
		let drag: { sx: number; sy: number; ox: number; oy: number } | null = null;
		grip.addEventListener("pointerdown", (e) => {
			if ((e.target as Element).closest("button, input, textarea, a, select"))
				return;
			const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
				item.style.transform,
			);
			drag = {
				sx: e.clientX,
				sy: e.clientY,
				ox: Number(m?.[1] || 0),
				oy: Number(m?.[2] || 0),
			};
			grip.setPointerCapture(e.pointerId);
			item.classList.add("is-dragging");
		});
		grip.addEventListener("pointermove", (e) => {
			if (!drag) return;
			const layer = this.#layer!;
			// Snap to an 8px grid so a row of widgets lines up without effort.
			const snap = (v: number) => Math.round(v / 8) * 8;
			const x = Math.max(
				0,
				Math.min(
					layer.clientWidth - item.offsetWidth,
					snap(drag.ox + e.clientX - drag.sx),
				),
			);
			const y = Math.max(
				0,
				Math.min(
					layer.clientHeight - item.offsetHeight,
					snap(drag.oy + e.clientY - drag.sy),
				),
			);
			item.style.transform = `translate(${x}px, ${y}px)`;
		});
		const drop = () => {
			if (!drag) return;
			drag = null;
			item.classList.remove("is-dragging");
			const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
				item.style.transform,
			);
			const layer = this.#layer!;
			this.#save(
				this.entries.map((en) =>
					en.key === entry.key
						? {
								...en,
								x: Number(m?.[1] || 0) / layer.clientWidth,
								y: Number(m?.[2] || 0) / layer.clientHeight,
							}
						: en,
				),
			);
		};
		grip.addEventListener("pointerup", drop);
		grip.addEventListener("pointercancel", drop);
	}

	/**
	 * Pin a widget type. It's mounted first so its real size is known, then
	 * placed in the first spot that overlaps nothing: down the right edge,
	 * then the next column in, like icons on a desktop.
	 */
	static add(id: string) {
		if (!this.#layer || !AetherWidgetRegistry[id]) return;
		const layer = this.#layer;
		const entry: DesktopWidgetEntry = {
			key: id + "-" + Math.random().toString(36).slice(2, 7),
			id,
			x: 0,
			y: 0,
		};
		this.#mount(entry);
		const live = this.#live.get(entry.key);
		if (!live) return;
		const W = layer.clientWidth;
		const H = layer.clientHeight;
		const w = live.el.offsetWidth;
		const h = live.el.offsetHeight;
		const gap = 12;
		const taken = [...this.#live.entries()]
			.filter(([k]) => k !== entry.key)
			.map(([, v]) => {
				const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
					v.el.style.transform,
				);
				const x = Number(m?.[1] || 0);
				const y = Number(m?.[2] || 0);
				return { x, y, w: v.el.offsetWidth, h: v.el.offsetHeight };
			});
		const free = (x: number, y: number) =>
			taken.every(
				(r) =>
					x + w + gap <= r.x ||
					r.x + r.w + gap <= x ||
					y + h + gap <= r.y ||
					r.y + r.h + gap <= y,
			);
		let spot: [number, number] = [Math.max(0, W - w), 0];
		search: for (let x = W - w; x >= 0; x -= 8) {
			for (let y = 0; y + h <= H; y += 8) {
				if (free(x, y)) {
					spot = [x, y];
					break search;
				}
			}
		}
		entry.x = spot[0] / Math.max(1, W);
		entry.y = spot[1] / Math.max(1, H);
		this.#place(live.el, entry);
		this.#save([...this.entries, entry]);
		(globalThis as any).aetherSound?.play?.("toggleOn");
	}

	static remove(key: string) {
		const live = this.#live.get(key);
		if (live) {
			live.widget.stop();
			live.el.classList.remove("is-in");
			setTimeout(() => live.el.remove(), 200);
			this.#live.delete(key);
		}
		this.#save(this.entries.filter((e) => e.key !== key));
	}

	/** Pin buttons on the Launchpad rail's cards. */
	static decorateRail(rail: HTMLElement, onPinned?: () => void) {
		rail
			.querySelectorAll<HTMLElement>(".widget-card[data-widget]")
			.forEach((card) => {
				if (card.querySelector(".dw-pin")) return;
				const pin = document.createElement("button");
				pin.className = "dw-pin";
				pin.title = "Add to Desktop";
				pin.innerHTML =
					'<span class="material-symbols-outlined">push_pin</span>';
				pin.addEventListener("click", (e) => {
					e.stopPropagation();
					this.add(card.dataset.widget!);
					onPinned?.();
				});
				card.appendChild(pin);
			});
	}

	/** A small picker for the desktop's right-click menu. */
	static openPicker() {
		document.getElementById("dw-picker")?.remove();
		const sheet = document.createElement("div");
		sheet.id = "dw-picker";
		const panel = document.createElement("div");
		panel.className = "dw-picker-panel";
		const title = document.createElement("div");
		title.className = "dw-picker-title";
		title.textContent = "Add Widgets";
		panel.appendChild(title);
		for (const id of Object.keys(AetherWidgetRegistry)) {
			let w: AetherWidget;
			try {
				w = AetherWidgetRegistry[id]!();
				if (!w.available()) continue;
			} catch {
				continue;
			}
			// Text nodes, not innerHTML: widgets can be registered by
			// third-party code, and a title is not markup.
			const row = document.createElement("button");
			row.className = "dw-picker-row";
			const glyph = document.createElement("span");
			glyph.className = "material-symbols-outlined";
			glyph.textContent = w.icon;
			const name = document.createElement("span");
			name.textContent = w.title;
			const plus = document.createElement("span");
			plus.className = "material-symbols-outlined dw-plus";
			plus.textContent = "add_circle";
			row.append(glyph, name, plus);
			row.addEventListener("click", () => this.add(id));
			panel.appendChild(row);
		}
		const done = document.createElement("button");
		done.className = "dw-done";
		done.textContent = "Done";
		done.addEventListener("click", () => sheet.remove());
		panel.appendChild(done);
		sheet.appendChild(panel);
		sheet.addEventListener("pointerdown", (e) => {
			if (e.target === sheet) sheet.remove();
		});
		document.body.appendChild(sheet);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherDesktopWidgets = AetherDesktopWidgets;
