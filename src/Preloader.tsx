/**
 * Aether — Preloader
 * ---------------------------------------------------------------------------
 * A loading indicator with interchangeable style variants, used for the boot
 * splash and available to apps as a drop-in busy state.
 *
 * This is deliberately not a component library import. The shell has no module
 * system and no React — every file here compiles to a plain script sharing one
 * global scope — so the component is written directly against that, in the
 * design language the rest of Aether already uses (Motion.css tokens, the
 * glass palette, `--theme-accent`).
 *
 * Usage
 * -----
 *     const el = aetherPreloader({ variant: "orbit", label: "Starting up" });
 *     container.appendChild(el);
 *
 *     const p = new AetherPreloader({ variant: "bars", determinate: true });
 *     container.appendChild(p.element);
 *     p.setProgress(0.4);          // 0..1, determinate variants only
 *     p.setLabel("Mounting disks");
 *     p.setVariant("arc");         // swap live
 *     p.destroy();                 // stops timers, removes the node
 *
 * Every variant is pure CSS motion driven by Preloader.css. Nothing here runs
 * a rAF loop, so an idle preloader costs nothing.
 */

type PreloaderVariant = "orbit" | "bars" | "pulse" | "arc" | "glyph" | "stripe";

interface PreloaderOptions {
	/** Which look. Unknown names fall back to `orbit`. */
	variant?: PreloaderVariant | string;
	/** Caption under the indicator. Omit for a bare indicator. */
	label?: string;
	/** Show a percentage track that you drive with `setProgress`. */
	determinate?: boolean;
	/** `sm` 28px · `md` 44px · `lg` 72px. Default `md`. */
	size?: "sm" | "md" | "lg";
	/** Fill the parent and dim behind the indicator — for a full-screen wait. */
	overlay?: boolean;
}

const AETHER_PRELOADER_VARIANTS: PreloaderVariant[] = [
	"orbit",
	"bars",
	"pulse",
	"arc",
	"glyph",
	"stripe",
];

class AetherPreloader {
	static readonly VARIANTS = AETHER_PRELOADER_VARIANTS;
	static readonly SETTING_KEY = "preloader-variant";

	element: HTMLElement;

	private stage: HTMLElement;
	private labelEl: HTMLElement | null = null;
	private trackFill: HTMLElement | null = null;
	private variant: PreloaderVariant;
	private opts: PreloaderOptions;

	constructor(options: PreloaderOptions = {}) {
		this.opts = options;
		this.variant = AetherPreloader.normalize(options.variant);

		this.stage = document.createElement("div");
		this.stage.className = "preloader-stage";

		this.element = document.createElement("div");
		this.element.className = [
			"aether-preloader",
			`preloader-${options.size || "md"}`,
			options.overlay ? "preloader-overlay" : "",
		]
			.filter(Boolean)
			.join(" ");
		this.element.setAttribute("role", "status");
		this.element.setAttribute("aria-live", "polite");
		this.element.appendChild(this.stage);

		if (options.label !== undefined) {
			this.labelEl = document.createElement("div");
			this.labelEl.className = "preloader-label";
			this.labelEl.textContent = options.label;
			this.element.appendChild(this.labelEl);
		}

		if (options.determinate) {
			const track = document.createElement("div");
			track.className = "preloader-track";
			this.trackFill = document.createElement("span");
			this.trackFill.className = "preloader-track-fill";
			track.appendChild(this.trackFill);
			this.element.appendChild(track);
			this.setProgress(0);
		}

		this.paint();
	}

	/** Coerce anything to a known variant so a stale setting can't blank it. */
	static normalize(value: unknown): PreloaderVariant {
		return AETHER_PRELOADER_VARIANTS.includes(value as PreloaderVariant)
			? (value as PreloaderVariant)
			: "orbit";
	}

	/** The variant the user picked in Settings, or `orbit`. */
	static preferred(): PreloaderVariant {
		try {
			if (typeof anura !== "undefined" && anura?.settings?.get) {
				return AetherPreloader.normalize(
					anura.settings.get(AetherPreloader.SETTING_KEY),
				);
			}
		} catch {
			/* settings may not exist this early in boot */
		}
		return "orbit";
	}

	setVariant(variant: PreloaderVariant | string): void {
		const next = AetherPreloader.normalize(variant);
		if (next === this.variant) return;
		this.variant = next;
		this.paint();
	}

	setLabel(text: string): void {
		if (!this.labelEl) {
			this.labelEl = document.createElement("div");
			this.labelEl.className = "preloader-label";
			this.element.insertBefore(this.labelEl, this.element.children[1] || null);
		}
		this.labelEl.textContent = text;
	}

	/** `value` is 0..1. No-op unless the preloader was built determinate. */
	setProgress(value: number): void {
		if (!this.trackFill) return;
		const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100;
		this.trackFill.style.width = `${pct}%`;
		this.element.setAttribute("aria-valuenow", String(Math.round(pct)));
	}

	destroy(): void {
		this.element.remove();
	}

	/**
	 * Rebuild the indicator for the current variant. Each one is a small fixed
	 * set of spans; the animation lives entirely in Preloader.css so swapping
	 * variants is just swapping markup.
	 */
	private paint(): void {
		this.stage.className = `preloader-stage preloader-${this.variant}`;
		this.stage.textContent = "";

		const spans = (n: number, cls: string) => {
			for (let i = 0; i < n; i++) {
				const s = document.createElement("span");
				s.className = cls;
				s.style.setProperty("--i", String(i));
				s.style.setProperty("--n", String(n));
				this.stage.appendChild(s);
			}
		};

		switch (this.variant) {
			case "bars":
				spans(5, "pl-bar");
				break;
			case "pulse":
				spans(3, "pl-pulse");
				break;
			case "arc":
				spans(2, "pl-arc");
				break;
			case "stripe":
				spans(1, "pl-stripe");
				break;
			case "glyph":
				// The boot mark itself, traced. Built from divs rather than an
				// <svg> because dreamland re-parses SVG subtrees, and this node
				// is handed to callers who may keep a reference to it.
				spans(3, "pl-glyph-edge");
				break;
			case "orbit":
			default:
				spans(3, "pl-orbit-ring");
				break;
		}
	}
}

/** One-liner for the common case: give me a preloader element. */
function aetherPreloader(options: PreloaderOptions = {}): HTMLElement {
	return new AetherPreloader({
		variant: options.variant ?? AetherPreloader.preferred(),
		...options,
	}).element;
}

/* Class declarations are lexical, not properties of globalThis — apps that
   feature-detect the preloader need the property form. See Widgets.tsx. */
(globalThis as any).AetherPreloader = AetherPreloader;
(globalThis as any).aetherPreloader = aetherPreloader;
