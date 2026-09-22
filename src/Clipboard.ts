/**
 * Aether — Emoji & Symbols, with clipboard history.
 * ---------------------------------------------------------------------------
 *   Ctrl+Shift+Space   emoji, kaomoji and symbols
 *   Ctrl+Alt+V         clipboard history
 *
 * The panel remembers where you were typing (inside an app's iframe too) and
 * inserts the pick there; if that isn't possible (a cross-origin frame, a
 * terminal) it copies instead. Shift-click to pick several in a row.
 *
 * Clipboard history records what's copied or cut anywhere in the system, and
 * what apps write with navigator.clipboard. It lives in memory only: copied
 * passwords shouldn't end up on disk. Pinned entries are the exception, and
 * are saved because you asked for them to be.
 */

type AetherPanelTab = "emoji" | "kaomoji" | "symbols" | "clipboard";

interface AetherClip {
	text: string;
	at: number;
	pinned?: boolean;
}

interface AetherTarget {
	el: HTMLElement;
	doc: Document;
	start: number;
	end: number;
	range: Range | null;
}

class AetherClipboard {
	static readonly PINNED_KEY = "aether.clipboard.pinned";
	static readonly RECENT_KEY = "aether.emoji.recent";
	static readonly MAX = 30;

	static history: AetherClip[] = [];

