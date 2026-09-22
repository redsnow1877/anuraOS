/**
 * Aether — global shortcuts and the command registry
 * ---------------------------------------------------------------------------
 * Two small registries the rest of the shell builds on:
 *
 *   AetherShortcuts   keyboard combos → handlers, with a description, so the
 *                     cheat-sheet overlay can list every shortcut from one
 *                     source of truth instead of a hand-maintained table.
 *   AetherCommands    named actions (Lock Screen, Mission Control, …) that
 *                     Spotlight searches and runs. Anything that registers a
 *                     command is automatically reachable from the keyboard.
 *
 * Keys typed into an app normally never reach the shell: app windows are
 * iframes, and key events don't cross frame boundaries. For same-origin
 * frames (which is what Aether's own apps are) we attach the same listener
 * inside each frame as it loads, so a registered combo works no matter which
 * window has focus. Only combos with a modifier are ever intercepted inside a
 * frame — plain typing is never touched. Cross-origin frames are skipped
 * silently; the browser won't let us in, and that's correct.
 */

interface AetherShortcut {
	/** Normalised combo, e.g. "Ctrl+Space", "Ctrl+Alt+L", "F3". */
	combo: string;
	description: string;
	/** Grouping for the cheat sheet. */
	group: string;
	handler: (e: KeyboardEvent) => void;
	/** Also intercept while an app frame has focus. Default true. */
	global?: boolean;
}

interface AetherCommand {
	id: string;
	/** Title, or a function for stateful commands ("Turn On Night Shift"). */
	title: string | (() => string);
	subtitle?: string | (() => string);
	/** Material Symbols name. */
	icon: string;
	/** Extra words Spotlight should match on. */
	keywords?: string[];
	/** Shortcut hint shown beside the command, if it has one. */
	shortcut?: string;
	run: () => void;
}

class AetherShortcuts {
	static readonly list: AetherShortcut[] = [];
	static #bound = new WeakSet<Window>();
	/** Set while the lock screen is up: no shortcut may reach past it. */
	static suspended = false;

	static register(shortcut: AetherShortcut) {
		const combo = AetherShortcuts.normalize(shortcut.combo);
		const existing = AetherShortcuts.list.findIndex((s) => s.combo === combo);
		const entry = { global: true, ...shortcut, combo };
		if (existing >= 0) AetherShortcuts.list[existing] = entry;
		else AetherShortcuts.list.push(entry);
	}

	/** Canonical modifier order so "alt+ctrl+l" and "Ctrl+Alt+L" match. */
	static normalize(combo: string): string {
		const parts = combo.split("+").map((p) => p.trim());
		const key = parts.pop() || "";
		const mods = new Set(parts.map((p) => p.toLowerCase()));
		const out: string[] = [];
		if (mods.has("ctrl") || mods.has("control")) out.push("Ctrl");
		if (mods.has("alt") || mods.has("option")) out.push("Alt");
		if (mods.has("shift")) out.push("Shift");
		if (mods.has("meta") || mods.has("cmd") || mods.has("super"))
			out.push("Meta");
		out.push(key.length === 1 ? key.toUpperCase() : key);
		return out.join("+");
	}

	/** The combo a keydown event represents, in normalised form. */
	static fromEvent(e: KeyboardEvent): string {
		let key = e.key;
		if (key === " ") key = "Space";
		else if (key.length === 1) key = key.toUpperCase();
		// Shift changes e.key for symbols ("/" → "?"); use the physical key
		// for those so "Ctrl+/" still matches with Shift held.
		if (e.code === "Slash") key = "/";
		const out: string[] = [];
		if (e.ctrlKey) out.push("Ctrl");
		if (e.altKey) out.push("Alt");
		if (e.shiftKey) out.push("Shift");
		if (e.metaKey) out.push("Meta");
		out.push(key);
		return out.join("+");
	}

	/** Pretty form for display: ⌃ ⌥ ⇧ ⌘ glyphs. */
	static pretty(combo: string): string[] {
		return AetherShortcuts.normalize(combo)
			.split("+")
			.map(
				(k) =>
					({
						Ctrl: "Ctrl",
						Alt: "Alt",
						Shift: "⇧",
						Meta: "⌘",
						Space: "Space",
						ArrowUp: "↑",
						ArrowDown: "↓",
						ArrowLeft: "←",
						ArrowRight: "→",
						Escape: "Esc",
						Enter: "⏎",
					})[k] || k,
			);
	}

	static #onKey(e: KeyboardEvent, inFrame: boolean) {
		if (e.repeat || AetherShortcuts.suspended) return;
		const combo = AetherShortcuts.fromEvent(e);
		const hit = AetherShortcuts.list.find((s) => s.combo === combo);
		if (!hit) return;
		if (inFrame) {
			// Inside an app, only take combos that carry a modifier or are
			// function keys — never a bare character the app wants typed.
			const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
			const isFunctionKey = /^F\d{1,2}$/.test(e.key);
			if (!hit.global || !(hasModifier || isFunctionKey)) return;
		}
		e.preventDefault();
		e.stopPropagation();
		try {
			hit.handler(e);
		} catch (err) {
			console.error(`[shortcuts] ${combo} failed`, err);
		}
	}

	/** Listen on a window (the shell, or a same-origin app frame). */
	static bind(win: Window, inFrame = false) {
		if (AetherShortcuts.#bound.has(win)) return;
		try {
			win.addEventListener(
				"keydown",
				(e: KeyboardEvent) => AetherShortcuts.#onKey(e, inFrame),
				true,
			);
			AetherShortcuts.#bound.add(win);
		} catch {
			/* cross-origin frame: not ours to listen to */
		}
	}

	/** Follow app frames as they appear and bind inside each one. */
	static init() {
		AetherShortcuts.bind(window);
		const bindFrame = (frame: HTMLIFrameElement) => {
			const attach = () => {
				try {
					if (frame.contentWindow)
						AetherShortcuts.bind(frame.contentWindow, true);
				} catch {
					/* cross-origin */
				}
			};
			attach();
			// A frame's window object is replaced on every navigation.
			frame.addEventListener("load", () => {
				try {
					// The old window is gone; allow binding the new one.
					if (frame.contentWindow)
						AetherShortcuts.#bound.delete(frame.contentWindow);
				} catch {
					/* cross-origin */
				}
				attach();
			});
		};
		document.querySelectorAll("iframe").forEach(bindFrame);
		new MutationObserver((records) => {
			for (const r of records) {
				r.addedNodes.forEach((n) => {
					if (n instanceof HTMLIFrameElement) bindFrame(n);
					else if (n instanceof Element)
						n.querySelectorAll("iframe").forEach(bindFrame);
				});
			}
		}).observe(document.body, { childList: true, subtree: true });
	}
}

class AetherCommands {
	static readonly list: AetherCommand[] = [];

	static register(command: AetherCommand) {
		const i = AetherCommands.list.findIndex((c) => c.id === command.id);
		if (i >= 0) AetherCommands.list[i] = command;
		else AetherCommands.list.push(command);
	}

	static title(c: AetherCommand): string {
		return typeof c.title === "function" ? c.title() : c.title;
	}

	static subtitle(c: AetherCommand): string {
		if (!c.subtitle) return "";
		return typeof c.subtitle === "function" ? c.subtitle() : c.subtitle;
	}

	static run(id: string) {
		AetherCommands.list.find((c) => c.id === id)?.run();
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherShortcuts = AetherShortcuts;
(globalThis as any).AetherCommands = AetherCommands;
