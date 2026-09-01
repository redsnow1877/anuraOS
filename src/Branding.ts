/**
 * Everything user-visible about the shell's identity lives here.
 *
 * Rename the product by editing this file — nothing else hardcodes the name.
 * (The upstream project this is built on is AGPL-3.0; LICENSE and CREDITS.md
 * stay as they are regardless of what the shell calls itself.)
 */
const BRANDING = {
	/** Product name shown in the menu bar, boot splash and window titles. */
	name: "Aether",
	/** Slightly longer form for About/OOBE copy. */
	fullName: "Aether Desktop",
	tagline: "A desktop that lives in your tab.",
	/** Used as the accent seed and the boot splash glow. */
	accent: "#7a6cff",
};

(globalThis as any).BRANDING = BRANDING;