	static #el: HTMLElement | null = null;
	static #tab: AetherPanelTab = "emoji";
	static #target: AetherTarget | null = null;
	static #parsed: {
		emoji: { name: string; icon: string; items: [string, string][] }[];
		kaomoji: [string, string][];
		symbols: [string, string][];
	} | null = null;
	static #focusIndex = 0;
	static #writeText: ((t: string) => Promise<void>) | null = null;

	/* ---- history -------------------------------------------------------- */

	static record(text: string) {
		if (!text || !text.trim()) return;
		text = text.slice(0, 5000);
		const pinned = this.history.find((c) => c.text === text && c.pinned);
		this.history = this.history.filter((c) => c.text !== text || c.pinned);
		if (!pinned) this.history.unshift({ text, at: Date.now() });
		const keep = this.history.filter((c) => c.pinned);
		const loose = this.history.filter((c) => !c.pinned).slice(0, this.MAX);
		this.history = [...loose, ...keep].sort(
			(a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at,
		);
		if (this.#el && this.#tab === "clipboard") this.#render();
	}

	static #savePinned() {
		anura.settings.set(
			this.PINNED_KEY,
			this.history.filter((c) => c.pinned).map((c) => c.text),
		);
	}

	/** What's selected in `win` when a copy/cut happens there. */
	static #selectionIn(win: Window): string {
		const doc = win.document;
		const a = doc.activeElement as
			| HTMLInputElement
			| HTMLTextAreaElement
			| null;
		if (
			a &&
			(a.tagName === "TEXTAREA" || a.tagName === "INPUT") &&
			typeof a.selectionStart === "number" &&
			a.type !== "password"
		)
			return a.value.slice(a.selectionStart!, a.selectionEnd!);
		if (a && (a as HTMLInputElement).type === "password") return "";
		return win.getSelection()?.toString() || "";
	}

	static #watch(win: Window) {
		try {
			if ((win as any).__aetherClipWatched) return;
			(win as any).__aetherClipWatched = true;
			const onCopy = () => {
				// Read after the default action has put it on the clipboard.
				const text = this.#selectionIn(win);
				setTimeout(() => this.record(text), 0);
			};
			win.document.addEventListener("copy", onCopy, true);
			win.document.addEventListener("cut", onCopy, true);
			const cb = win.navigator.clipboard;
			if (cb && typeof cb.writeText === "function") {
				const orig = cb.writeText.bind(cb);
				if (win === window) this.#writeText = orig;
				cb.writeText = (text: string) => {
					this.record(String(text));
					return orig(text);
				};
			}
		} catch {
			/* cross-origin */
		}
	}

	/* ---- inserting ------------------------------------------------------ */

	/** The editable element that had focus, looking inside same-origin frames. */
	static #captureTarget(): AetherTarget | null {
		let doc: Document = document;
		let el = doc.activeElement as HTMLElement | null;
		for (let i = 0; i < 5 && el && el.tagName === "IFRAME"; i++) {
			try {
				const inner = (el as HTMLIFrameElement).contentDocument;
				if (!inner) return null;
				doc = inner;
				el = inner.activeElement as HTMLElement | null;
			} catch {
				return null;
			}
		}
		if (!el) return null;
		const input = el as HTMLInputElement;
		const textual =
			el.tagName === "TEXTAREA" ||
			(el.tagName === "INPUT" &&
				/^(text|search|url|email|tel|)$/.test(input.type || ""));
		if (textual)
			return {
				el,
				doc,
				start: input.selectionStart ?? input.value.length,
				end: input.selectionEnd ?? input.value.length,
				range: null,
			};
		if (el.isContentEditable) {
			const sel = doc.getSelection();
			return {
				el,
				doc,
				start: 0,
				end: 0,
				range: sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null,
			};
		}
		return null;
	}

	static async #insert(text: string): Promise<"inserted" | "copied"> {
		const t = this.#target;
		if (t && t.el.isConnected) {
			try {
				t.el.focus();
				if (t.range) {
					const sel = t.doc.getSelection();
					sel?.removeAllRanges();
					sel?.addRange(t.range);
					t.doc.execCommand("insertText", false, text);
					const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
					t.range = r ? r.cloneRange() : null;
					return "inserted";
				}
				if (!t.range && !t.el.isContentEditable) {
					const input = t.el as HTMLInputElement;
					input.setRangeText(text, t.start, t.end, "end");
					t.start = t.end = t.start + text.length;
					input.dispatchEvent(
						new InputEvent("input", {
							bubbles: true,
							inputType: "insertText",
							data: text,
						}),
					);
					return "inserted";
				}
			} catch {
				/* fall through to copying */
			}
		}
		try {
			await (
				this.#writeText ||
				navigator.clipboard.writeText.bind(navigator.clipboard)
			)(text);
		} catch {
			/* no clipboard access either; nothing more to try */
		}
		return "copied";
	}

	/* ---- data ----------------------------------------------------------- */

	/** "glyph words words": the glyph is the shortest prefix that leaves only
	 *  lowercase search words after it (kaomoji have spaces in them). */
	static #split(list: string): [string, string][] {
		return list
			.split("|")
			.map((e) => {
				const m = /^(.*?\S)\s+([a-z0-9][a-z0-9 '-]*)$/.exec(e.trim());
				return (m ? [m[1]!, m[2]!] : [e.trim(), ""]) as [string, string];
			})
			.filter(([g]) => g);
	}

	static #data() {
		if (!this.#parsed)
			this.#parsed = {
				emoji: AETHER_EMOJI.map(([name, icon, data]) => ({
					name,
					icon,
					items: this.#split(data),
				})),
				kaomoji: this.#split(AETHER_KAOMOJI),
				symbols: this.#split(AETHER_SYMBOLS),
			};
		return this.#parsed;
	}

	static get #recent(): string[] {
		const r = anura.settings.get(this.RECENT_KEY);
		return Array.isArray(r) ? r : [];
	}

	static #remember(glyph: string) {
		const r = [glyph, ...this.#recent.filter((g) => g !== glyph)].slice(0, 24);
		anura.settings.set(this.RECENT_KEY, r);
	}

	/* ---- panel ---------------------------------------------------------- */

	static get open(): boolean {
		return !!this.#el;
	}

	static show(tab: AetherPanelTab = "emoji") {
		if (this.#el) {
			this.#tab = tab;
			this.#render();
			return;
		}
		this.#target = this.#captureTarget();
		this.#tab = tab;
		const el = document.createElement("div");
		el.id = "emoji-panel";
		el.innerHTML = `
			<div class="ep-head">
				<span class="material-symbols-outlined">search</span>
				<input class="ep-search" type="text" spellcheck="false" autocomplete="off" />
			</div>
			<div class="ep-tabs" role="tablist">
				<button data-tab="emoji" title="Emoji">😀</button>
				<button data-tab="kaomoji" title="Kaomoji">(◕‿◕)</button>
				<button data-tab="symbols" title="Symbols">Ω</button>
				<button data-tab="clipboard" title="Clipboard history"><span class="material-symbols-outlined">content_paste</span></button>
			</div>
			<div class="ep-body"></div>
			<div class="ep-toast"></div>`;
		document.body.append(el);
		this.#el = el;
		this.#place(el);
		requestAnimationFrame(() => el.classList.add("is-shown"));

		const search = el.querySelector<HTMLInputElement>(".ep-search")!;
		search.addEventListener("input", () => {
			this.#focusIndex = 0;
			this.#render();
		});
		search.addEventListener("keydown", (e) => this.#key(e));
		el.querySelector(".ep-tabs")!.addEventListener("click", (e) => {
			const b = (e.target as Element).closest<HTMLElement>("button[data-tab]");
			if (!b) return;
			this.#tab = b.dataset.tab as AetherPanelTab;
			this.#focusIndex = 0;
			this.#render();
			search.focus();
		});
		el.querySelector(".ep-body")!.addEventListener("click", (e) =>
			this.#click(e as MouseEvent),
		);
		// Keep focus in the search box when clicking around the panel.
		el.addEventListener("mousedown", (e) => {
			if (!(e.target as Element).closest("input")) e.preventDefault();
		});
		setTimeout(() => {
			document.addEventListener("pointerdown", this.#outside, true);
		}, 0);
		this.#render();
		search.focus();
	}

	static #outside = (e: Event) => {
		if (this.#el && !this.#el.contains(e.target as Node)) this.hide();
	};

	static hide(refocus = true) {
		const el = this.#el;
		if (!el) return;
		this.#el = null;
		document.removeEventListener("pointerdown", this.#outside, true);
		el.classList.remove("is-shown");
		setTimeout(() => el.remove(), 180);
		if (refocus && this.#target?.el.isConnected) this.#target.el.focus();
	}

	static toggle(tab: AetherPanelTab = "emoji") {
		if (this.#el && this.#tab === tab) this.hide();
		else this.show(tab);
	}

	/** Near the text field that had focus, or centred if there wasn't one. */
	static #place(el: HTMLElement) {
		const W = 372;
		const H = 420;
		let x = (innerWidth - W) / 2;
		let y = (innerHeight - H) / 2;
		const t = this.#target;
		if (t) {
			let r = t.el.getBoundingClientRect();
			if (t.range) {
				const rr = t.range.getBoundingClientRect();
				if (rr.width || rr.height) r = rr;
			}
			// Offset by the frame chain when the field lives in an iframe.
			let win: Window | null = t.doc.defaultView;
			let ox = 0;
			let oy = 0;
			while (win && win !== window && win.frameElement) {
				const fr = win.frameElement.getBoundingClientRect();
				ox += fr.left;
				oy += fr.top;
				win = win.parent;
			}
			x = r.left + ox;
			y = r.bottom + oy + 8;
			if (y + H > innerHeight - 12) y = r.top + oy - H - 8;
		}
		x = Math.max(12, Math.min(innerWidth - W - 12, x));
		y = Math.max(34, Math.min(innerHeight - H - 12, y));
		el.style.left = x + "px";
		el.style.top = y + "px";
	}

	static #items(): HTMLElement[] {
		return Array.from(
			this.#el?.querySelectorAll<HTMLElement>(".ep-item") || [],
		);
	}

	static #key(e: KeyboardEvent) {
		const items = this.#items();
		const cols = this.#tab === "emoji" ? 8 : this.#tab === "symbols" ? 8 : 1;
		const move = (d: number) => {
			if (!items.length) return;
			e.preventDefault();
			this.#focusIndex = Math.max(
				0,
				Math.min(items.length - 1, this.#focusIndex + d),
			);
			this.#markFocus();
		};
		if (e.key === "Escape") {
			e.preventDefault();
			this.hide();
		} else if (e.key === "ArrowRight" && cols > 1) move(1);
		else if (e.key === "ArrowLeft" && cols > 1) move(-1);
		else if (e.key === "ArrowDown") move(cols);
		else if (e.key === "ArrowUp") move(-cols);
		else if (e.key === "Tab") {
			e.preventDefault();
			const tabs: AetherPanelTab[] = [
				"emoji",
				"kaomoji",
				"symbols",
				"clipboard",
			];
			this.#tab = tabs[(tabs.indexOf(this.#tab) + (e.shiftKey ? 3 : 1)) % 4]!;
			this.#focusIndex = 0;
			this.#render();
		} else if (e.key === "Enter") {
			e.preventDefault();
			items[this.#focusIndex]?.click();
		}
		e.stopPropagation();
	}

	static #markFocus() {
		this.#items().forEach((it, i) =>
			it.classList.toggle("is-focused", i === this.#focusIndex),
		);
		this.#items()[this.#focusIndex]?.scrollIntoView({ block: "nearest" });
	}

	static async #click(e: MouseEvent) {
		const target = e.target as Element;
		const pin = target.closest<HTMLElement>(".ep-pin");
		const del = target.closest<HTMLElement>(".ep-del");
		const clear = target.closest(".ep-clear");
		if (clear) {
			this.history = this.history.filter((c) => c.pinned);
			this.#render();
			return;
		}
		if (pin || del) {
			const i = Number(
				(pin || del)!.closest<HTMLElement>(".ep-item")!.dataset.i,
			);
			const clip = this.#clipList()[i];
			if (!clip) return;
			if (pin) clip.pinned = !clip.pinned;
			else this.history = this.history.filter((c) => c !== clip);
			this.#savePinned();
			this.#render();
			return;
		}
		const item = target.closest<HTMLElement>(".ep-item");
		if (!item) return;
		const text = item.dataset.text!;
		// Only emoji: the recents row is an emoji grid.
		if (this.#tab === "emoji") this.#remember(text);
		const keep = e.shiftKey;
		const how = await this.#insert(text);
		if (keep || how === "copied") {
			if (!this.#el) return;
			this.#toast(how === "copied" ? "Copied — paste with Ctrl+V" : "Inserted");
			if (how === "copied" && !keep) setTimeout(() => this.hide(false), 700);
			else this.#el.querySelector<HTMLInputElement>(".ep-search")!.focus();
		} else this.hide(false);
	}

	static #toast(msg: string) {
		const t = this.#el?.querySelector<HTMLElement>(".ep-toast");
		if (!t) return;
		t.textContent = msg;
		t.classList.add("is-shown");
		setTimeout(() => t.classList.remove("is-shown"), 1100);
	}

	static #clipList(): AetherClip[] {
		const q = this.#query();
		return q
			? this.history.filter((c) => c.text.toLowerCase().includes(q))
			: this.history;
	}

	static #query(): string {
		return (
			this.#el?.querySelector<HTMLInputElement>(".ep-search")?.value || ""
		)
			.trim()
			.toLowerCase();
	}

	static #render() {
		const el = this.#el;
		if (!el) return;
		el.dataset.tab = this.#tab;
		el.querySelectorAll<HTMLElement>(".ep-tabs button").forEach((b) =>
			b.classList.toggle("is-on", b.dataset.tab === this.#tab),
		);
		const search = el.querySelector<HTMLInputElement>(".ep-search")!;
		search.placeholder = {
			emoji: "Search emoji",
			kaomoji: "Search kaomoji",
			symbols: "Search symbols",
			clipboard: "Search clipboard history",
		}[this.#tab];
		const body = el.querySelector<HTMLElement>(".ep-body")!;
		body.textContent = "";
		const q = this.#query();
		const match = (words: string, glyph: string) =>
			!q || words.includes(q) || glyph === q;

		const section = (title: string, items: [string, string][], cls: string) => {
			if (!items.length) return;
			const h = document.createElement("div");
			h.className = "ep-section";
			h.textContent = title;
			const grid = document.createElement("div");
			grid.className = "ep-grid " + cls;
			for (const [glyph, words] of items) {
				const b = document.createElement("button");
				b.className = "ep-item";
				b.dataset.text = glyph;
				b.title = words;
				b.textContent = glyph;
				grid.append(b);
			}
			body.append(h, grid);
		};

		if (this.#tab === "emoji") {
			const data = this.#data().emoji;
			if (!q) {
				const known = new Set(data.flatMap((c) => c.items.map((i) => i[0])));
				const recent = this.#recent
					.filter((g) => known.has(g))
					.map((g) => [g, ""] as [string, string]);
				section("Frequently used", recent, "is-emoji");
			}
			for (const cat of data)
				section(
					cat.name,
					cat.items.filter(([g, w]) => match(w, g)),
					"is-emoji",
				);
		} else if (this.#tab === "kaomoji") {
			section(
				"Kaomoji",
				this.#data().kaomoji.filter(([g, w]) => match(w, g)),
				"is-kaomoji",
			);
		} else if (this.#tab === "symbols") {
			section(
				"Symbols",
				this.#data().symbols.filter(([g, w]) => match(w, g)),
				"is-emoji",
			);
		} else {
			const list = this.#clipList();
			const bar = document.createElement("div");
			bar.className = "ep-section ep-clip-head";
			bar.innerHTML = `<span>Clipboard history</span>${
				this.history.some((c) => !c.pinned)
					? '<button class="ep-clear">Clear</button>'
					: ""
			}`;
			body.append(bar);
			if (!list.length) {
				const empty = document.createElement("div");
				empty.className = "ep-empty";
				empty.textContent = q
					? "Nothing matches."
					: "Things you copy show up here. They're kept until you reload, unless you pin them.";
				body.append(empty);
			}
			list.forEach((c, i) => {
				const row = document.createElement("div");
				row.className = "ep-item ep-clip" + (c.pinned ? " is-pinned" : "");
				row.dataset.text = c.text;
				row.dataset.i = String(i);
				const text = document.createElement("div");
				text.className = "ep-clip-text";
				text.textContent = c.text;
				const actions = document.createElement("div");
				actions.className = "ep-clip-actions";
				actions.innerHTML = `<button class="ep-pin" title="${c.pinned ? "Unpin" : "Pin"}"><span class="material-symbols-outlined">keep</span></button><button class="ep-del" title="Remove"><span class="material-symbols-outlined">close</span></button>`;
				row.append(text, actions);
				body.append(row);
			});
		}
		if (!this.#items().length && this.#tab !== "clipboard") {
			const empty = document.createElement("div");
			empty.className = "ep-empty";
			empty.textContent = "No matches.";
			body.append(empty);
		}
		this.#markFocus();
	}

	/* ---- boot ----------------------------------------------------------- */

	static init() {
		const pinned = anura.settings.get(this.PINNED_KEY);
		if (Array.isArray(pinned))
			this.history = pinned.map((text: string, i: number) => ({
				text,
				at: i,
				pinned: true,
			}));

		this.#watch(window);
		const watchFrame = (f: HTMLIFrameElement) => {
			const attach = () => {
				try {
					if (f.contentWindow) this.#watch(f.contentWindow);
				} catch {
					/* cross-origin */
				}
			};
			attach();
			f.addEventListener("load", attach);
		};
		document.querySelectorAll("iframe").forEach(watchFrame);
		new MutationObserver((records) => {
			for (const r of records)
				r.addedNodes.forEach((n) => {
					if (n instanceof HTMLIFrameElement) watchFrame(n);
					else if (n instanceof Element)
						n.querySelectorAll("iframe").forEach(watchFrame);
				});
		}).observe(document.body, { childList: true, subtree: true });

		AetherShortcuts.register({
			combo: "Ctrl+Shift+Space",
			group: "System",
			description: "Emoji & Symbols",
			handler: () => this.toggle("emoji"),
		});
		AetherShortcuts.register({
			combo: "Ctrl+Alt+V",
			group: "System",
			description: "Clipboard history",
			handler: () => this.toggle("clipboard"),
		});
		AetherCommands.register({
			id: "emoji",
			title: "Emoji & Symbols",
			icon: "mood",
			keywords: [
				"emoji",
				"kaomoji",
				"symbols",
				"special characters",
				"emoticon",
			],
			shortcut: "Ctrl+Shift+Space",
			run: () => setTimeout(() => this.show("emoji"), 50),
		});
		AetherCommands.register({
			id: "clipboard",
			title: "Clipboard History",
			icon: "content_paste",
			keywords: ["clipboard", "paste", "copied", "history"],
			shortcut: "Ctrl+Alt+V",
			run: () => setTimeout(() => this.show("clipboard"), 50),
		});
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherClipboard = AetherClipboard;
