/**
 * Aether — the music engine behind the Music app and Control Center's
 * Now Playing card.
 * ---------------------------------------------------------------------------
 * Playback lives here rather than in the app window, so closing Music doesn't
 * stop the song; Control Center, Spotlight and the keyboard's media keys all
 * talk to the same player.
 *
 * Audio runs element → analyser → gain → speakers. The analyser feeds the
 * visualizers; volume is applied after it, so the visuals stay lively at low
 * volume. The player's own volume is scaled by the system level
 * ("sound-volume", the Control Center slider).
 *
 * Tags come from ID3v2 (MP3) and RIFF INFO (WAV); anything untagged falls back
 * to "Artist - Title" file names and a cover generated from the title.
 *
 * Events on AetherMusic.events:
 *   library   the song list changed (scan, import, tags parsed)
 *   track     a different song was loaded
 *   state     play / pause
 *   time      playback position moved (~4 Hz while playing)
 *   mode      shuffle or repeat changed
 */

interface AetherTrack {
	path: string;
	/** File name, extension included. */
	name: string;
	title: string;
	artist: string;
	album: string;
	/** Cover image URL: embedded art as a blob: URL, else a generated one. */
	art: string;
	/** Seconds; 0 until known. */
	duration: number;
	size: number;
	/** Tags have been read (or there were none to read). */
	parsed: boolean;
}

type AetherRepeat = "off" | "all" | "one";

class AetherMusic {
	static readonly DIR = "/Documents/Music";
	static readonly EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
	static readonly events = new EventTarget();

	static library: AetherTrack[] = [];
	static queue: AetherTrack[] = [];
	static index = -1;

	static #audio: HTMLAudioElement | null = null;
	static #url: string | null = null;
	static #ctx: AudioContext | null = null;
	static #analyser: AnalyserNode | null = null;
	static #gain: GainNode | null = null;
	static #suspendTimer = 0;
	/** Bumped per load so a slow read can't clobber a newer choice. */
	static #loadToken = 0;
	static #scanning: Promise<AetherTrack[]> | null = null;
	static #artCache = new Map<string, string>();

	/* ---- state ---------------------------------------------------------- */

	static get current(): AetherTrack | null {
		return this.queue[this.index] || null;
	}

	static get playing(): boolean {
		return !!this.#audio && !this.#audio.paused && !this.#audio.ended;
	}

	static get time(): number {
		return this.#audio?.currentTime || 0;
	}

	static get duration(): number {
		const d = this.#audio?.duration;
		return Number.isFinite(d) && d! > 0 ? d! : this.current?.duration || 0;
	}

	/** The spectrum source for visualizers; null until something has played. */
	static get analyser(): AnalyserNode | null {
		return this.#analyser;
	}

	static get volume(): number {
		const v = Number(anura.settings.get("music.volume"));
		return Number.isFinite(v) && anura.settings.has("music.volume") ? v : 0.8;
	}

	static set volume(v: number) {
		anura.settings.set("music.volume", Math.max(0, Math.min(1, v)));
		this.#applyVolume();
	}

	static get shuffle(): boolean {
		return !!anura.settings.get("music.shuffle");
	}

	static get repeat(): AetherRepeat {
		const r = anura.settings.get("music.repeat");
		return r === "all" || r === "one" ? r : "off";
	}

