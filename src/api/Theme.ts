interface ThemeProps {
	foreground: string;
	secondaryForeground: string;
	border: string;
	darkBorder: string;
	background: string;
	secondaryBackground: string;
	darkBackground: string;
	accent: string;
}

class Theme implements ThemeProps {
	get foreground() {
		return this.state.foreground;
	}

	set foreground(value) {
		this.state.foreground = value;
		this.apply();
	}

	get secondaryForeground() {
		return this.state.secondaryForeground;
	}

	set secondaryForeground(value) {
		this.state.secondaryForeground = value;
		this.apply();
	}

	get border() {
		return this.state.border;
	}

	set border(value) {
		this.state.border = value;
		this.apply();
	}

	get darkBorder() {
		return this.state.darkBorder;
	}

	set darkBorder(value) {
		this.state.darkBorder = value;
		this.apply();
	}

	get background() {
		return this.state.background;
	}

	set background(value) {
		this.state.background = value;
		this.apply();
	}

	get secondaryBackground() {
		return this.state.secondaryBackground;
	}

	set secondaryBackground(value) {
		this.state.secondaryBackground = value;
		this.apply();
	}

	get darkBackground() {
		return this.state.darkBackground;
	}

	set darkBackground(value) {
		this.state.darkBackground = value;
		this.apply();
	}

	get accent() {
		return this.state.accent;
	}

	set accent(value) {
		this.state.accent = value;
		this.apply();
	}

	state: Stateful<ThemeProps>;

	cssPropMap: Record<keyof ThemeProps, string[]> = {
		background: ["--theme-bg", "--material-bg"],
		border: ["--theme-border", "--material-border"],
		darkBorder: ["--theme-dark-border"],
		foreground: ["--theme-fg"],
		secondaryBackground: ["--theme-secondary-bg"],
		secondaryForeground: ["--theme-secondary-fg"],
		darkBackground: ["--theme-dark-bg"],
		// Matter's variables are deliberately absent here: it consumes the theme
		// colour as `rgb(var(...))`, so it needs a bare "r, g, b" triplet rather
		// than the hex the rest of the theme uses. Derived alongside the accent
		// below.
		accent: ["--theme-accent"],
	};

	/**
	 * "#7A6CFF" -> "122, 108, 255". Matter's component styles interpolate the
	 * theme colour into `rgb()` / `rgba()`, so they need the channels bare.
	 * Falls back to the default accent if handed something unparseable.
	 */
	static toRgbTriplet(hex: string): string {
		let h = (hex || "").trim().replace(/^#/, "");
		if (h.length === 3) {
			h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
		}
		if (!/^[0-9a-fA-F]{6}$/.test(h)) return "122, 108, 255";
		const n = parseInt(h, 16);
		return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
	}

	static new(json: { [key: string]: string }) {
		return new Theme(
			json["foreground"],
			json["secondaryForeground"],
			json["border"],
			json["darkBorder"],
			json["background"],
			json["secondaryBackground"],
			json["darkBackground"],
			json["accent"],
		);
	}

	constructor(
		foreground = "#FFFFFF",
		secondaryForeground = "#A7A7AF",
		border = "#3A3A42",
		darkBorder = "#0B0B0E",
		background = "#1C1C21",
		secondaryBackground = "#2A2A31",
		darkBackground = "#141418",
		accent = "#7A6CFF",
	) {
		this.state = $state<ThemeProps>({
			foreground,
			secondaryForeground,
			border,
			darkBorder,
			background,
			secondaryBackground,
			darkBackground,
			accent,
		});

		for (const key in this.state) {
			useChange(use(this.state[key as keyof ThemeProps]), (value) => {
				for (const prop of this.cssPropMap[key as keyof ThemeProps]) {
					document.body.style.setProperty(prop, value);
				}
				if (key === "accent") {
					const triplet = Theme.toRgbTriplet(value);
					document.body.style.setProperty("--theme-accent-rgb", triplet);
					// Every Matter component re-declares --matter-helper-theme from
					// --matter-theme-rgb in its own rule, so that local declaration
					// always beats one set here. --matter-theme-rgb is the knob that
					// actually reaches them.
					document.body.style.setProperty("--matter-theme-rgb", triplet);
					document.body.style.setProperty("--matter-helper-theme", triplet);
				}
			});
		}

		this.apply();
	}

	reset() {
		this.state.foreground = "#FFFFFF";
		this.state.secondaryForeground = "#A7A7AF";
		this.state.border = "#3A3A42";
		this.state.darkBorder = "#0B0B0E";
		this.state.background = "#1C1C21";
		this.state.secondaryBackground = "#2A2A31";
		this.state.darkBackground = "#141418";
		this.state.accent = "#7A6CFF";

		this.apply();
	}

	// This applies the theme to special elements that need to be updated manually
	// Ideally, this should be done automatically and if it is possible to do so
	// outside of this function, it should be done there instead. However, this
	// function should always remain here for the cases where it is not possible,
	// even if this function is empty.

	apply() {
		const darkBackground = this.state.darkBackground;
		document.querySelectorAll(".notification").forEach((el: HTMLElement) => {
			// this is sooo bad code bro
			el.style.background = darkBackground + "e6";
		});
		document.querySelectorAll("iframe").forEach((el: HTMLIFrameElement) => {
			el.contentWindow?.document.dispatchEvent(new Event("anura-theme-change"));
		});
	}

	css(): string {
		const lines = [];
		lines.push(":root {");
		for (const key in this.state) {
			for (const prop of this.cssPropMap[key as keyof ThemeProps]) {
				lines.push(`  ${prop}: ${this.state[key as keyof ThemeProps]};`);
			}
		}
		lines.push("}");
		return lines.join("\n");
	}
}
