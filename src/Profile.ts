/**
 * Aether — the user's profile
 * ---------------------------------------------------------------------------
 * A name and an avatar, picked during setup and shown on the lock screen.
 * The avatar is either an emoji or the name's initials, on one of a handful
 * of gradients. Nothing here leaves the browser.
 */

interface AetherProfileData {
	name: string;
	/** Index into AetherProfile.COLORS. */
	color: number;
	/** An emoji, or "" for initials. */
	emoji: string;
}

class AetherProfile {
	static readonly KEY = "aether.user";

	static readonly COLORS: ReadonlyArray<[string, string]> = [
		["#b3a8ff", "#5a4cdc"],
		["#86c8ff", "#2f6fe0"],
		["#7ce8da", "#0f8f86"],
		["#a4e892", "#2f9e44"],
		["#ffd580", "#e0851e"],
		["#ffa991", "#df4650"],
		["#ffaad9", "#c23a8e"],
		["#c3c7d2", "#4b5060"],
	];

	static readonly EMOJI: ReadonlyArray<string> = [
		"🙂",
		"🐱",
		"🦊",
		"🐼",
		"🐸",
		"🦄",
		"🐙",
		"🌸",
		"🌙",
		"⚡",
		"🎧",
		"🎮",
		"🚀",
	];

	static get(): AetherProfileData {
		try {
			const v = anura.settings.get(this.KEY);
			if (v && typeof v === "object")
				return {
					name: typeof v.name === "string" ? v.name : "",
					color: Number.isInteger(v.color) ? v.color : 0,
					emoji: typeof v.emoji === "string" ? v.emoji : "",
				};
		} catch {
			/* anura isn't up yet */
		}
		return { name: "", color: 0, emoji: "" };
	}

	static set(p: AetherProfileData) {
		return anura.settings.set(this.KEY, {
			name: p.name.trim().slice(0, 40),
			color: p.color,
			emoji: p.emoji,
		});
	}

	static initials(name: string): string {
		const words = name.trim().split(/\s+/).filter(Boolean);
		if (!words.length) return "";
		const first = Array.from(words[0]!)[0] || "";
		const last =
			words.length > 1 ? Array.from(words[words.length - 1]!)[0] || "" : "";
		return (first + last).toUpperCase();
	}

	/** Paint an avatar into `el` (any size; the glyph scales with it). */
	static paint(el: HTMLElement, p: AetherProfileData = this.get()) {
		const [a, b] = this.COLORS[p.color] || this.COLORS[0]!;
		el.classList.add("aether-avatar");
		el.style.setProperty("--av-a", a);
		el.style.setProperty("--av-b", b);
		const glyph = p.emoji || this.initials(p.name);
		el.classList.toggle("is-emoji", !!p.emoji);
		if (glyph) {
			el.textContent = glyph;
		} else {
			el.innerHTML = '<span class="material-symbols-outlined">person</span>';
		}
	}
}

(globalThis as any).AetherProfile = AetherProfile;

/**
 * The profile editor Settings shows: avatar, name, colour, picture, and a way
 * back into the Setup Assistant. Saves as you go.
 */
function aetherProfileEditor(): HTMLElement {
	const p = AetherProfile.get();
	const root = document.createElement("div");
	root.className = "aether-profile-edit";

	const avatar = document.createElement("div");
	avatar.className = "ape-avatar";
	const input = document.createElement("input");
	input.className = "ape-name";
	input.type = "text";
	input.placeholder = "Your name";
	input.maxLength = 40;
	input.value = p.name;
	const top = document.createElement("div");
	top.className = "ape-top";
	top.append(avatar, input);

	let timer = 0;
	const save = () => {
		clearTimeout(timer);
		timer = window.setTimeout(() => AetherProfile.set(p), 250);
	};
	const paint = () => AetherProfile.paint(avatar, p);
	input.addEventListener("input", () => {
		p.name = input.value;
		paint();
		save();
	});

	const colors = document.createElement("div");
	colors.className = "ape-row";
	AetherProfile.COLORS.forEach(([a, b], i) => {
		const dot = document.createElement("button");
		dot.type = "button";
		dot.className = "ape-color" + (i === p.color ? " is-on" : "");
		dot.style.background = `linear-gradient(145deg, ${a}, ${b})`;
		dot.setAttribute("aria-label", "Colour " + (i + 1));
		dot.addEventListener("click", () => {
			p.color = i;
			colors
				.querySelectorAll(".ape-color")
				.forEach((d, j) => d.classList.toggle("is-on", j === i));
			paint();
			save();
		});
		colors.append(dot);
	});

	const glyphs = document.createElement("div");
	glyphs.className = "ape-row";
	["", ...AetherProfile.EMOJI].forEach((e) => {
		const b = document.createElement("button");
		b.type = "button";
		b.className =
			"ape-glyph" + (e ? "" : " is-initials") + (e === p.emoji ? " is-on" : "");
		b.textContent = e || "Aa";
		b.addEventListener("click", () => {
			p.emoji = e;
			glyphs
				.querySelectorAll(".ape-glyph")
				.forEach((d) => d.classList.toggle("is-on", d === b));
			paint();
			save();
		});
		glyphs.append(b);
	});

	const rerun = document.createElement("button");
	rerun.type = "button";
	rerun.className = "ape-rerun";
	rerun.innerHTML =
		'<span class="material-symbols-outlined">restart_alt</span>Run Setup Assistant again';
	rerun.addEventListener("click", async () => {
		const ok = await anura.dialog.confirm(
			`${BRANDING.name} will restart into the Setup Assistant. Your files and apps stay as they are.`,
		);
		if (!ok) return;
		await anura.settings.set("oobe-complete", false);
		location.reload();
	});

	paint();
	root.append(top, colors, glyphs, rerun);
	return root;
}

(globalThis as any).aetherProfileEditor = aetherProfileEditor;
