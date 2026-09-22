/**
 * Aether — RGB mode. Because a gaming setup without RGB is just a setup.
 * ---------------------------------------------------------------------------
 * A rainbow rim chases around the dock (with a soft glow), the menu bar
 * island and whichever window has focus.
 *
 * It costs almost nothing: each rim is a 64×64 canvas holding a conic
 * gradient, scaled up by CSS and spun with a `rotate` animation, which the
 * compositor runs on its own; a mask trims it to a thin ring. No per-frame
 * JavaScript, no repaints, and a texture the size of a desktop icon.
 */

class AetherRGB {
	static readonly KEY = "aether.rgb";
	static readonly SPEED_KEY = "aether.rgb.speed";
	static readonly COLORS = [
		"#ff1f5a",
		"#ff8a00",
		"#ffe600",
		"#3dff6e",
		"#00e5ff",
		"#2b6bff",
		"#b400ff",
		"#ff1f5a",
	];

	static #windowRim: HTMLElement | null = null;
	static #fixed: HTMLElement[] = [];
	static #listening = false;

	static get on(): boolean {
		return !!anura.settings.get(this.KEY);
	}

	/** Seconds per revolution: 0 (chill) → 8 s, 1 (party) → 1.2 s. */
	static get period(): number {
		const v = Number(anura.settings.get(this.SPEED_KEY));
		const speed = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.45;
		return 8 - speed * 6.8;
	}

	static set(on: boolean) {
		anura.settings.set(this.KEY, on);
		this.sync();
	}

	static #spinner(): HTMLCanvasElement {
		const c = document.createElement("canvas");
		c.width = c.height = 64;
		c.className = "rgb-spin";
		const g = c.getContext("2d")!;
		const grad = g.createConicGradient(0, 32, 32);
		this.COLORS.forEach((col, i) =>
			grad.addColorStop(i / (this.COLORS.length - 1), col),
		);
		g.fillStyle = grad;
		g.fillRect(0, 0, 64, 64);
		return c;
	}

	static #rim(cls: string): HTMLElement {
		const rim = document.createElement("div");
		rim.className = "rgb-rim " + cls;
		rim.setAttribute("aria-hidden", "true");
		rim.append(this.#spinner());
		return rim;
	}

	/** Every rim spins in step, even one that was just (re)attached. */
	static #phase(rim: HTMLElement) {
		const period = this.period * 1000;
		const spin = rim.querySelector<HTMLElement>(".rgb-spin")!;
		spin.style.animationDuration = period + "ms";
		spin.style.animationDelay = -(performance.now() % period) + "ms";
	}

	static #followFocus = () => {
		const win = document.querySelector<HTMLElement>(".aliceWMwin.focused");
		const rim = this.#windowRim;
		if (!rim) return;
		if (!win) {
			rim.remove();
			return;
		}
		if (rim.parentElement !== win) {
			win.append(rim);
			this.#phase(rim);
		}
	};

	static sync() {
		const on = this.on;
		document.body.classList.toggle("rgb-on", on);
		for (const el of this.#fixed) el.remove();
		this.#fixed = [];
		this.#windowRim?.remove();
		this.#windowRim = null;
		if (!on) return;

		const dock = document.getElementById("dock");
		if (dock) {
			// The glow is a thin ring blurred as a whole, so its light falls off
			// softly on both sides (blurring inside a mask would cut it off).
			const glow = document.createElement("div");
			glow.className = "rgb-glow";
			glow.setAttribute("aria-hidden", "true");
			glow.append(this.#rim("rgb-glow-ring"));
			const rim = this.#rim("rgb-dock");
			// Appended, not prepended: the dock's own children are managed by
			// its renderer, which shouldn't find strangers at the front.
			dock.append(glow, rim);
			this.#fixed.push(glow, rim);
		}
		const island = document.getElementById("island");
		if (island) {
			const rim = this.#rim("rgb-island");
			island.append(rim);
			this.#fixed.push(rim);
		}
		for (const el of this.#fixed) this.#phase(el);

		this.#windowRim = this.#rim("rgb-window");
		this.#followFocus();
		if (!this.#listening) {
			this.#listening = true;
			document.addEventListener("anura-window-focus", () =>
				this.#followFocus(),
			);
			document.addEventListener("anura-window-blur", () => this.#followFocus());
		}
	}

	static init() {
		AetherCommands.register({
			id: "rgb-mode",
			title: () => (this.on ? "Turn Off RGB Mode" : "Turn On RGB Mode"),
			subtitle: "Rainbow lighting for the dock and windows",
			icon: "palette",
			keywords: ["rgb", "rainbow", "gaming", "lights", "led", "glow"],
			run: () => this.set(!this.on),
		});
		if (this.on) this.sync();
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherRGB = AetherRGB;
