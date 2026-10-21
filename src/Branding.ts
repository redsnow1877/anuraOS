/**
 * Everything user-visible about the shell's identity lives here.
 *
 * Rename the product by editing this file — nothing else hardcodes the name.
 * (The upstream project this is built on is AGPL-3.0; LICENSE and CREDITS.md
 * stay as they are regardless of what the shell calls itself.)
 */
const BRANDING = {
	/** Product name shown in the dock, boot splash and window titles. */
	name: "Dimension",
	/** Slightly longer form for About/OOBE copy. */
	fullName: "Dimension OS",
	tagline: "A whole computer, one tab deep.",
	/** Used as the accent seed and the boot splash glow. */
	accent: "#7a6cff",

	/**
	 * The mark: an isometric cube, lit from above. `mono` draws it in
	 * currentColor with the faces told apart by opacity (for use on a colored
	 * button); otherwise each face gets its own shade of the accent.
	 */
	mark(opts: { size?: number; mono?: boolean; className?: string } = {}) {
		const s = opts.size ?? 24;
		const cls = opts.className ? ` class="${opts.className}"` : "";
		const top = opts.mono ? 'fill="currentColor"' : 'fill="#c9c2ff"';
		const left = opts.mono
			? 'fill="currentColor" fill-opacity="0.62"'
			: 'fill="#7a6cff"';
		const right = opts.mono
			? 'fill="currentColor" fill-opacity="0.34"'
			: 'fill="#3f31b8"';
		return (
			`<svg${cls} width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true">` +
			`<path ${top} d="M32 5 57 19 32 33 7 19Z"/>` +
			`<path ${left} d="M7 19 32 33V60L7 46Z"/>` +
			`<path ${right} d="M57 19 32 33V60L57 46Z"/>` +
			"</svg>"
		);
	},
};

(globalThis as any).BRANDING = BRANDING;
