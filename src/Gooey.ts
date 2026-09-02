/**
 * Aether — gooey filter + expanding search
 * ---------------------------------------------------------------------------
 * Ported from the React `GooeyInput`. Same two pieces:
 *
 *   1. a per-instance SVG <filter> that blurs a subtree then crushes the alpha
 *      curve, so overlapping shapes fuse and separating ones stretch apart;
 *   2. a search control that expands from a pill, detaching an icon bubble
 *      that appears to be pulled out of the same blob.
 *
 * The React version drives the widths with `motion/react` variants and the
 * bubble with a shared `layoutId`. Neither is available here and neither is
 * needed — the transition is two CSS properties on a class toggle, which the
 * goo filter fuses for free.
 *
 * Two layers, and the split is not optional
 * -----------------------------------------
 * The alpha ramp in the filter (`0 0 0 20 -10`) multiplies alpha by 20 and
 * subtracts 10, so anything below ~0.5 alpha is crushed to nothing and the
 * `atop` composite then paints an empty box. The React original gets away with
 * one layer because `bg-foreground` is opaque; Aether's glass is not.
 *
 * So the shapes and the content live in separate layers:
 *
 *   .gooey-blobs    filtered, solid white shapes, dimmed by `opacity` on the
 *                   layer itself (opacity applies after the filter, so the goo
 *                   still fuses at full strength and only the result is glass)
 *   .gooey-content  unfiltered — the icon and the <input>, which must stay
 *                   crisp and must remain focusable and hit-testable
 *
 * Both layers key off the same `.is-expanded` class and the same width vars,
 * so they move as one.
 *
 * Usage
 * -----
 *     const s = new GooeySearch({
 *         placeholder: "Search",
 *         onInput: (v) => filter(v),
 *         onOpenChange: (open) => …,
 *     });
 *     host.appendChild(s.element);
 *     s.expand();  s.collapse();  s.focus();
 *     s.value = "";                 // read/write, does not fire onInput
 *
 * A note on ids: every instance mints its own filter id. Two controls sharing
 * one id is fine visually but breaks the moment one of them is removed from
 * the document, because the <defs> go with it.
 */

let gooeyIdCounter = 0;

interface GooeySearchOptions {
	placeholder?: string;
	/** Gaussian blur radius. Higher fuses from further apart, and costs more. */
	blur?: number;
	/** Start expanded — what the Launchpad wants, since search is the point. */
	expanded?: boolean;
	/** Collapse automatically when focus leaves and the field is empty. */
	collapseWhenEmpty?: boolean;
	onInput?: (value: string) => void;
	onOpenChange?: (open: boolean) => void;
	onKeyDown?: (e: KeyboardEvent) => void;
}

/**
 * Build the <svg><defs> carrying one goo filter and return its id. The node is
 * appended to `host` so it lives and dies with the control that uses it.
 */
function gooeyFilterDefs(host: HTMLElement, blur: number): string {
	const id = `aether-goo-${++gooeyIdCounter}`;
	const NS = "http://www.w3.org/2000/svg";

	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("class", "gooey-defs");
	svg.setAttribute("aria-hidden", "true");

	const defs = document.createElementNS(NS, "defs");
	const filter = document.createElementNS(NS, "filter");
	filter.setAttribute("id", id);
	// A filter region larger than the box, or the blur clips at the edges and
	// the blob squares off exactly where it should be softest.
	filter.setAttribute("x", "-50%");
	filter.setAttribute("y", "-50%");
	filter.setAttribute("width", "200%");
	filter.setAttribute("height", "200%");

	const gaussian = document.createElementNS(NS, "feGaussianBlur");
	gaussian.setAttribute("in", "SourceGraphic");
	gaussian.setAttribute("stdDeviation", String(blur));
	gaussian.setAttribute("result", "blur");

	// The alpha ramp: multiply alpha hard and subtract, so the blur's soft
	// shoulder is pushed back to either fully opaque or fully clear.
	const matrix = document.createElementNS(NS, "feColorMatrix");
	matrix.setAttribute("in", "blur");
	matrix.setAttribute("type", "matrix");
	matrix.setAttribute(
		"values",
		"1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10",
	);
	matrix.setAttribute("result", "goo");

	// Put the crisp original back on top so text stays readable.
	const composite = document.createElementNS(NS, "feComposite");
	composite.setAttribute("in", "SourceGraphic");
	composite.setAttribute("in2", "goo");
	composite.setAttribute("operator", "atop");

	filter.append(gaussian, matrix, composite);
	defs.appendChild(filter);
	svg.appendChild(defs);
	host.appendChild(svg);

	return id;
}