	static #emit(type: string) {
		this.events.dispatchEvent(new Event(type));
	}

	/* ---- library -------------------------------------------------------- */

	/** "01 - Artist - Title.mp3" → { artist, title }. */
	static fromFileName(name: string): { title: string; artist: string } {
		const base = name
			.replace(/\.[^.]+$/, "")
			.replace(/^\d{1,3}(\s*[-.]\s*|\s+)/, "")
			.replace(/_/g, " ")
			.trim();
		const dash = base.indexOf(" - ");
		if (dash > 0)
			return {
				artist: base.slice(0, dash).trim(),
				title: base.slice(dash + 3).trim() || base,
			};
		return { artist: "Unknown Artist", title: base || name };
	}

	static #mime(path: string): string {
		const ext = path.split(".").pop()!.toLowerCase();
		return (
			{
				mp3: "audio/mpeg",
				m4a: "audio/mp4",
				aac: "audio/aac",
				ogg: "audio/ogg",
				oga: "audio/ogg",
				opus: "audio/ogg",
				wav: "audio/wav",
				flac: "audio/flac",
				webm: "audio/webm",
			} as Record<string, string>
		)[ext]!;
	}

	static #track(path: string, size: number): AetherTrack {
		const name = path.split("/").pop()!;
		const { title, artist } = this.fromFileName(name);
		const t: AetherTrack = {
			path,
			name,
			title,
			artist,
			album: "",
			art: "",
			duration: 0,
			size,
			parsed: !/\.(mp3|wav)$/i.test(name),
		};
		t.art = this.coverFor(t);
		return t;
	}

	/**
	 * List the Music folder. Existing track objects are reused so the queue
	 * and any open windows keep pointing at the same songs.
	 */
	static scan(): Promise<AetherTrack[]> {
		if (this.#scanning) return this.#scanning;
		this.#scanning = (async () => {
			const fs = anura.fs.promises;
			try {
				await new anura.fs.Shell().promises.mkdirp(this.DIR);
			} catch {
				/* exists */
			}
			let names: string[] = [];
			try {
				names = await fs.readdir(this.DIR);
			} catch {
				/* unreadable: empty library */
			}
			const old = new Map(this.library.map((t) => [t.path, t]));
			const tracks: AetherTrack[] = [];
			for (const name of names) {
				if (!this.EXT.test(name)) continue;
				const path = this.DIR + "/" + name;
				let size = 0;
				try {
					size = ((await fs.stat(path)) as any).size || 0;
				} catch {
					continue;
				}
				const prev = old.get(path);
				tracks.push(
					prev && prev.size === size ? prev : this.#track(path, size),
				);
			}
			tracks.sort((a, b) =>
				a.title.localeCompare(b.title, undefined, { numeric: true }),
			);
			this.library = tracks;
			this.#emit("library");
			return tracks;
		})().finally(() => (this.#scanning = null));
		return this.#scanning;
	}

	/** Read tags for every song that still needs it, one file at a time. */
	static async readAllTags() {
		for (const t of this.library.slice()) {
			if (t.parsed) continue;
			try {
				this.#applyTags(t, await anura.fs.promises.readFile(t.path));
			} catch {
				t.parsed = true;
			}
			// Let the UI breathe between files.
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	static #applyTags(t: AetherTrack, data: Uint8Array) {
		if (t.parsed) return;
		t.parsed = true;
		const bytes = new Uint8Array(
			(data as any).buffer ?? data,
			(data as any).byteOffset ?? 0,
			data.length,
		);
		const tags = /\.wav$/i.test(t.name)
			? AetherTags.riff(bytes)
			: AetherTags.id3(bytes);
		if (tags.title) t.title = tags.title;
		if (tags.artist) t.artist = tags.artist;
		if (tags.album) t.album = tags.album;
		if (tags.duration) t.duration = tags.duration;
		if (tags.art) t.art = URL.createObjectURL(tags.art);
		else if (tags.title || tags.artist) t.art = this.coverFor(t);
		this.#emit("library");
	}

	/**
	 * A cover for songs without one: two soft blobs of colour and a wave,
	 * seeded from the title and artist so every song gets its own.
	 */
	static coverFor(t: { title: string; artist: string }): string {
		const key = t.title + "\u0000" + t.artist;
		const hit = this.#artCache.get(key);
		if (hit) return hit;
		let h = 2166136261;
		for (let i = 0; i < key.length; i++) {
			h ^= key.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		const rnd = () => {
			h ^= h << 13;
			h ^= h >>> 17;
			h ^= h << 5;
			return (h >>> 0) / 4294967296;
		};
		const S = 240;
		const c = document.createElement("canvas");
		c.width = c.height = S;
		const g = c.getContext("2d")!;
		const hue = rnd() * 360;
		const hue2 = hue + 40 + rnd() * 120;
		g.fillStyle = `hsl(${hue} 45% 14%)`;
		g.fillRect(0, 0, S, S);
		const blob = (x: number, y: number, r: number, color: string) => {
			const grad = g.createRadialGradient(x, y, 0, x, y, r);
			grad.addColorStop(0, color);
			grad.addColorStop(1, "transparent");
			g.fillStyle = grad;
			g.fillRect(0, 0, S, S);
		};
		blob(
			S * (0.2 + rnd() * 0.3),
			S * (0.15 + rnd() * 0.3),
			S * 0.75,
			`hsl(${hue} 80% 58% / 0.9)`,
		);
		blob(
			S * (0.55 + rnd() * 0.3),
			S * (0.6 + rnd() * 0.3),
			S * 0.7,
			`hsl(${hue2} 85% 60% / 0.85)`,
		);
		// One luminous wave across the lower third.
		g.strokeStyle = "rgba(255,255,255,0.55)";
		g.lineWidth = 2;
		g.shadowColor = "rgba(255,255,255,0.8)";
		g.shadowBlur = 8;
		g.beginPath();
		const amp = 8 + rnd() * 14;
		const freq = 1.5 + rnd() * 2.5;
		const phase = rnd() * Math.PI * 2;
		for (let x = 0; x <= S; x += 4) {
			const y =
				S * 0.72 +
				Math.sin((x / S) * Math.PI * 2 * freq + phase) *
					amp *
					Math.sin((x / S) * Math.PI);
			if (x) g.lineTo(x, y);
			else g.moveTo(x, y);
		}
		g.stroke();
		g.shadowBlur = 0;
		// A little film grain so the gradients don't band.
		const img = g.getImageData(0, 0, S, S);
		const px = img.data;
		for (let i = 0; i < px.length; i += 4) {
			const n = (rnd() - 0.5) * 14;
			px[i] = px[i]! + n;
			px[i + 1] = px[i + 1]! + n;
			px[i + 2] = px[i + 2]! + n;
		}
		g.putImageData(img, 0, 0);
		const url = c.toDataURL("image/jpeg", 0.86);
		this.#artCache.set(key, url);
		return url;
	}

	/** Copy files from the real computer into the Music folder. */
	static async importFiles(files: Iterable<File>): Promise<number> {
		try {
			await new anura.fs.Shell().promises.mkdirp(this.DIR);
		} catch {
			/* exists */
		}
		let n = 0;
		for (const file of files) {
			if (!this.EXT.test(file.name)) continue;
			await anura.fs.promises.writeFile(
				this.DIR + "/" + file.name.replace(/[\\/]/g, "_"),
				new Uint8Array(await file.arrayBuffer()) as any,
			);
			n++;
		}
		if (n) await this.scan();
		return n;
	}

	static async remove(t: AetherTrack) {
		if (this.current === t) this.stop();
		try {
			await anura.fs.promises.unlink(t.path);
		} catch {
			/* already gone */
		}
		const qi = this.queue.indexOf(t);
		if (qi >= 0) {
			this.queue.splice(qi, 1);
			if (qi < this.index) this.index--;
		}
		await this.scan();
	}

	/* ---- audio graph ---------------------------------------------------- */

	static #ensureAudio(): HTMLAudioElement {
		if (this.#audio) return this.#audio;
		const a = new Audio();
		a.preload = "auto";
		a.addEventListener("play", () => this.#onState());
		a.addEventListener("pause", () => this.#onState());
		a.addEventListener("timeupdate", () => {
			this.#emit("time");
			this.#positionState();
		});
		a.addEventListener("loadedmetadata", () => {
			const t = this.current;
			if (t && Number.isFinite(a.duration)) t.duration = a.duration;
			this.#emit("time");
		});
		a.addEventListener("ended", () => this.next(true));
		a.addEventListener("error", () => {
			const t = this.current;
			if (!t || !a.src) return;
			anura.notifications.add({
				title: "Can't play this song",
				description: `${t.name}: this browser doesn't support the format.`,
				timeout: 5000,
			});
		});
		this.#audio = a;
		return a;
	}

	/** Build the WebAudio graph on first play (it needs a user gesture). */
	static #ensureGraph() {
		if (this.#ctx || !this.#audio) return;
		try {
			const Ctor: typeof AudioContext =
				(window as any).AudioContext || (window as any).webkitAudioContext;
			const ctx = new Ctor();
			const src = ctx.createMediaElementSource(this.#audio);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0.78;
			const gain = ctx.createGain();
			src.connect(analyser);
			analyser.connect(gain);
			gain.connect(ctx.destination);
			this.#ctx = ctx;
			this.#analyser = analyser;
			this.#gain = gain;
		} catch (e) {
			// No WebAudio: the element plays directly, no visualizer.
			console.warn("[music] audio graph unavailable", e);
		}
		this.#applyVolume();
	}

	static #applyVolume() {
		const system = (globalThis as any).aetherSound?.volume ?? 0.4;
		// Squared: a linear slider feels far too loud in its top half. The
		// system level is the gentler square root so the default (0.4, tuned
		// for UI sounds) still leaves music comfortably audible.
		const level = Math.pow(this.volume, 2) * Math.sqrt(system);
		if (this.#gain && this.#ctx) {
			this.#gain.gain.setTargetAtTime(level, this.#ctx.currentTime, 0.03);
			if (this.#audio) this.#audio.volume = 1;
		} else if (this.#audio) {
			this.#audio.volume = Math.max(0, Math.min(1, level));
		}
	}

	static #onState() {
		const playing = this.playing;
		clearTimeout(this.#suspendTimer);
		// An idle AudioContext still renders silence on the audio thread;
		// park it a few seconds into a pause.
		if (!playing && this.#ctx?.state === "running")
			this.#suspendTimer = window.setTimeout(() => {
				if (!this.playing) this.#ctx?.suspend();
			}, 4000);
		if ("mediaSession" in navigator)
			navigator.mediaSession.playbackState = playing ? "playing" : "paused";
		this.#emit("state");
	}

	/* ---- transport ------------------------------------------------------ */

	/** Play `tracks` starting at `start`, honouring shuffle. */
	static async playList(tracks: AetherTrack[], start = 0) {
		if (!tracks.length) return;
		const first = tracks[Math.max(0, Math.min(start, tracks.length - 1))]!;
		this.queue = this.shuffle
			? [first, ...AetherMusic.#shuffled(tracks.filter((t) => t !== first))]
			: tracks.slice();
		await this.#load(this.queue.indexOf(first), true);
	}

	/** Play a file by path: a library song, or any audio file on disk. */
	static async playPath(path: string) {
		if (!this.library.length) await this.scan();
		const hit = this.library.find((t) => t.path === path);
		if (hit) return this.playList(this.library, this.library.indexOf(hit));
		let size = 0;
		try {
			size = ((await anura.fs.promises.stat(path)) as any).size || 0;
		} catch {
			return;
		}
		const t = this.#track(path, size);
		this.queue.splice(this.index + 1, 0, t);
		await this.#load(this.index + 1, true);
	}

	static async #load(i: number, autoplay: boolean) {
		if (!this.queue.length) return;
		this.index = (i + this.queue.length) % this.queue.length;
		const t = this.queue[this.index]!;
		const token = ++this.#loadToken;
		let data: Uint8Array;
		try {
			data = await anura.fs.promises.readFile(t.path);
		} catch {
			anura.notifications.add({
				title: "Song not found",
				description: t.name,
				timeout: 4000,
			});
			return;
		}
		if (token !== this.#loadToken) return;
		this.#applyTags(t, data);
		const url = URL.createObjectURL(
			new Blob([data as any], { type: this.#mime(t.path) }),
		);
		const a = this.#ensureAudio();
		a.src = url;
		if (this.#url) URL.revokeObjectURL(this.#url);
		this.#url = url;
		anura.settings.set("music.last", t.path);
		this.#mediaSession();
		this.#emit("track");
		if (autoplay) await this.play();
	}

	static async play() {
		if (!this.current) return this.resume();
		const a = this.#ensureAudio();
		this.#ensureGraph();
		clearTimeout(this.#suspendTimer);
		if (this.#ctx && this.#ctx.state !== "running") {
			try {
				await this.#ctx.resume();
			} catch {
				/* resumes on the next gesture */
			}
		}
		try {
			await a.play();
		} catch (e) {
			if ((e as Error)?.name !== "AbortError") console.warn("[music]", e);
		}
	}

	static pause() {
		this.#audio?.pause();
	}

	static toggle() {
		if (this.playing) this.pause();
		else this.play();
	}

	/** Nothing loaded yet: pick up the last song, or start the library. */
	static async resume() {
		if (!this.library.length) await this.scan();
		if (!this.library.length) {
			anura.apps["anura.music"]?.open();
			return;
		}
		const last = anura.settings.get("music.last");
		const i = Math.max(
			0,
			this.library.findIndex((t) => t.path === last),
		);
		await this.playList(this.library, i);
	}

	static stop() {
		const a = this.#audio;
		if (a) {
			a.pause();
			a.removeAttribute("src");
			a.load();
		}
		if (this.#url) URL.revokeObjectURL(this.#url);
		this.#url = null;
		this.queue = [];
		this.index = -1;
		if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
		this.#emit("track");
		this.#emit("state");
	}

	/** `auto` when a song ended by itself: repeat-one replays, the end stops. */
	static next(auto = false) {
		if (!this.queue.length) return;
		const a = this.#audio!;
		if (auto && this.repeat === "one") {
			a.currentTime = 0;
			this.play();
			return;
		}
		if (this.index + 1 >= this.queue.length) {
			if (auto && this.repeat === "off") {
				a.currentTime = 0;
				this.#emit("time");
				return;
			}
		}
		this.#load(this.index + 1, auto || this.playing);
	}

	static prev() {
		if (!this.queue.length) return;
		const a = this.#audio!;
		// Like every music player ever: first press rewinds, second goes back.
		if (a.currentTime > 3 || (this.index === 0 && this.repeat !== "all")) {
			a.currentTime = 0;
			this.#emit("time");
			return;
		}
		this.#load(this.index - 1, this.playing);
	}

	static seek(seconds: number) {
		const a = this.#audio;
		if (!a || !this.duration) return;
		a.currentTime = Math.max(0, Math.min(this.duration - 0.05, seconds));
		this.#emit("time");
	}

	static setShuffle(on: boolean) {
		anura.settings.set("music.shuffle", on);
		const cur = this.current;
		if (cur && this.library.includes(cur)) {
			this.queue = on
				? [cur, ...this.#shuffled(this.library.filter((t) => t !== cur))]
				: this.library.slice();
			this.index = this.queue.indexOf(cur);
		}
		this.#emit("mode");
	}

	static cycleRepeat() {
		const order: AetherRepeat[] = ["off", "all", "one"];
		anura.settings.set(
			"music.repeat",
			order[(order.indexOf(this.repeat) + 1) % order.length],
		);
		this.#emit("mode");
	}

	static #shuffled<T>(list: T[]): T[] {
		const a = list.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j]!, a[i]!];
		}
		return a;
	}

	/* ---- media keys ----------------------------------------------------- */

	static #mediaSession() {
		if (!("mediaSession" in navigator)) return;
		const t = this.current;
		if (!t) return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: t.title,
				artist: t.artist,
				album: t.album,
				artwork: [{ src: t.art, sizes: "240x240" }],
			});
		} catch {
			/* MediaMetadata missing */
		}
	}

	static #positionState() {
		if (!("mediaSession" in navigator) || !this.duration) return;
		try {
			navigator.mediaSession.setPositionState({
				duration: this.duration,
				position: Math.min(this.time, this.duration),
				playbackRate: 1,
			});
		} catch {
			/* not supported */
		}
	}

	/* ---- boot ----------------------------------------------------------- */

	static init() {
		if ("mediaSession" in navigator) {
			const ms = navigator.mediaSession;
			const set = (action: string, fn: (d: any) => void) => {
				try {
					ms.setActionHandler(action as MediaSessionAction, fn);
				} catch {
					/* action unsupported */
				}
			};
			set("play", () => this.play());
			set("pause", () => this.pause());
			set("previoustrack", () => this.prev());
			set("nexttrack", () => this.next());
			set("seekto", (d) => this.seek(d.seekTime));
			set("seekbackward", (d) => this.seek(this.time - (d.seekOffset || 10)));
			set("seekforward", (d) => this.seek(this.time + (d.seekOffset || 10)));
		}
		(globalThis as any).AetherVolume?.addEventListener?.("change", () =>
			this.#applyVolume(),
		);

		AetherCommands.register({
			id: "music-toggle",
			title: () => (this.playing ? "Pause Music" : "Play Music"),
			subtitle: () =>
				this.current ? `${this.current.title} — ${this.current.artist}` : "",
			icon: "play_pause",
			keywords: ["music", "song", "resume", "pause", "play"],
			run: () => this.toggle(),
		});
		AetherCommands.register({
			id: "music-next",
			title: "Next Song",
			icon: "skip_next",
			keywords: ["music", "skip", "track"],
			run: () => this.next(),
		});
		AetherCommands.register({
			id: "music-prev",
			title: "Previous Song",
			icon: "skip_previous",
			keywords: ["music", "back", "track"],
			run: () => this.prev(),
		});
		AetherSpotlight.registerProvider({
			id: "music",
			label: "Music",
			limit: 4,
			search: (q) =>
				this.library
					.map((t) => {
						const score = Math.max(
							aetherMatch(q, t.title),
							aetherMatch(q, t.artist) - 40,
							aetherMatch(q, t.album) - 60,
						);
						if (score < 0) return null;
						return {
							id: "song:" + t.path,
							title: t.title,
							subtitle: [t.artist, t.album].filter(Boolean).join(" · "),
							icon: t.art,
							score: score - 50,
							accessory: "Play",
							matchText: t.title,
							run: () => this.playList(this.library, this.library.indexOf(t)),
						};
					})
					.filter((r) => !!r) as any,
		});
		// Only a directory listing: tags are read when Music opens.
		const idle = (window as any).requestIdleCallback || setTimeout;
		idle(() => this.scan(), { timeout: 4000 });
	}
}

/** Just enough tag parsing for a music library. */
class AetherTags {
	static #text(enc: number, b: Uint8Array): string {
		let label = "utf-8";
		if (enc === 0) label = "iso-8859-1";
		else if (enc === 1) {
			if (b[0] === 0xfe && b[1] === 0xff) label = "utf-16be";
			else label = "utf-16le";
		} else if (enc === 2) label = "utf-16be";
		let s = new TextDecoder(label).decode(b);
		if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // byte-order mark
		// Multiple values are NUL-separated; the first is the one to show.
		return s.split("\u0000")[0]!.trim();
	}

	static #syncsafe(b: Uint8Array, o: number): number {
		return (
			((b[o]! & 0x7f) << 21) |
			((b[o + 1]! & 0x7f) << 14) |
			((b[o + 2]! & 0x7f) << 7) |
			(b[o + 3]! & 0x7f)
		);
	}

	static #be(b: Uint8Array, o: number, n: number): number {
		let v = 0;
		for (let i = 0; i < n; i++) v = v * 256 + b[o + i]!;
		return v;
	}

	/** ID3v2.2 / 2.3 / 2.4: title, artist, album and the front cover. */
	static id3(b: Uint8Array): {
		title?: string;
		artist?: string;
		album?: string;
		art?: Blob;
		duration?: number;
	} {
		const out: ReturnType<typeof AetherTags.id3> = {};
		if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33)
			return out;
		const ver = b[3]!;
		const flags = b[5]!;
		const end = Math.min(b.length, 10 + this.#syncsafe(b, 6));
		let o = 10;
		if (flags & 0x40)
			o += ver === 4 ? this.#syncsafe(b, 10) : this.#be(b, 10, 4) + 4;
		const v22 = ver === 2;
		const idLen = v22 ? 3 : 4;
		const hdr = v22 ? 6 : 10;
		const names: Record<string, "title" | "artist" | "album"> = v22
			? { TT2: "title", TP1: "artist", TAL: "album" }
			: { TIT2: "title", TPE1: "artist", TALB: "album" };
		while (o + hdr <= end) {
			if (b[o] === 0) break; // padding
			const id = String.fromCharCode(...b.subarray(o, o + idLen));
			const size = v22
				? this.#be(b, o + 3, 3)
				: ver === 4
					? this.#syncsafe(b, o + 4)
					: this.#be(b, o + 4, 4);
			const data = b.subarray(o + hdr, Math.min(end, o + hdr + size));
			o += hdr + size;
			if (!size) continue;
			try {
				if (names[id]) out[names[id]] = this.#text(data[0]!, data.subarray(1));
				else if ((id === "APIC" || id === "PIC") && !out.art) {
					const enc = data[0]!;
					let p = 1;
					let mime: string;
					if (v22) {
						const fmt = String.fromCharCode(
							...data.subarray(1, 4),
						).toLowerCase();
						mime = fmt === "png" ? "image/png" : "image/jpeg";
						p = 4;
					} else {
						const z = data.indexOf(0, p);
						mime = String.fromCharCode(...data.subarray(p, z)) || "image/jpeg";
						if (!mime.includes("/")) mime = "image/" + mime.toLowerCase();
						p = z + 1;
					}
					p++; // picture type
					// Skip the description: one NUL, or two for UTF-16.
					if (enc === 1 || enc === 2) {
						while (p + 1 < data.length && (data[p] || data[p + 1])) p += 2;
						p += 2;
					} else {
						while (p < data.length && data[p]) p++;
						p++;
					}
					if (p < data.length)
						out.art = new Blob([data.slice(p) as any], { type: mime });
				}
			} catch {
				/* a malformed frame shouldn't cost us the rest */
			}
		}
		return out;
	}

	/** WAV: LIST/INFO names and the exact duration from the header. */
	static riff(b: Uint8Array): ReturnType<typeof AetherTags.id3> {
		const out: ReturnType<typeof AetherTags.id3> = {};
		const str = (o: number, n: number) =>
			String.fromCharCode(...b.subarray(o, o + n));
		const le = (o: number) =>
			(b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
		if (b.length < 12 || str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE")
			return out;
		let byteRate = 0;
		let o = 12;
		while (o + 8 <= b.length) {
			const id = str(o, 4);
			const size = le(o + 4);
			const body = o + 8;
			if (id === "fmt ") byteRate = le(body + 8);
			else if (id === "data" && byteRate) out.duration = size / byteRate;
			else if (id === "LIST" && str(body, 4) === "INFO") {
				let p = body + 4;
				while (p + 8 <= body + size) {
					const sid = str(p, 4);
					const ssize = le(p + 4);
					const val = new TextDecoder()
						.decode(b.subarray(p + 8, p + 8 + ssize))
						.split("\u0000")[0]!
						.trim();
					if (sid === "INAM") out.title = val;
					else if (sid === "IART") out.artist = val;
					else if (sid === "IPRD") out.album = val;
					p += 8 + ssize + (ssize & 1);
				}
			}
			o = body + size + (size & 1);
		}
		return out;
	}
}

/**
 * Filled transport glyphs. The icon font is the static outlined cut, whose
 * "pause" is two hollow bars, which reads as "00" at button size.
 */
function aetherMediaIcon(name: "play" | "pause" | "next" | "prev"): string {
	const skip =
		'<path d="M2.5 6.6v10.8a.8.8 0 0 0 1.25.66L11.5 12.7v4.7a.8.8 0 0 0 1.25.66l8-5.4a.8.8 0 0 0 0-1.32l-8-5.4a.8.8 0 0 0-1.25.66v4.7L3.75 5.94A.8.8 0 0 0 2.5 6.6Z"/>';
	const body = {
		play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.1-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6Z"/>',
		pause:
			'<rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/>',
		next: skip,
		prev: '<g transform="matrix(-1 0 0 1 24 0)">' + skip + "</g>",
	}[name];
	return `<svg class="media-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;
}

function aetherFormatTime(s: number): string {
	if (!Number.isFinite(s) || s < 0) s = 0;
	const m = Math.floor(s / 60);
	return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

/** Control Center's Now Playing card. Built once; follows the player. */
function aetherNowPlayingCard(): HTMLElement {
	const card = document.createElement("div");
	card.className = "np-card";
	card.innerHTML = `
		<img class="np-art" alt="" />
		<div class="np-meta"><div class="np-title"></div><div class="np-artist"></div></div>
		<div class="np-controls">
			<button class="np-btn" data-a="prev" title="Previous">${aetherMediaIcon("prev")}</button>
			<button class="np-btn np-play" data-a="toggle" title="Play">${aetherMediaIcon("play")}</button>
			<button class="np-btn" data-a="next" title="Next">${aetherMediaIcon("next")}</button>
		</div>
		<div class="np-progress"><div class="np-fill"></div></div>`;
	const art = card.querySelector<HTMLImageElement>(".np-art")!;
	const title = card.querySelector<HTMLElement>(".np-title")!;
	const artist = card.querySelector<HTMLElement>(".np-artist")!;
	const playBtn = card.querySelector<HTMLElement>(".np-play")!;
	const fill = card.querySelector<HTMLElement>(".np-fill")!;

	const renderTrack = () => {
		const t = AetherMusic.current;
		card.classList.toggle("is-idle", !t);
		title.textContent = t ? t.title : "Not Playing";
		artist.textContent = t ? t.artist : "Open Music to pick a song";
		if (t) art.src = t.art;
		else art.removeAttribute("src");
	};
	const renderState = () => {
		playBtn.innerHTML = aetherMediaIcon(AetherMusic.playing ? "pause" : "play");
		playBtn.title = AetherMusic.playing ? "Pause" : "Play";
		card.classList.toggle("is-playing", AetherMusic.playing);
	};
	const renderTime = () => {
		const d = AetherMusic.duration;
		fill.style.scale = (d ? AetherMusic.time / d : 0) + " 1";
	};
	AetherMusic.events.addEventListener("track", () => {
		renderTrack();
		renderTime();
	});
	AetherMusic.events.addEventListener("library", renderTrack);
	AetherMusic.events.addEventListener("state", renderState);
	AetherMusic.events.addEventListener("time", renderTime);

	card.addEventListener("click", (e) => {
		const btn = (e.target as Element).closest<HTMLElement>(".np-btn");
		if (btn) {
			e.stopPropagation();
			const act = btn.dataset.a;
			if (act === "prev") AetherMusic.prev();
			else if (act === "next") AetherMusic.next();
			else AetherMusic.toggle();
			return;
		}
		anura.apps["anura.music"]?.open();
	});
	renderTrack();
	renderState();
	renderTime();
	return card;
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherMusic = AetherMusic;
(globalThis as any).AetherTags = AetherTags;
(globalThis as any).aetherNowPlayingCard = aetherNowPlayingCard;
(globalThis as any).aetherFormatTime = aetherFormatTime;
(globalThis as any).aetherMediaIcon = aetherMediaIcon;
