/**
 * Notes — quick notes, stored as ordinary Markdown files.
 *
 * Each note is a file in /Documents/Notes, so notes are visible to the file
 * manager, Spotlight's file search and every other app, and survive this app
 * being removed. The first line is the title (as in Apple Notes). Edits are
 * saved on a short debounce and flushed when switching notes or closing.
 *
 * Notes also registers a Spotlight provider that matches titles *and* body
 * text, so "groceries" finds the note that mentions them.
 */

interface NoteEntry {
	id: string;
	path: string;
	text: string;
	modified: number;
}

class NotesApp extends App {
	name = "Notes";
	package = "anura.notes";
	icon = "/assets/icons/notes.svg";

	static readonly DIR = "/Documents/Notes";

	notes: NoteEntry[] = [];
	#loaded: Promise<void> | null = null;

	constructor() {
		super();
		this.#load();
		try {
			AetherSpotlight.registerProvider({
				id: "notes",
				label: "Notes",
				limit: 4,
				search: (q) =>
					this.notes
						.map((n) => {
							const title = NotesApp.title(n.text);
							const inTitle = aetherMatch(q, title);
							const inBody = n.text.toLowerCase().includes(q.toLowerCase())
								? 420
								: -1;
							const score = Math.max(inTitle, inBody);
							if (score < 0) return null;
							return {
								id: "note:" + n.id,
								title,
								subtitle: "Note · " + NotesApp.preview(n.text, q),
								icon: this.icon,
								score: score - 60,
								accessory: "Open",
								run: () => this.open([n.id]),
							};
						})
						.filter((r) => !!r) as any,
			});
		} catch {
			/* Spotlight not loaded */
		}
	}

