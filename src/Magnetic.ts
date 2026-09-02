/**
 * Aether — magnetic pointer attraction
 * ---------------------------------------------------------------------------
 * Ported from the React `MagneticButton` pattern. The React version keeps the
 * offset in component state and hands it to a spring; here the element owns two
 * custom properties and CSS does the easing, which means:
 *
 *   - no per-frame React render, and no framework at all;
 *   - the target composes rather than conflicts. Magnetic sets `--mag-x` and
 *     `--mag-y` only; the element's own stylesheet decides how to spend them,
 *     so an existing `:active { scale(.94) }` keeps working.
 *
 * Usage
 * -----
 *     AetherMagnetic.attach(el, { strength: 0.35, maxDistance: 22 });
 *     AetherMagnetic.scan(root);   // picks up every [data-magnetic] under root
 *     AetherMagnetic.detach(el);
 *
 * `data-magnetic` may carry a strength: `data-magnetic="0.5"`.
 *
 * The element must opt in from CSS, e.g.
 *     transform: translate3d(var(--mag-x, 0px), var(--mag-y, 0px), 0);
 */

interface MagneticOptions {
	/** Fraction of the cursor's offset from centre that the element follows. */
	strength?: number;
	/** Cap on the offset, in px. */
	maxDistance?: number;
	/**
	 * How far outside the element's own box the field extends, in px. The
	 * React original only tracks while the pointer is over the element; a
	 * padded field is what makes icons *lean* toward an approaching cursor.
	 */
	padding?: number;
}

interface MagneticBinding {
	options: Required<MagneticOptions>;
	move: (e: PointerEvent) => void;
	leave: () => void;
}

class AetherMagnetic {
	static readonly SETTING_KEY = "magnetic-icons";

	private static bindings = new WeakMap<HTMLElement, MagneticBinding>();
	private static coarse: MediaQueryList | null = null;

	static readonly DEFAULTS: Required<MagneticOptions> = {
		strength: 0.34,
		maxDistance: 20,
		padding: 26,
	};

	/** False on touch devices, or when the user has turned the effect off. */
	static get enabled(): boolean {
		if (this.coarse === null && typeof window.matchMedia === "function") {
			this.coarse = window.matchMedia("(pointer: coarse)");
		}
		if (this.coarse?.matches) return false;
		try {
			if (anura?.settings?.get("disable-animation")) return false;
			if (anura?.settings?.has?.(this.SETTING_KEY)) {
				return anura.settings.get(this.SETTING_KEY) !== false;
			}
		} catch {
			/* settings may not exist yet during boot */
		}
		return true;
	}

	static attach(el: HTMLElement | null, options: MagneticOptions = {}): void {
		if (!el || this.bindings.has(el)) return;

		const resolved: Required<MagneticOptions> = {
			...this.DEFAULTS,
			...options,
		};

		const move = (e: PointerEvent) => {
			if (!AetherMagnetic.enabled) return AetherMagnetic.reset(el);

			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const pad = resolved.padding;

			// Outside the padded field the element goes home. Checked against
			// the rect rather than relying on pointerleave, because the field
			// is larger than the element that receives the events.
			if (
				e.clientX < r.left - pad ||
				e.clientX > r.right + pad ||
				e.clientY < r.top - pad ||
				e.clientY > r.bottom + pad
			) {
				return AetherMagnetic.reset(el);
			}

			let x = (e.clientX - cx) * resolved.strength;
			let y = (e.clientY - cy) * resolved.strength;

			const distance = Math.hypot(x, y);
			if (distance > resolved.maxDistance) {
				const scale = resolved.maxDistance / distance;
				x *= scale;
				y *= scale;
			}

			el.style.setProperty("--mag-x", `${x.toFixed(2)}px`);
			el.style.setProperty("--mag-y", `${y.toFixed(2)}px`);
			el.classList.add("is-magnetized");
		};

		const leave = () => AetherMagnetic.reset(el);

		el.addEventListener("pointermove", move);
		el.addEventListener("pointerleave", leave);
		el.addEventListener("pointercancel", leave);
		this.bindings.set(el, { options: resolved, move, leave });
	}

	static detach(el: HTMLElement | null): void {
		if (!el) return;
		const binding = this.bindings.get(el);
		if (!binding) return;
		el.removeEventListener("pointermove", binding.move);
		el.removeEventListener("pointerleave", binding.leave);
		el.removeEventListener("pointercancel", binding.leave);
		this.bindings.delete(el);
		this.reset(el);
	}

	/** Send an element home and drop the "currently pulled" marker. */
	static reset(el: HTMLElement): void {
		el.style.removeProperty("--mag-x");
		el.style.removeProperty("--mag-y");
		el.classList.remove("is-magnetized");
	}

	/**
	 * Attach to everything under `root` carrying `data-magnetic`. Safe to call
	 * repeatedly — `attach` skips elements that are already bound, so this is
	 * the right thing to call after re-rendering a list.
	 */
	static scan(root: ParentNode = document): void {
		root
			.querySelectorAll<HTMLElement>("[data-magnetic]")
			.forEach((el) =>
				this.attach(el, { strength: Number(el.dataset.magnetic) || undefined }),
			);
	}

	/** Release every currently-pulled element, e.g. when a panel closes. */
	static releaseAll(root: ParentNode = document): void {
		root
			.querySelectorAll<HTMLElement>(".is-magnetized")
			.forEach((el) => this.reset(el));
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherMagnetic = AetherMagnetic;
