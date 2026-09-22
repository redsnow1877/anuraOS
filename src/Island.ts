/**
 * Aether — the island: a black pill in the middle of the menu bar that shows
 * what's going on right now, and morphs as that changes.
 * ---------------------------------------------------------------------------
 *   Screen recording  red dot and running time; click to stop
 *   Timer             Clock's countdown; click to open Clock
 *   Music             cover and a live equaliser; hover for the full player
 *   HUD (transient)   volume and brightness levels as they change
 *
 * Only the highest-priority live activity is shown; a HUD takes over for a
 * moment and then hands back. Nothing here animates unless it's on screen:
 * the equaliser is a CSS animation paused with the music, and the per-second
 * tick only runs for the recording and timer modes.
 */

type AetherIslandMode = "idle" | "rec" | "timer" | "music" | "hud";

class AetherIsland {
	static #el: HTMLElement | null = null;
	static #mode: AetherIslandMode = "idle";
	static #expanded = false;
	static #hoverTimer = 0;
	static #tick = 0;
	static #hud: { icon: string; level: number; until: number } | null = null;
	static #hudTimer = 0;
	/** Music stays up a few seconds after pausing, so the pill doesn't flicker. */
	static #musicGrace = 0;
	static #musicGraceTimer = 0;

	/* ---- sources -------------------------------------------------------- */