class GooeySearch {
	element: HTMLElement;
	input: HTMLInputElement;

	private field: HTMLElement;
	private opts: GooeySearchOptions;
	private expanded = false;

	constructor(options: GooeySearchOptions = {}) {
		this.opts = options;

		this.element = document.createElement("div");
		this.element.className = "gooey-search";

		const filterId = gooeyFilterDefs(this.element, options.blur ?? 5);

		// --- layer 1: the goo. Solid shapes only, nothing readable. ---
		this.field = document.createElement("div");
		this.field.className = "gooey-blobs";
		this.field.style.filter = `url(#${filterId})`;
		this.field.setAttribute("aria-hidden", "true");

		const blobRow = document.createElement("div");
		blobRow.className = "gooey-blob-row";
		const blobBubble = document.createElement("div");
		blobBubble.className = "gooey-blob-bubble";
		this.field.append(blobRow, blobBubble);

		// --- layer 2: the content. Crisp, focusable, unfiltered. ---
		const content = document.createElement("div");
		content.className = "gooey-content";

		const trigger = document.createElement("div");
		trigger.className = "gooey-search-trigger";

		const glyph = document.createElement("span");
		glyph.className = "material-symbols-outlined";
		glyph.textContent = "search";

		this.input = document.createElement("input");
		this.input.className = "gooey-search-input";
		this.input.type = "text";
		this.input.spellcheck = false;
		this.input.autocomplete = "off";
		this.input.placeholder = options.placeholder ?? "Search";

		trigger.append(glyph, this.input);
		content.appendChild(trigger);

		const bubble = document.createElement("div");
		bubble.className = "gooey-search-bubble";
		const bubbleGlyph = document.createElement("span");
		bubbleGlyph.className = "material-symbols-outlined";
		bubbleGlyph.textContent = "search";
		bubble.appendChild(bubbleGlyph);
		content.appendChild(bubble);

		this.element.append(this.field, content);

		trigger.addEventListener("pointerdown", () => this.focus());
		bubble.addEventListener("pointerdown", () => this.focus());
		this.input.addEventListener("input", () =>
			this.opts.onInput?.(this.input.value),
		);
		this.input.addEventListener("focus", () => this.expand());
		this.input.addEventListener("blur", () => {
			if (this.opts.collapseWhenEmpty && !this.input.value) this.collapse();
		});
		if (this.opts.onKeyDown) {
			this.input.addEventListener("keydown", this.opts.onKeyDown);
		}

		if (options.expanded) this.expand();
	}

	get value(): string {
		return this.input.value;
	}

	set value(next: string) {
		this.input.value = next;
	}

	expand(): void {
		if (this.expanded) return;
		this.expanded = true;
		this.element.classList.add("is-expanded");
		this.opts.onOpenChange?.(true);
	}

	collapse(): void {
		if (!this.expanded) return;
		this.expanded = false;
		this.element.classList.remove("is-expanded");
		this.opts.onOpenChange?.(false);
	}

	focus(): void {
		this.expand();
		this.input.focus();
	}

	/** Clear without firing `onInput` — for callers already re-filtering. */
	reset(): void {
		this.input.value = "";
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).GooeySearch = GooeySearch;
(globalThis as any).gooeyFilterDefs = gooeyFilterDefs;