	static title(text: string): string {
		const line = text.split("\n").find((l) => l.trim());
		return (line || "New Note")
			.replace(/^#+\s*/, "")
			.trim()
			.slice(0, 80);
	}

	/** Second non-empty line, or the text around a search hit. */
	static preview(text: string, query = ""): string {
		if (query) {
			const i = text.toLowerCase().indexOf(query.toLowerCase());
			if (i > 0)
				return (
					"…" +
					text
						.slice(Math.max(0, i - 20), i + 60)
						.replace(/\s+/g, " ")
						.trim()
				);
		}
		const lines = text.split("\n").filter((l) => l.trim());
		return (lines[1] || "No additional text").trim().slice(0, 90);
	}

	static when(ms: number): string {
		const d = new Date(ms);
		const now = new Date();
		if (d.toDateString() === now.toDateString())
			return d.toLocaleTimeString(navigator.language, {
				hour: "numeric",
				minute: "2-digit",
			});
		const yesterday = new Date(now.getTime() - 86400000);
		if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
		return d.toLocaleDateString(navigator.language, {
			month: "short",
			day: "numeric",
		});
	}

	#load(): Promise<void> {
		if (this.#loaded) return this.#loaded;
		this.#loaded = (async () => {
			const fs = anura.fs.promises;
			try {
				await new anura.fs.Shell().promises.mkdirp(NotesApp.DIR);
			} catch {
				/* already exists */
			}
			let names: string[] = [];
			try {
				names = await fs.readdir(NotesApp.DIR);
			} catch {
				names = [];
			}
			const notes: NoteEntry[] = [];
			for (const name of names) {
				if (!name.endsWith(".md")) continue;
				const path = NotesApp.DIR + "/" + name;
				try {
					const [raw, st] = await Promise.all([
						fs.readFile(path),
						fs.stat(path),
					]);
					notes.push({
						id: name.replace(/\.md$/, ""),
						path,
						text:
							typeof raw === "string"
								? raw
								: new TextDecoder().decode(raw as any),
						modified: (st as any).mtimeMs ?? +new Date((st as any).mtime),
					});
				} catch {
					/* unreadable file; skip it */
				}
			}
			notes.sort((a, b) => b.modified - a.modified);
			this.notes = notes;
		})();
		return this.#loaded;
	}

	async #save(note: NoteEntry) {
		note.modified = Date.now();
		try {
			await anura.fs.promises.writeFile(note.path, note.text);
		} catch (e) {
			console.error("[notes] save failed", e);
		}
	}

	async #remove(note: NoteEntry) {
		this.notes = this.notes.filter((n) => n !== note);
		try {
			await anura.fs.promises.unlink(note.path);
		} catch {
			/* already gone */
		}
	}

	#create(): NoteEntry {
		const id =
			new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "") +
			"-" +
			Math.random().toString(36).slice(2, 6);
		const note = {
			id,
			path: `${NotesApp.DIR}/${id}.md`,
			text: "",
			modified: Date.now(),
		};
		this.notes.unshift(note);
		return note;
	}

	css = css`
		display: flex;
		height: 100%;
		background: var(--theme-bg);
		color: var(--ink);

		.nt-side {
			width: 240px;
			flex-shrink: 0;
			display: flex;
			flex-direction: column;
			border-right: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			background: rgba(255, 255, 255, 0.025);
		}

		.nt-side-head {
			display: flex;
			gap: 8px;
			padding: 12px 12px 8px;
			align-items: center;
		}

		.nt-search {
			flex: 1;
			min-width: 0;
			font-family: inherit;
			font-size: 13px;
			color: var(--ink);
			padding: 6px 10px 6px 30px;
			border-radius: 8px;
			border: 1px solid transparent;
			background:
				url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='%23ffffff88' stroke-width='2.4' stroke-linecap='round' d='M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM21 21l-5.2-5.2'/%3E%3C/svg%3E")
					no-repeat 10px center,
				rgba(255, 255, 255, 0.08);
			outline: none;
		}

		.nt-search:focus {
			border-color: color-mix(in srgb, var(--theme-accent) 60%, transparent);
		}

		.nt-new {
			width: 30px;
			height: 30px;
			border-radius: 8px;
			border: none;
			background: var(--theme-accent);
			color: #fff;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			padding: 0;
		}

		.nt-list {
			flex: 1;
			overflow-y: auto;
			padding: 4px 8px 12px;
		}

		.nt-item {
			padding: 9px 10px;
			border-radius: 9px;
			cursor: default;
			margin-bottom: 2px;
		}

		.nt-item:hover {
			background: rgba(255, 255, 255, 0.05);
		}

		.nt-item.is-selected {
			background: color-mix(in srgb, var(--theme-accent) 70%, transparent);
			color: #fff;
		}

		.nt-item-title {
			font-size: 13.5px;
			font-weight: 600;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.nt-item-sub {
			display: flex;
			gap: 8px;
			font-size: 12px;
			margin-top: 2px;
			color: var(--ink-faint);
			white-space: nowrap;
			overflow: hidden;
		}

		.nt-item.is-selected .nt-item-sub {
			color: rgba(255, 255, 255, 0.75);
		}

		.nt-item-sub span:last-child {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.nt-main {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
		}

		.nt-bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 10px 16px;
			font-size: 12px;
			color: var(--ink-faint);
			flex-shrink: 0;
		}

		.nt-icon-btn {
			border: none;
			background: transparent;
			color: var(--ink-dim);
			cursor: pointer;
			width: 28px;
			height: 28px;
			border-radius: 7px;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 0;
		}

		.nt-icon-btn:hover {
			background: rgba(255, 255, 255, 0.08);
			color: var(--ink);
		}

		.nt-editor {
			flex: 1;
			overflow-y: auto;
			padding: 4px 34px 30px;
			font-size: 15px;
			line-height: 1.6;
			outline: none;
			white-space: pre-wrap;
			word-wrap: break-word;
			user-select: text;
			caret-color: var(--theme-accent);
		}

		.nt-editor::first-line {
			font-size: 24px;
			font-weight: 700;
			letter-spacing: -0.01em;
		}

		.nt-editor:empty::before {
			content: "Start with a title…";
			color: var(--ink-faint);
			font-size: 24px;
			font-weight: 700;
		}

		.nt-empty {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 10px;
			color: var(--ink-faint);
			font-size: 13px;
		}

		.nt-empty .material-symbols-outlined {
			font-size: 44px;
			opacity: 0.5;
		}
	`;

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "Notes",
			width: "760px",
			height: "500px",
		});
		const root = document.createElement("div");
		root.className = this.css;
		win.content.appendChild(root);
		await this.#load();

		const side = document.createElement("div");
		side.className = "nt-side";
		const head = document.createElement("div");
		head.className = "nt-side-head";
		const search = document.createElement("input");
		search.className = "nt-search";
		search.placeholder = "Search";
		search.spellcheck = false;
		const newBtn = document.createElement("button");
		newBtn.className = "nt-new";
		newBtn.title = "New note (Ctrl+N)";
		newBtn.innerHTML =
			'<span class="material-symbols-outlined">edit_square</span>';
		head.append(search, newBtn);
		const list = document.createElement("div");
		list.className = "nt-list";
		side.append(head, list);

		const main = document.createElement("div");
		main.className = "nt-main";
		root.append(side, main);

		let current: NoteEntry | null =
			(args[0] && this.notes.find((n) => n.id === args[0])) ||
			this.notes[0] ||
			null;
		let saveTimer = 0;
		let dirty = false;

		const flush = () => {
			clearTimeout(saveTimer);
			if (current && dirty) {
				dirty = false;
				this.#save(current);
			}
		};

		const renderList = () => {
			const q = search.value.trim().toLowerCase();
			list.textContent = "";
			const shown = this.notes.filter(
				(n) => !q || n.text.toLowerCase().includes(q),
			);
			for (const n of shown) {
				const item = document.createElement("div");
				item.className = "nt-item" + (n === current ? " is-selected" : "");
				const t = document.createElement("div");
				t.className = "nt-item-title";
				t.textContent = NotesApp.title(n.text);
				const sub = document.createElement("div");
				sub.className = "nt-item-sub";
				const when = document.createElement("span");
				when.textContent = NotesApp.when(n.modified);
				const prev = document.createElement("span");
				prev.textContent = NotesApp.preview(n.text, q);
				sub.append(when, prev);
				item.append(t, sub);
				item.addEventListener("click", () => {
					flush();
					current = n;
					renderList();
					renderEditor();
				});
				list.appendChild(item);
			}
			if (!shown.length && q) {
				const none = document.createElement("div");
				none.className = "nt-item-sub";
				none.style.padding = "12px";
				none.textContent = "No matching notes";
				list.appendChild(none);
			}
		};

		const renderEditor = () => {
			main.textContent = "";
			if (!current) {
				const empty = document.createElement("div");
				empty.className = "nt-empty";
				empty.innerHTML =
					'<span class="material-symbols-outlined">sticky_note_2</span><span>No note selected</span>';
				main.appendChild(empty);
				win.title = "Notes";
				return;
			}
			const bar = document.createElement("div");
			bar.className = "nt-bar";
			const stamp = document.createElement("span");
			const words = document.createElement("span");
			const del = document.createElement("button");
			del.className = "nt-icon-btn";
			del.title = "Delete note";
			del.innerHTML = '<span class="material-symbols-outlined">delete</span>';
			const right = document.createElement("span");
			right.style.display = "flex";
			right.style.alignItems = "center";
			right.style.gap = "10px";
			right.append(words, del);
			bar.append(stamp, right);

			const editor = document.createElement("div");
			editor.className = "nt-editor";
			// plaintext-only keeps pasted formatting out; older engines fall back.
			try {
				editor.contentEditable = "plaintext-only";
			} catch {
				editor.contentEditable = "true";
			}
			if (editor.contentEditable !== "plaintext-only")
				editor.contentEditable = "true";
			editor.spellcheck = true;
			editor.textContent = current.text;

			const paintMeta = () => {
				const n = current!;
				stamp.textContent =
					"Edited " +
					new Date(n.modified).toLocaleString(navigator.language, {
						dateStyle: "medium",
						timeStyle: "short",
					});
				const count = (n.text.match(/\S+/g) || []).length;
				words.textContent = count + (count === 1 ? " word" : " words");
				win.title = NotesApp.title(n.text) + " — Notes";
			};
			editor.addEventListener("input", () => {
				current!.text = editor.innerText.replace(/\n$/, "");
				current!.modified = Date.now();
				dirty = true;
				clearTimeout(saveTimer);
				saveTimer = window.setTimeout(flush, 400);
				paintMeta();
				// Keep the list's title and order live without rebuilding focus.
				const i = this.notes.indexOf(current!);
				if (i > 0) {
					this.notes.splice(i, 1);
					this.notes.unshift(current!);
				}
				renderList();
			});
			del.addEventListener("click", async () => {
				const n = current!;
				clearTimeout(saveTimer);
				dirty = false;
				await this.#remove(n);
				current = this.notes[0] || null;
				renderList();
				renderEditor();
			});
			main.append(bar, editor);
			paintMeta();
			return editor;
		};

		const newNote = () => {
			flush();
			current = this.#create();
			renderList();
			const editor = renderEditor();
			setTimeout(() => editor?.focus(), 30);
		};
		newBtn.addEventListener("click", newNote);
		search.addEventListener("input", renderList);
		root.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
				e.preventDefault();
				newNote();
			}
		});

		renderList();
		renderEditor();
		win.addEventListener("close", () => {
			flush();
			// A note left completely empty isn't worth keeping.
			for (const n of [...this.notes]) if (!n.text.trim()) this.#remove(n);
		});
		return win;
	}
}
