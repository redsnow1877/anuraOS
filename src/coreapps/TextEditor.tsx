/**
 * A plain-text editor wired to the Aether filesystem.
 *
 * Deliberately not a code editor — no syntax engine, no LSP. It is the thing
 * you reach for to jot a note or fix a config file, so it optimises for
 * starting instantly and never losing work.
 */
class TextEditorApp extends App {
	name = "Text Editor";
	package = "anura.texteditor";
	icon = "/assets/icons/texteditor.svg";

	css = css`
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--theme-bg);
		color: var(--ink);

		.te-bar {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 7px 10px;
			border-bottom: 1px solid var(--hairline);
			background: rgba(255, 255, 255, 0.03);
		}

		.te-btn {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			height: 26px;
			padding: 0 10px;
			border-radius: 7px;
			border: 1px solid var(--glass-stroke);
			background: rgba(255, 255, 255, 0.06);
			color: var(--ink);
			font-family: inherit;
			font-size: 12.5px;
			cursor: default;
			transition: background-color 0.1s ease;
		}

		.te-btn:hover {
			background: rgba(255, 255, 255, 0.12);
		}

		.te-btn:active {
			transform: scale(0.97);
		}

		.te-btn .material-symbols-outlined {
			font-size: 15px;
		}

		.te-spacer {
			flex: 1;
		}

		.te-path {
			font-size: 12px;
			color: var(--ink-dim);
			max-width: 46%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			direction: rtl;
			text-align: left;
		}

		.te-dirty {
			color: var(--theme-accent);
			font-size: 16px;
			line-height: 1;
		}

		.te-area {
			flex: 1;
			min-height: 0;
			width: 100%;
			box-sizing: border-box;
			resize: none;
			border: none;
			outline: none;
			background: transparent;
			color: var(--ink);
			font-family: var(--theme-font-mono);
			font-size: 13px;
			line-height: 1.65;
			padding: 14px 16px;
			tab-size: 4;
		}

		.te-area::placeholder {
			color: var(--ink-faint);
		}

		.te-status {
			flex-shrink: 0;
			display: flex;
			gap: 14px;
			padding: 5px 12px;
			border-top: 1px solid var(--hairline);
			font-size: 11.5px;
			color: var(--ink-faint);
			font-variant-numeric: tabular-nums;
			background: rgba(0, 0, 0, 0.18);
		}
	`;

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		const state = $state({
			path: (args && args[0]) || "",
			dirty: false,
			chars: 0,
			words: 0,
			lines: 1,
		});

		const win = anura.wm.create(this, {
			title: "Text Editor",
			width: "660px",
			height: "460px",
		});

		let area!: HTMLTextAreaElement;

		const retitle = () => {
			const base = state.path ? state.path.split("/").pop() : "Untitled";
			win.title = `${state.dirty ? "• " : ""}${base} — Text Editor`;
		};

		const recount = () => {
			const v = area.value;
			state.chars = v.length;
			state.words = v.trim() ? v.trim().split(/\s+/).length : 0;
			state.lines = v.split("\n").length;
		};

		const load = async (path: string) => {
			try {
				const data = await anura.fs.promises.readFile(path);
				area.value = new TextDecoder().decode(data);
				state.path = path;
				state.dirty = false;
				recount();
				retitle();
			} catch (e) {
				anura.dialog.alert(`Could not open ${path}:\n${e}`, "Open failed");
			}
		};

		const save = async (saveAs = false) => {
			let path = state.path;
			if (!path || saveAs) {
				const suggested = path || "/home/untitled.txt";
				const answer = await anura.dialog.prompt("Save as:", suggested);
				if (!answer) return;
				path = answer;
			}
			try {
				await anura.fs.promises.writeFile(path, area.value);
				state.path = path;
				state.dirty = false;
				retitle();
				(globalThis as any).aetherSound?.play?.("toggleOn");
			} catch (e) {
				anura.dialog.alert(`Could not save ${path}:\n${e}`, "Save failed");
			}
		};

		const openPrompt = async () => {
			const answer = await anura.dialog.prompt(
				"Open file:",
				state.path || "/home/",
			);
			if (answer) await load(answer);
		};

		const page = (
			<div class={this.css}>
				<div class="te-bar">
					<button class="te-btn" on:click={openPrompt}>
						<span class="material-symbols-outlined">folder_open</span>Open
					</button>
					<button class="te-btn" on:click={() => save(false)}>
						<span class="material-symbols-outlined">save</span>Save
					</button>
					<button class="te-btn" on:click={() => save(true)}>
						Save As
					</button>
					<div class="te-spacer"></div>
					<span class="te-dirty">
						{use(state.dirty, (d) => (d ? "●" : ""))}
					</span>
					<span class="te-path">{use(state.path, (p) => p || "Untitled")}</span>
				</div>

				{
					(area = (
						<textarea
							class="te-area"
							spellcheck={false}
							placeholder="Start typing…"
						></textarea>
					) as HTMLTextAreaElement)
				}

				<div class="te-status">
					<span>{use(state.lines, (n) => `${n} lines`)}</span>
					<span>{use(state.words, (n) => `${n} words`)}</span>
					<span>{use(state.chars, (n) => `${n} chars`)}</span>
				</div>
			</div>
		);

		win.content.appendChild(page);

		area.addEventListener("input", () => {
			if (!state.dirty) {
				state.dirty = true;
				retitle();
			}
			recount();
		});

		// Tab should indent, not escape the field — this is an editor.
		area.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Tab") {
				e.preventDefault();
				const s = area.selectionStart;
				const end = area.selectionEnd;
				area.value = area.value.slice(0, s) + "\t" + area.value.slice(end);
				area.selectionStart = area.selectionEnd = s + 1;
				recount();
				if (!state.dirty) {
					state.dirty = true;
					retitle();
				}
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				save(e.shiftKey);
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
				e.preventDefault();
				openPrompt();
			}
		});

		if (state.path) await load(state.path);
		retitle();
		setTimeout(() => area.focus(), 60);

		return win;
	}
}
