/**
 * Music — plays /Documents/Music, with a live visualizer.
 *
 * The window is only a remote for AetherMusic (src/MusicPlayer.ts): closing it
 * leaves the song playing, and Control Center keeps the controls.
 *
 * The visualizer reads the player's analyser and has three moods: Bars, Wave
 * and Orb (radial spectrum around a spinning record). It only animates while
 * music plays and the window is on screen; paused, the levels settle and the
 * loop stops. Colours come from the cover art, as does the blurred backdrop.
 */

type MusicViz = "bars" | "wave" | "orb" | "off";

class MusicApp extends App {
	name = "Music";
	package = "anura.music";
	icon = "/assets/icons/music.svg";

	static readonly VIZ: MusicViz[] = ["orb", "bars", "wave", "off"];
	static readonly VIZ_LABEL: Record<MusicViz, string> = {
		orb: "Orb",
		bars: "Bars",
		wave: "Wave",
		off: "Off",
	};
	static #accentCache = new Map<string, [number, number, number]>();

	/** The cover's most vivid colour, as HSL, for tinting the window. */
	static async accentOf(url: string): Promise<[number, number, number]> {
		const hit = this.#accentCache.get(url);
		if (hit) return hit;
		let out: [number, number, number] = [262, 70, 66];
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			const c = document.createElement("canvas");
			c.width = c.height = 16;
			const g = c.getContext("2d", { willReadFrequently: true })!;
			g.drawImage(img, 0, 0, 16, 16);
			const d = g.getImageData(0, 0, 16, 16).data;
			let r = 0;
			let gr = 0;
			let b = 0;
			let w = 0;
			for (let i = 0; i < d.length; i += 4) {
				const max = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
				const min = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
				// Weight by saturation × brightness: vivid pixels decide.
				const k = Math.pow(((max - min) / 255) * (max / 255), 2) + 0.001;
				r += d[i]! * k;
				gr += d[i + 1]! * k;
				b += d[i + 2]! * k;
				w += k;
			}
			r /= w * 255;
			gr /= w * 255;
			b /= w * 255;
			const max = Math.max(r, gr, b);
			const min = Math.min(r, gr, b);
			let h = 0;
			if (max !== min) {
				const dd = max - min;
				if (max === r) h = ((gr - b) / dd + (gr < b ? 6 : 0)) * 60;
				else if (max === gr) h = ((b - r) / dd + 2) * 60;
				else h = ((r - gr) / dd + 4) * 60;
			}
			const s = max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1));
			// Clamp into a range that reads well on the dark backdrop.
			out = [Math.round(h), Math.round(Math.max(55, s * 100)), 66];
		} catch {
			/* keep the default violet */
		}
		this.#accentCache.set(url, out);
		return out;
	}

	css = css`
		--mu-h: 262;
		--mu-s: 70%;
		--mu-accent: hsl(var(--mu-h) var(--mu-s) 66%);
		--theme-accent: var(--mu-accent);
		position: relative;
		display: flex;
		height: 100%;
		overflow: hidden;
		color: #fff;
		background: #0c0c12;
		user-select: none;
		outline: none;

		.mu-backdrop {
			position: absolute;
			inset: -60px;
			width: calc(100% + 120px);
			height: calc(100% + 120px);
			object-fit: cover;
			filter: blur(56px) saturate(1.5) brightness(0.5);
			opacity: 0;
			transition: opacity 0.6s ease;
			pointer-events: none;
		}

		.mu-backdrop.is-shown {
			opacity: 1;
		}

		.mu-now {
			position: relative;
			width: 42%;
			min-width: 300px;
			max-width: 420px;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 6px;
			padding: 24px 26px 20px;
			flex-shrink: 0;
		}

		.mu-viz {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			pointer-events: none;
		}

		.mu-viz-mode {
			position: absolute;
			top: 12px;
			left: 12px;
			z-index: 2;
			display: inline-flex;
			align-items: center;
			gap: 5px;
			padding: 4px 9px 4px 7px;
			border: none;
			border-radius: 999px;
			font: inherit;
			font-size: 11.5px;
			color: rgba(255, 255, 255, 0.75);
			background: rgba(255, 255, 255, 0.08);
			cursor: pointer;
		}

		.mu-viz-mode:hover {
			background: rgba(255, 255, 255, 0.16);
			color: #fff;
		}

		.mu-viz-mode .material-symbols-outlined {
			font-size: 16px;
		}

		.mu-stage {
			position: relative;
			width: min(240px, 60vh);
			aspect-ratio: 1;
			margin-bottom: 14px;
			z-index: 1;
		}

		.mu-art {
			width: 100%;
			height: 100%;
			object-fit: cover;
			border-radius: 14px;
			box-shadow:
				0 24px 50px -12px rgba(0, 0, 0, 0.6),
				0 0 0 1px rgba(255, 255, 255, 0.08);
			transition:
				border-radius 0.5s var(--ease-out),
				opacity 0.3s ease;
			will-change: scale;
		}

		.mu-art.is-empty {
			opacity: 0;
		}

		.mu-placeholder {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: 14px;
			background: linear-gradient(
				145deg,
				rgba(255, 255, 255, 0.1),
				rgba(255, 255, 255, 0.03)
			);
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
			z-index: -1;
		}

		.mu-placeholder .material-symbols-outlined {
			font-size: 72px;
			opacity: 0.35;
		}

		/* Orb mode: the cover becomes a record and turns while playing. */
		&.viz-orb .mu-art {
			border-radius: 50%;
			animation: mu-spin 24s linear infinite;
			animation-play-state: paused;
		}

		&.viz-orb.is-playing .mu-art {
			animation-play-state: running;
		}

		&.viz-orb .mu-stage {
			width: min(200px, 50vh);
			margin: 26px 0 30px;
		}

		&.viz-orb .mu-placeholder {
			border-radius: 50%;
		}

		/* Bars and Wave get their own strip under the controls. */
		&.viz-bars .mu-now,
		&.viz-wave .mu-now {
			padding-bottom: 86px;
		}

		&.viz-bars .mu-stage,
		&.viz-wave .mu-stage {
			width: min(210px, 40vh);
			margin-bottom: 8px;
		}

		.mu-title {
			font-size: 17px;
			font-weight: 650;
			max-width: 100%;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			z-index: 1;
		}

		.mu-artist {
			font-size: 13px;
			color: rgba(255, 255, 255, 0.62);
			max-width: 100%;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			z-index: 1;
		}

		.mu-seek {
			width: 100%;
			margin-top: 14px;
			z-index: 1;
		}

		.mu-times {
			display: flex;
			justify-content: space-between;
			font-size: 11px;
			color: rgba(255, 255, 255, 0.5);
			font-variant-numeric: tabular-nums;
			margin-top: 2px;
		}

		.mu-transport {
			display: flex;
			align-items: center;
			gap: 10px;
			margin-top: 6px;
			z-index: 1;
		}

		.mu-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 36px;
			height: 36px;
			border: none;
			border-radius: 50%;
			background: transparent;
			color: rgba(255, 255, 255, 0.86);
			cursor: pointer;
			transition:
				background 0.15s,
				scale 0.12s var(--ease-out);
		}

		.mu-btn:hover {
			background: rgba(255, 255, 255, 0.1);
		}

		.mu-btn:active {
			scale: 0.9;
		}

		.mu-btn .material-symbols-outlined {
			font-size: 26px;
		}

		.mu-btn.small .material-symbols-outlined {
			font-size: 19px;
			color: rgba(255, 255, 255, 0.5);
		}

		.mu-btn.small.is-on .material-symbols-outlined {
			color: var(--mu-accent);
		}

		.mu-btn.play {
			width: 52px;
			height: 52px;
			background: #fff;
			color: #111;
			box-shadow: 0 8px 22px -6px rgba(0, 0, 0, 0.55);
		}

		.mu-btn.play:hover {
			background: #fff;
			scale: 1.05;
		}

		.mu-btn .media-icon {
			width: 24px;
			height: 24px;
		}

		.mu-btn.play .media-icon {
			width: 26px;
			height: 26px;
		}

		.mu-vol {
			display: flex;
			align-items: center;
			gap: 8px;
			width: 80%;
			margin-top: 8px;
			z-index: 1;
		}

		.mu-vol .material-symbols-outlined {
			font-size: 17px;
			color: rgba(255, 255, 255, 0.5);
		}

		.mu-lib {
			position: relative;
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			background: rgba(0, 0, 0, 0.22);
			border-left: 1px solid rgba(255, 255, 255, 0.07);
		}

		.mu-lib-head {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 14px 16px 10px;
		}

		.mu-lib-head h2 {
			margin: 0 auto 0 0;
			font-size: 19px;
			font-weight: 700;
		}

		.mu-lib-head h2 small {
			font-size: 12px;
			font-weight: 400;
			color: rgba(255, 255, 255, 0.5);
			margin-left: 6px;
		}

		.mu-filter {
			width: 150px;
			padding: 5px 10px;
			border: none;
			border-radius: 8px;
			font: inherit;
			font-size: 12.5px;
			color: #fff;
			background: rgba(255, 255, 255, 0.09);
			outline: none;
		}

		.mu-filter:focus {
			box-shadow: 0 0 0 2px
				color-mix(in srgb, var(--mu-accent) 60%, transparent);
		}

		.mu-pill {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 6px 12px;
			border: none;
			border-radius: 8px;
			font: inherit;
			font-size: 12.5px;
			color: #fff;
			background: rgba(255, 255, 255, 0.1);
			cursor: pointer;
		}

		.mu-pill:hover {
			background: rgba(255, 255, 255, 0.17);
		}

		.mu-pill.primary {
			background: var(--mu-accent);
			color: #111;
			font-weight: 600;
		}

		.mu-pill:disabled {
			opacity: 0.6;
			cursor: default;
		}

		.mu-pill .material-symbols-outlined {
			font-size: 17px;
		}

		.mu-list {
			flex: 1;
			overflow-y: auto;
			padding: 0 8px 12px;
		}

		.mu-row {
			display: grid;
			grid-template-columns: 26px 38px minmax(0, 1fr) auto 28px;
			align-items: center;
			gap: 10px;
			padding: 6px 8px;
			border-radius: 9px;
			cursor: pointer;
			content-visibility: auto;
			contain-intrinsic-size: auto 50px;
		}

		.mu-row:hover {
			background: rgba(255, 255, 255, 0.07);
		}

		.mu-row.is-current {
			background: rgba(255, 255, 255, 0.11);
		}

		.mu-idx {
			font-size: 12px;
			color: rgba(255, 255, 255, 0.45);
			text-align: center;
			font-variant-numeric: tabular-nums;
		}

		.mu-row.is-current .mu-idx {
			color: var(--mu-accent);
		}

		.mu-eq {
			display: none;
			height: 12px;
			align-items: flex-end;
			justify-content: center;
			gap: 2px;
		}

		.mu-eq i {
			width: 3px;
			height: 100%;
			border-radius: 1px;
			background: var(--mu-accent);
			transform-origin: bottom;
			animation: mu-eq 0.9s ease-in-out infinite alternate;
			animation-play-state: paused;
			scale: 1 0.35;
		}

		.mu-eq i:nth-child(2) {
			animation-delay: -0.45s;
			animation-duration: 0.7s;
		}

		.mu-eq i:nth-child(3) {
			animation-delay: -0.2s;
			animation-duration: 1.1s;
		}

		.mu-row.is-current .mu-eq {
			display: flex;
		}

		.mu-row.is-current .mu-num {
			display: none;
		}

		&.is-playing .mu-row.is-current .mu-eq i {
			animation-play-state: running;
		}

		.mu-thumb {
			width: 38px;
			height: 38px;
			border-radius: 6px;
			object-fit: cover;
			box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
		}

		.mu-rtext {
			min-width: 0;
		}

		.mu-rtitle,
		.mu-rartist {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.mu-rtitle {
			font-size: 13px;
		}

		.mu-row.is-current .mu-rtitle {
			color: var(--mu-accent);
			font-weight: 600;
		}

		.mu-rartist {
			font-size: 11.5px;
			color: rgba(255, 255, 255, 0.5);
			margin-top: 1px;
		}

		.mu-rdur {
			font-size: 11.5px;
			color: rgba(255, 255, 255, 0.45);
			font-variant-numeric: tabular-nums;
		}

		.mu-rdel {
			width: 26px;
			height: 26px;
			border: none;
			border-radius: 6px;
			background: transparent;
			color: rgba(255, 255, 255, 0.5);
			cursor: pointer;
			opacity: 0;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.mu-row:hover .mu-rdel {
			opacity: 1;
		}

		.mu-rdel:hover {
			background: rgba(255, 69, 58, 0.3);
			color: #fff;
		}

		.mu-rdel .material-symbols-outlined {
			font-size: 17px;
		}

		.mu-empty {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 10px;
			padding: 30px;
			text-align: center;
			color: rgba(255, 255, 255, 0.6);
			font-size: 13px;
		}

		.mu-empty > .material-symbols-outlined {
			font-size: 56px;
			opacity: 0.45;
		}

		.mu-empty h3 {
			margin: 0;
			color: #fff;
			font-size: 16px;
		}

		.mu-empty-actions {
			display: flex;
			gap: 8px;
			margin-top: 8px;
		}

		.mu-drop {
			position: absolute;
			inset: 10px;
			z-index: 5;
			display: none;
			align-items: center;
			justify-content: center;
			border-radius: 14px;
			border: 2px dashed var(--mu-accent);
			background: color-mix(in srgb, var(--mu-accent) 14%, rgba(0, 0, 0, 0.5));
			font-size: 15px;
			font-weight: 600;
			pointer-events: none;
		}

		&.is-dragging .mu-drop {
			display: flex;
		}
	`;

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		// One window: a second launch brings the first one forward.
		const existing = this.windows[this.windows.length - 1];
		if (existing) {
			existing.unminimize();
			existing.focus();
			if (args[0]) AetherMusic.playPath(args[0]);
			return existing;
		}

		const win = anura.wm.create(this, {
			title: "Music",
			width: "900px",
			height: "580px",
		});
		const root = document.createElement("div");
		root.className = this.css;
		root.tabIndex = -1;
		win.content.appendChild(root);

		const life = new AbortController();
		const signal = life.signal;
		const on = (type: string, fn: () => void) =>
			AetherMusic.events.addEventListener(type, fn, { signal });

		const el = <K extends keyof HTMLElementTagNameMap>(
			tag: K,
			cls = "",
			text = "",
		): HTMLElementTagNameMap[K] => {
			const e = document.createElement(tag);
			if (cls) e.className = cls;
			if (text) e.textContent = text;
			return e;
		};
		const icon = (name: string) =>
			el("span", "material-symbols-outlined", name);
		const iconButton = (name: string, cls: string, title: string) => {
			const b = el("button", "mu-btn " + cls);
			b.title = title;
			b.append(icon(name));
			return b;
		};
		const mediaButton = (
			name: "play" | "next" | "prev",
			cls: string,
			title: string,
		) => {
			const b = el("button", "mu-btn " + cls);
			b.title = title;
			b.innerHTML = aetherMediaIcon(name);
			return b;
		};

		/* ---- now playing pane ---------------------------------------- */

		const backdrop = el("img", "mu-backdrop");
		backdrop.alt = "";
		const now = el("section", "mu-now");
		const canvas = el("canvas", "mu-viz");
		const vizBtn = el("button", "mu-viz-mode");
		vizBtn.title = "Change visualizer";
		const stage = el("div", "mu-stage");
		const placeholder = el("div", "mu-placeholder");
		placeholder.append(icon("music_note"));
		const art = el("img", "mu-art is-empty");
		art.alt = "";
		stage.append(placeholder, art);
		const title = el("div", "mu-title", "Not Playing");
		const artist = el("div", "mu-artist", "Pick a song");

		const seekWrap = el("div", "mu-seek");
		const seek = el("input", "aether-slider");
		seek.type = "range";
		seek.min = "0";
		seek.max = "1000";
		seek.value = "0";
		seek.setAttribute("aria-label", "Position");
		const times = el("div", "mu-times");
		const tCur = el("span", "", "0:00");
		const tDur = el("span", "", "0:00");
		times.append(tCur, tDur);
		seekWrap.append(seek, times);

		const transport = el("div", "mu-transport");
		const shuffleBtn = iconButton("shuffle", "small", "Shuffle");
		const prevBtn = mediaButton("prev", "", "Previous");
		const playBtn = mediaButton("play", "play", "Play");
		const nextBtn = mediaButton("next", "", "Next");
		const repeatBtn = iconButton("repeat", "small", "Repeat");
		transport.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);

		const volRow = el("div", "mu-vol");
		const vol = el("input", "aether-slider");
		vol.type = "range";
		vol.min = "0";
		vol.max = "100";
		vol.setAttribute("aria-label", "Volume");
		volRow.append(icon("volume_down"), vol, icon("volume_up"));

		now.append(
			canvas,
			vizBtn,
			stage,
			title,
			artist,
			seekWrap,
			transport,
			volRow,
		);

		/* ---- library pane --------------------------------------------- */

		const lib = el("section", "mu-lib");
		const head = el("div", "mu-lib-head");
		const h2 = el("h2", "", "Songs");
		const count = el("small");
		h2.append(count);
		const filter = el("input", "mu-filter");
		filter.type = "search";
		filter.placeholder = "Filter";
		const importBtn = el("button", "mu-pill");
		importBtn.append(icon("add"), "Import");
		head.append(h2, filter, importBtn);
		const list = el("div", "mu-list");
		const drop = el("div", "mu-drop", "Drop to add to your library");
		lib.append(head, list, drop);

		root.append(backdrop, now, lib);

		const importer = el("input");
		importer.type = "file";
		importer.accept = "audio/*";
		importer.multiple = true;
		importer.style.display = "none";
		root.append(importer);
		importer.addEventListener("change", async () => {
			await AetherMusic.importFiles(Array.from(importer.files || []));
			importer.value = "";
			AetherMusic.readAllTags();
		});
		importBtn.addEventListener("click", () => importer.click());

		/* ---- rendering -------------------------------------------------- */

		let rows = new Map<AetherTrack, HTMLElement>();
		let making = false;

		const renderList = () => {
			const q = filter.value.trim().toLowerCase();
			const all = AetherMusic.library;
			const shown = q
				? all.filter((t) =>
						(t.title + " " + t.artist + " " + t.album)
							.toLowerCase()
							.includes(q),
					)
				: all;
			count.textContent = all.length
				? all.length + (all.length === 1 ? " song" : " songs")
				: "";
			filter.style.display = all.length ? "" : "none";
			list.textContent = "";
			rows = new Map();
			if (!all.length) {
				list.append(emptyState());
				return;
			}
			shown.forEach((t, i) => {
				const row = el("div", "mu-row");
				const idx = el("span", "mu-idx");
				const eq = el("span", "mu-eq");
				eq.append(el("i"), el("i"), el("i"));
				idx.append(el("span", "mu-num", String(i + 1)), eq);
				const thumb = el("img", "mu-thumb");
				thumb.loading = "lazy";
				thumb.src = t.art;
				thumb.alt = "";
				const text = el("div", "mu-rtext");
				text.append(
					el("div", "mu-rtitle", t.title),
					el(
						"div",
						"mu-rartist",
						[t.artist, t.album].filter(Boolean).join(" · "),
					),
				);
				const dur = el(
					"span",
					"mu-rdur",
					t.duration ? aetherFormatTime(t.duration) : "",
				);
				const del = el("button", "mu-rdel");
				del.title = "Delete from library";
				del.append(icon("delete"));
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					AetherMusic.remove(t);
				});
				row.append(idx, thumb, text, dur, del);
				row.addEventListener("click", () => {
					if (AetherMusic.current === t) AetherMusic.toggle();
					else AetherMusic.playList(shown, i);
				});
				list.append(row);
				rows.set(t, row);
			});
			markCurrent();
		};

		const emptyState = () => {
			const box = el("div", "mu-empty");
			box.append(
				icon("library_music"),
				el("h3", "", "No music yet"),
				el(
					"span",
					"",
					"Drop audio files here or import them. Or let Aether compose a few songs for you, right here in the browser.",
				),
			);
			const actions = el("div", "mu-empty-actions");
			const imp = el("button", "mu-pill");
			imp.append(icon("upload"), "Import Music");
			imp.addEventListener("click", () => importer.click());
			const demo = el("button", "mu-pill primary");
			demo.append(icon("auto_awesome"), "Compose a Demo Album");
			demo.addEventListener("click", async () => {
				if (making) return;
				making = true;
				demo.disabled = imp.disabled = true;
				try {
					await AetherMusicDemo.makeAlbum((done, total) => {
						demo.textContent = "";
						demo.append(
							icon("graphic_eq"),
							`Composing… ${done} of ${total} songs done`,
						);
					});
					await AetherMusic.readAllTags();
				} catch (e) {
					console.error("[music] demo", e);
					anura.notifications.add({
						title: "Couldn't compose the demo album",
						description: String((e as Error)?.message || e),
						timeout: 5000,
					});
				} finally {
					making = false;
				}
			});
			actions.append(imp, demo);
			box.append(actions);
			return box;
		};

		const markCurrent = () => {
			const cur = AetherMusic.current;
			for (const [t, row] of rows)
				row.classList.toggle("is-current", t === cur);
		};

		let artUrl = "";
		let hue = 262;
		const renderTrack = () => {
			const t = AetherMusic.current;
			title.textContent = t ? t.title : "Not Playing";
			artist.textContent = t
				? [t.artist, t.album].filter(Boolean).join(" — ")
				: "Pick a song";
			win.title = t ? `${t.title} — Music` : "Music";
			if (t && t.art !== artUrl) {
				artUrl = t.art;
				art.src = backdrop.src = t.art;
				art.classList.remove("is-empty");
				backdrop.classList.add("is-shown");
				MusicApp.accentOf(t.art).then(([h, s]) => {
					if (artUrl !== t.art) return;
					hue = h;
					root.style.setProperty("--mu-h", String(h));
					root.style.setProperty("--mu-s", s + "%");
					if (!raf) paint();
				});
			} else if (!t) {
				artUrl = "";
				art.classList.add("is-empty");
				backdrop.classList.remove("is-shown");
			}
			markCurrent();
			renderTime();
		};

		let seeking = false;
		const renderTime = () => {
			const d = AetherMusic.duration;
			const cur = AetherMusic.time;
			tCur.textContent = aetherFormatTime(cur);
			tDur.textContent = d ? "-" + aetherFormatTime(d - cur) : "0:00";
			if (!seeking) {
				seek.value = String(d ? Math.round((cur / d) * 1000) : 0);
				seek.style.setProperty("--v", Number(seek.value) / 10 + "%");
			}
			// Durations arrive with playback; fill the row in if it was blank.
			const t = AetherMusic.current;
			const dur = t && rows.get(t)?.querySelector(".mu-rdur");
			if (dur && !dur.textContent && t!.duration)
				dur.textContent = aetherFormatTime(t!.duration);
		};

		const renderState = () => {
			const playing = AetherMusic.playing;
			root.classList.toggle("is-playing", playing);
			playBtn.innerHTML = aetherMediaIcon(playing ? "pause" : "play");
			playBtn.title = playing ? "Pause" : "Play";
			kick();
		};

		const renderMode = () => {
			shuffleBtn.classList.toggle("is-on", AetherMusic.shuffle);
			const r = AetherMusic.repeat;
			repeatBtn.classList.toggle("is-on", r !== "off");
			repeatBtn.firstElementChild!.textContent =
				r === "one" ? "repeat_one" : "repeat";
			repeatBtn.title = { off: "Repeat", all: "Repeat All", one: "Repeat One" }[
				r
			];
		};

		const renderVolume = () => {
			vol.value = String(Math.round(AetherMusic.volume * 100));
			vol.style.setProperty("--v", vol.value + "%");
		};

		// Library events can arrive in bursts (one per tagged file).
		let listQueued = false;
		const queueList = () => {
			if (listQueued) return;
			listQueued = true;
			requestAnimationFrame(() => {
				listQueued = false;
				if (!signal.aborted) {
					renderList();
					renderTrack();
				}
			});
		};

		on("library", queueList);
		on("track", renderTrack);
		on("time", renderTime);
		on("state", renderState);
		on("mode", renderMode);
		filter.addEventListener("input", renderList);

		/* ---- controls --------------------------------------------------- */

		playBtn.addEventListener("click", () => AetherMusic.toggle());
		prevBtn.addEventListener("click", () => AetherMusic.prev());
		nextBtn.addEventListener("click", () => AetherMusic.next());
		shuffleBtn.addEventListener("click", () =>
			AetherMusic.setShuffle(!AetherMusic.shuffle),
		);
		repeatBtn.addEventListener("click", () => AetherMusic.cycleRepeat());
		seek.addEventListener("pointerdown", () => (seeking = true));
		seek.addEventListener("input", () => {
			seeking = true;
			seek.style.setProperty("--v", Number(seek.value) / 10 + "%");
			tCur.textContent = aetherFormatTime(
				(Number(seek.value) / 1000) * AetherMusic.duration,
			);
		});
		seek.addEventListener("change", () => {
			AetherMusic.seek((Number(seek.value) / 1000) * AetherMusic.duration);
			seeking = false;
		});
		vol.addEventListener("input", () => {
			AetherMusic.volume = Number(vol.value) / 100;
			vol.style.setProperty("--v", vol.value + "%");
		});

		root.addEventListener("keydown", (e) => {
			if ((e.target as Element).closest("input[type=search]")) return;
			if (e.key === " ") {
				e.preventDefault();
				AetherMusic.toggle();
			} else if (e.key === "ArrowRight") {
				if (e.shiftKey) AetherMusic.next();
				else AetherMusic.seek(AetherMusic.time + 5);
			} else if (e.key === "ArrowLeft") {
				if (e.shiftKey) AetherMusic.prev();
				else AetherMusic.seek(AetherMusic.time - 5);
			} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				e.preventDefault();
				AetherMusic.volume += e.key === "ArrowUp" ? 0.05 : -0.05;
				renderVolume();
			} else return;
		});

		// Drag audio files in from the real computer.
		let dragDepth = 0;
		root.addEventListener("dragenter", (e) => {
			if (!e.dataTransfer?.types.includes("Files")) return;
			dragDepth++;
			root.classList.add("is-dragging");
		});
		root.addEventListener("dragleave", () => {
			if (--dragDepth <= 0) {
				dragDepth = 0;
				root.classList.remove("is-dragging");
			}
		});
		root.addEventListener("dragover", (e) => e.preventDefault());
		root.addEventListener("drop", async (e) => {
			e.preventDefault();
			dragDepth = 0;
			root.classList.remove("is-dragging");
			const n = await AetherMusic.importFiles(
				Array.from(e.dataTransfer?.files || []),
			);
			if (!n)
				anura.notifications.add({
					title: "Nothing to import",
					description:
						"Music can play MP3, M4A, OGG, Opus, WAV and FLAC files.",
					timeout: 4000,
				});
			else AetherMusic.readAllTags();
		});

		/* ---- visualizer ------------------------------------------------- */

		let mode: MusicViz = MusicApp.VIZ.includes(anura.settings.get("music.viz"))
			? anura.settings.get("music.viz")
			: "orb";
		const renderViz = () => {
			for (const m of MusicApp.VIZ)
				root.classList.toggle("viz-" + m, m === mode);
			vizBtn.textContent = "";
			vizBtn.append(
				icon(mode === "off" ? "visibility_off" : "graphic_eq"),
				MusicApp.VIZ_LABEL[mode],
			);
			orb = null;
			if (mode === "off") {
				level.fill(0);
				art.style.scale = "";
				paint();
			}
			kick();
		};
		vizBtn.addEventListener("click", () => {
			mode =
				MusicApp.VIZ[(MusicApp.VIZ.indexOf(mode) + 1) % MusicApp.VIZ.length]!;
			anura.settings.set("music.viz", mode);
			renderViz();
		});

		const BANDS = 48;
		const level = new Float32Array(BANDS);
		const peak = new Float32Array(BANDS);
		let freq: Uint8Array<ArrayBuffer> | null = null;
		let wave: Uint8Array<ArrayBuffer> | null = null;
		let edges: number[] = [];
		const g = canvas.getContext("2d")!;
		let W = 0;
		let H = 0;
		let dpr = 1;
		/** Where the record sits, for Orb; measured once per layout. */
		let orb: { cx: number; cy: number; r: number } | null = null;

		const resize = () => {
			orb = null;
			dpr = Math.min(2, window.devicePixelRatio || 1);
			W = now.clientWidth;
			H = now.clientHeight;
			canvas.width = Math.round(W * dpr);
			canvas.height = Math.round(H * dpr);
			paint();
		};
		const ro = new ResizeObserver(resize);
		ro.observe(now);

		let visible = true;
		const io = new IntersectionObserver(([e]) => {
			visible = !!e?.isIntersecting;
			kick();
		});
		io.observe(now);

		/** Log-spaced band edges (in FFT bins) from 35 Hz to 14 kHz. */
		const bandEdges = (a: AnalyserNode) => {
			const binHz = a.context.sampleRate / a.fftSize;
			const out: number[] = [];
			for (let i = 0; i <= BANDS; i++) {
				const hz = 35 * Math.pow(14000 / 35, i / BANDS);
				out.push(Math.max(1, Math.round(hz / binHz)));
			}
			return out;
		};

		const sample = (): boolean => {
			const a = AetherMusic.analyser;
			const live = !!a && AetherMusic.playing;
			if (live) {
				if (!freq || freq.length !== a!.frequencyBinCount) {
					freq = new Uint8Array(a!.frequencyBinCount);
					wave = new Uint8Array(a!.fftSize);
					edges = bandEdges(a!);
				}
				a!.getByteFrequencyData(freq);
				a!.getByteTimeDomainData(wave!);
			}
			let moving = live;
			for (let i = 0; i < BANDS; i++) {
				let v = 0;
				if (live) {
					const from = edges[i]!;
					const to = Math.max(from + 1, edges[i + 1]!);
					for (let k = from; k < to; k++) v = Math.max(v, freq![k]!);
					// Tilt up the treble; real music has far less energy there.
					v = Math.pow(v / 255, 1.6) * (1 + i / BANDS);
					v = Math.min(1, v);
				}
				// Fast attack, slow release.
				level[i] = v > level[i]! ? v : level[i]! * 0.88 + v * 0.12;
				peak[i] = Math.max(level[i]!, peak[i]! - 0.012);
				if (level[i]! > 0.004 || peak[i]! > 0.004) moving = true;
			}
			return moving;
		};

		const paint = () => {
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, W, H);
			if (mode === "off") return;
			const color = (a: number, l = 66) => `hsl(${hue} 80% ${l}% / ${a})`;
			const bass = (level[0]! + level[1]! + level[2]! + level[3]!) / 4;
			art.style.scale = String(1 + bass * 0.04);

			if (mode === "bars") {
				// Mirrored: bass in the middle, treble out to both edges. Each
				// side shows BANDS / 2 bars, taking the louder of two bands.
				const half = BANDS / 2;
				const n = BANDS;
				const gap = 3;
				// Clamped: the pane can measure near zero mid open-animation.
				const bw = Math.max(1, (W - 40) / n - gap);
				const base = H - 14;
				const max = 60;
				const grad = g.createLinearGradient(0, base - max, 0, base);
				grad.addColorStop(0, color(0.95, 76));
				grad.addColorStop(1, color(0.25));
				for (let j = 0; j < n; j++) {
					const k = j < half ? half - 1 - j : j - half;
					const v = Math.max(level[k * 2]!, level[k * 2 + 1]!);
					const pk = Math.max(peak[k * 2]!, peak[k * 2 + 1]!);
					const bh = Math.max(2, v * max);
					const x = 20 + j * (bw + gap);
					g.fillStyle = grad;
					g.beginPath();
					g.roundRect(x, base - bh, bw, bh, [bw / 2, bw / 2, 1, 1]);
					g.fill();
					g.fillStyle = color(0.9, 84);
					g.fillRect(x, base - Math.max(2, pk * max) - 4, bw, 2);
				}
			} else if (mode === "wave" && wave) {
				const mid = H - 44;
				const amp = 24 + bass * 14;
				const step = Math.max(1, Math.floor(wave.length / W));
				// Auto-gain: a mastered mix rarely swings the raw signal far,
				// so scale this frame's loudest point up to the full height
				// (within reason, or silence would turn into magnified noise).
				let loudest = 0;
				for (let k = 0; k < wave.length; k += 4)
					loudest = Math.max(loudest, Math.abs(wave[k]! - 128));
				const gain = Math.min(8, 110 / Math.max(14, loudest));
				for (const [width, alpha] of [
					[7, 0.14],
					[2, 0.95],
				] as const) {
					g.lineWidth = width;
					g.strokeStyle = color(alpha, 74);
					g.lineJoin = "round";
					g.beginPath();
					for (let x = 0; x < W; x++) {
						const v = AetherMusic.playing
							? ((wave[Math.min(wave.length - 1, x * step)]! - 128) / 128) *
								gain
							: 0;
						// Taper the ends so the line fades into the edges.
						const y = mid + v * amp * Math.sin((x / W) * Math.PI);
						if (x) g.lineTo(x, y);
						else g.moveTo(x, y);
					}
					g.stroke();
				}
			} else if (mode === "orb") {
				if (!orb) {
					// Layout offsets, not client rects: the window may be
					// mid-animation (scaled) when this is measured.
					orb = {
						cx: stage.offsetLeft + stage.offsetWidth / 2,
						cy: stage.offsetTop + stage.offsetHeight / 2,
						r: stage.offsetWidth / 2 + 8,
					};
				}
				const { cx, cy } = orb;
				const r0 = orb.r;
				const glow = g.createRadialGradient(cx, cy, r0 * 0.8, cx, cy, r0 + 70);
				glow.addColorStop(0, color(0.25 + bass * 0.45));
				glow.addColorStop(1, color(0));
				g.fillStyle = glow;
				g.beginPath();
				g.arc(cx, cy, r0 + 70, 0, Math.PI * 2);
				g.fill();
				const n = BANDS * 2;
				g.lineCap = "round";
				g.lineWidth = Math.max(2, ((Math.PI * 2 * r0) / n) * 0.5);
				for (let j = 0; j < n; j++) {
					const i = j < BANDS ? j : n - 1 - j;
					const ang = (j / n) * Math.PI * 2 - Math.PI / 2;
					const len = 3 + level[i]! * 46;
					const cos = Math.cos(ang);
					const sin = Math.sin(ang);
					g.strokeStyle = color(0.5 + level[i]! * 0.5, 70 + level[i]! * 14);
					g.beginPath();
					g.moveTo(cx + cos * r0, cy + sin * r0);
					g.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
					g.stroke();
				}
			}
		};

		let raf = 0;
		const frame = () => {
			raf = 0;
			if (signal.aborted) return;
			const moving = sample();
			paint();
			if (moving && visible && mode !== "off")
				raf = requestAnimationFrame(frame);
		};
		function kick() {
			if (!raf && visible && mode !== "off" && !signal.aborted)
				raf = requestAnimationFrame(frame);
		}

		/* ---- lifecycle -------------------------------------------------- */

		win.addEventListener("close", () => {
			life.abort();
			cancelAnimationFrame(raf);
			ro.disconnect();
			io.disconnect();
		});

		renderList();
		renderTrack();
		renderState();
		renderMode();
		renderVolume();
		renderViz();

		// Render from what's known, then pick up anything changed in Files.
		await AetherMusic.scan();
		AetherMusic.readAllTags();
		if (args[0]) AetherMusic.playPath(args[0]);
		setTimeout(() => root.focus(), 50);
		return win;
	}
}