	static #clock(): any {
		return anura.apps["anura.clock"];
	}

	static #live(): AetherIslandMode {
		const shot = (globalThis as any).AetherScreenshot;
		if (shot?.recording) return "rec";
		if (this.#clock()?.timer?.active) return "timer";
		const music = (globalThis as any).AetherMusic;
		if (music?.current && (music.playing || Date.now() < this.#musicGrace))
			return "music";
		return "idle";
	}

	/** A source's state changed: recompute what the island shows. */
	static refresh() {
		if (!this.#el) return;
		const mode: AetherIslandMode =
			this.#hud && Date.now() < this.#hud.until ? "hud" : this.#live();
		if (mode !== this.#mode) {
			this.#mode = mode;
			if (mode !== "music") this.#expanded = false;
			this.#build();
		} else this.#update();
		clearInterval(this.#tick);
		if (mode === "rec" || mode === "timer")
			this.#tick = window.setInterval(() => this.#update(), 1000);
	}

	/** Flash a level: `icon` is a Material Symbols name, `level` 0..1. */
	static hud(icon: string, level: number) {
		if (!this.#el) return;
		this.#hud = { icon, level, until: Date.now() + 1400 };
		clearTimeout(this.#hudTimer);
		this.#hudTimer = window.setTimeout(() => {
			this.#hud = null;
			this.refresh();
		}, 1400);
		this.refresh();
	}

	/* ---- rendering ------------------------------------------------------ */

	static #html(): string {
		switch (this.#mode) {
			case "rec":
				return `<span class="isl-rec-dot"></span><span class="isl-grow"></span><span class="isl-time isl-red"></span>`;
			case "timer":
				return `<span class="material-symbols-outlined isl-amber">timer</span><span class="isl-grow"></span><span class="isl-time isl-amber"></span>`;
			case "hud":
				return `<span class="material-symbols-outlined isl-hud-icon"></span><span class="isl-level"><span class="isl-level-fill"></span></span>`;
			case "music":
				return `
					<div class="isl-compact">
						<img class="isl-art" alt="" />
						<span class="isl-grow"></span>
						<span class="isl-eq"><i></i><i></i><i></i><i></i></span>
					</div>
					<div class="isl-full">
						<img class="isl-full-art" alt="" />
						<div class="isl-meta"><div class="isl-title"></div><div class="isl-artist"></div></div>
						<div class="isl-controls">
							<button data-a="prev" title="Previous">${aetherMediaIcon("prev")}</button>
							<button data-a="toggle" class="isl-play" title="Play">${aetherMediaIcon("play")}</button>
							<button data-a="next" title="Next">${aetherMediaIcon("next")}</button>
						</div>
						<div class="isl-bar"><div class="isl-bar-fill"></div></div>
					</div>`;
			default:
				return "";
		}
	}

	static #build() {
		const el = this.#el!;
		el.dataset.mode = this.#mode;
		el.classList.toggle("is-expanded", this.#expanded);
		// Swap the contents on the next frame so the old ones fade with the
		// morph instead of popping.
		el.classList.add("is-swapping");
		const inner = el.firstElementChild as HTMLElement;
		const html = this.#html();
		window.setTimeout(() => {
			if (el.dataset.mode !== this.#mode) return;
			inner.innerHTML = html;
			this.#update();
			el.classList.remove("is-swapping");
		}, 110);
	}

	static #update() {
		const el = this.#el!;
		const q = <T extends Element = HTMLElement>(s: string) =>
			el.querySelector<T>(s);
		switch (this.#mode) {
			case "rec": {
				const t = q(".isl-time");
				const start = (globalThis as any).AetherScreenshot?.recordingStart || 0;
				if (t && start)
					t.textContent = aetherFormatTime((Date.now() - start) / 1000);
				break;
			}
			case "timer": {
				const t = q(".isl-time");
				const tm = this.#clock()?.timer;
				if (t && tm) {
					const ms = tm.running
						? Math.max(0, tm.endsAt - Date.now())
						: tm.remaining;
					t.textContent = ClockApp.formatRemaining(ms);
					el.classList.toggle("is-paused", !tm.running);
				}
				break;
			}
			case "hud": {
				const h = this.#hud;
				const icon = q(".isl-hud-icon");
				if (!h || !icon) break;
				icon.textContent = h.icon;
				q(".isl-level-fill")!.style.scale =
					Math.max(0, Math.min(1, h.level)) + " 1";
				break;
			}
			case "music": {
				const m = AetherMusic;
				const t = m.current;
				if (!t) break;
				for (const img of [
					q<HTMLImageElement>(".isl-art"),
					q<HTMLImageElement>(".isl-full-art"),
				])
					if (img && img.getAttribute("src") !== t.art) img.src = t.art;
				const title = q(".isl-title");
				if (title) title.textContent = t.title;
				const artist = q(".isl-artist");
				if (artist) artist.textContent = t.artist;
				el.classList.toggle("is-playing", m.playing);
				const play = q(".isl-play");
				if (play) {
					const want = m.playing ? "pause" : "play";
					if (play.dataset.icon !== want) {
						play.dataset.icon = want;
						play.innerHTML = aetherMediaIcon(want);
						play.title = m.playing ? "Pause" : "Play";
					}
				}
				this.#updateTime();
				break;
			}
		}
	}

	static #updateTime() {
		if (this.#mode !== "music" || !this.#expanded) return;
		const fill = this.#el?.querySelector<HTMLElement>(".isl-bar-fill");
		const d = AetherMusic.duration;
		if (fill) fill.style.scale = (d ? AetherMusic.time / d : 0) + " 1";
	}

	static #setExpanded(on: boolean) {
		if (on && this.#mode !== "music") return;
		if (on === this.#expanded) return;
		this.#expanded = on;
		this.#el!.classList.toggle("is-expanded", on);
		this.#updateTime();
	}

	/* ---- boot ----------------------------------------------------------- */

	static init() {
		const bar = document.getElementById("menubar");
		if (!bar || this.#el) return;
		const el = document.createElement("div");
		el.id = "island";
		el.dataset.mode = "idle";
		el.append(document.createElement("div"));
		(el.firstElementChild as HTMLElement).className = "isl-inner";
		bar.appendChild(el);
		this.#el = el;

		el.addEventListener("pointerenter", () => {
			clearTimeout(this.#hoverTimer);
			this.#hoverTimer = window.setTimeout(() => this.#setExpanded(true), 140);
		});
		el.addEventListener("pointerleave", () => {
			clearTimeout(this.#hoverTimer);
			this.#hoverTimer = window.setTimeout(() => this.#setExpanded(false), 320);
		});
		el.addEventListener("click", (e) => {
			const btn = (e.target as Element).closest<HTMLElement>("button[data-a]");
			if (btn) {
				e.stopPropagation();
				const a = btn.dataset.a;
				if (a === "prev") AetherMusic.prev();
				else if (a === "next") AetherMusic.next();
				else AetherMusic.toggle();
				return;
			}
			if (this.#mode === "rec")
				(globalThis as any).AetherScreenshot?.stopRecording();
			else if (this.#mode === "timer") this.#clock()?.open(["timer"]);
			else if (this.#mode === "music") {
				if (this.#expanded) anura.apps["anura.music"]?.open();
				else this.#setExpanded(true);
			}
		});

		const music = (globalThis as any).AetherMusic;
		if (music) {
			music.events.addEventListener("track", () => this.refresh());
			music.events.addEventListener("state", () => {
				// Hold the pill a moment after a pause, then let it go.
				clearTimeout(this.#musicGraceTimer);
				if (!music.playing) {
					this.#musicGrace = Date.now() + 6000;
					this.#musicGraceTimer = window.setTimeout(() => this.refresh(), 6100);
				}
				this.refresh();
			});
			music.events.addEventListener("time", () => this.#updateTime());
		}
		(globalThis as any).AetherVolume?.addEventListener?.("change", () => {
			const v = (globalThis as any).aetherSound?.volume ?? 0;
			this.hud(
				v <= 0 ? "volume_off" : v < 0.5 ? "volume_down" : "volume_up",
				v,
			);
		});
		this.refresh();
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherIsland = AetherIsland;
