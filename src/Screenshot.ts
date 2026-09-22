/**
 * Aether — screenshots and screen recording
 * ---------------------------------------------------------------------------
 *   Ctrl+Shift+3   capture the whole screen
 *   Ctrl+Shift+4   capture a region
 *   Ctrl+Shift+5   start / stop a screen recording
 *
 * A web page can't read its own pixels (iframes and cross-origin images are
 * off limits), so capture goes through the browser's screen-sharing API with
 * `preferCurrentTab`: the browser asks once per capture, and what comes back
 * is exactly what's on screen, iframes included.
 *
 * Region capture freezes the frame first and lets you drag over the still
 * image, so the selection UI can never end up in the picture.
 *
 * Screenshots go to /Documents/Pictures as PNG, recordings to
 * /Documents/Movies as WebM. A thumbnail slides in afterwards; click it to
 * open the picture in Photos.
 */

class AetherScreenshot {
	static readonly PICTURES = "/Documents/Pictures";
	static readonly MOVIES = "/Documents/Movies";

	/** One capture at a time: a second grab would photograph the first's flash. */
	static #busy = false;
	static #recorder: MediaRecorder | null = null;
	static #recStart = 0;
	static #recTimer = 0;
	static #indicator: HTMLElement | null = null;

	static get supported(): boolean {
		return !!navigator.mediaDevices?.getDisplayMedia;
	}

	static #stamp() {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
	}

	static #unsupported() {
		anura.notifications.add({
			title: "Screen capture unavailable",
			description: "This browser doesn't allow pages to capture the screen.",
			timeout: 5000,
		});
	}

	static async #stream(): Promise<MediaStream> {
		return navigator.mediaDevices.getDisplayMedia({
			video: { displaySurface: "browser", frameRate: 30 } as any,
			audio: false,
			preferCurrentTab: true,
			selfBrowserSurface: "include",
		} as any);
	}

	/** One frame from a short-lived capture, as a canvas at device resolution. */
	static async #grab(): Promise<HTMLCanvasElement> {
		// Our own chrome never belongs in a screenshot: drop a previous
		// capture's flash and floating thumbnail before the frame is taken.
		document.getElementById("shot-flash")?.remove();
		document.querySelector(".shot-thumb")?.remove();
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		);
		const stream = await this.#stream();
		try {
			const video = document.createElement("video");
			video.muted = true;
			video.srcObject = stream;
			await video.play();
			// The first frame can be a stale compositor frame; wait for a fresh one.
			await new Promise((r) =>
				requestAnimationFrame(() => requestAnimationFrame(r)),
			);
			const canvas = document.createElement("canvas");
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			canvas.getContext("2d")!.drawImage(video, 0, 0);
			video.srcObject = null;
			return canvas;
		} finally {
			stream.getTracks().forEach((t) => t.stop());
		}
	}

	static async #write(dir: string, name: string, blob: Blob): Promise<string> {
		try {
			await new anura.fs.Shell().promises.mkdirp(dir);
		} catch {
			/* exists */
		}
		const path = `${dir}/${name}`;
		await anura.fs.promises.writeFile(
			path,
			new Uint8Array(await blob.arrayBuffer()) as any,
		);
		return path;
	}

	static #flash() {
		const f = document.createElement("div");
		f.id = "shot-flash";
		document.body.appendChild(f);
		setTimeout(() => f.remove(), 520);
		(globalThis as any).aetherSound?.play?.("shutter");
	}

	static #thumbnail(canvas: HTMLCanvasElement, path: string) {
		document.querySelector(".shot-thumb")?.remove();
		const t = document.createElement("button");
		t.className = "shot-thumb";
		t.title = "Open in Photos";
		const img = document.createElement("img");
		img.src = canvas.toDataURL("image/jpeg", 0.7);
		img.alt = "";
		t.appendChild(img);
		t.addEventListener("click", () => {
			t.remove();
			anura.apps["anura.photos"]?.open([path]);
		});
		document.body.appendChild(t);
		requestAnimationFrame(() => t.classList.add("is-shown"));
		setTimeout(() => {
			t.classList.remove("is-shown");
			setTimeout(() => t.remove(), 400);
		}, 5000);
	}

	static async #save(canvas: HTMLCanvasElement) {
		const blob: Blob | null = await new Promise((r) =>
			canvas.toBlob(r, "image/png"),
		);
		if (!blob) return;
		const path = await this.#write(
			this.PICTURES,
			`Screenshot ${this.#stamp()}.png`,
			blob,
		);
		this.#thumbnail(canvas, path);
	}

	/* ---- full screen --------------------------------------------------- */

	static async capture() {
		if (!this.supported) return this.#unsupported();
		if (this.#busy) return;
		this.#busy = true;
		try {
			const canvas = await this.#grab();
			this.#flash();
			await this.#save(canvas);
		} catch (e) {
			// The user dismissed the browser's share prompt: nothing to report.
			if ((e as Error)?.name !== "NotAllowedError")
				console.warn("[screenshot]", e);
		} finally {
			this.#busy = false;
		}
	}

	/* ---- region -------------------------------------------------------- */

	static async captureRegion() {
		if (!this.supported) return this.#unsupported();
		if (this.#busy) return;
		this.#busy = true;
		let full: HTMLCanvasElement;
		try {
			full = await this.#grab();
		} catch (e) {
			this.#busy = false;
			if ((e as Error)?.name !== "NotAllowedError")
				console.warn("[screenshot]", e);
			return;
		}
		// Freeze-frame: the selection happens over the still image.
		const layer = document.createElement("div");
		layer.id = "shot-region";
		const still = document.createElement("img");
		still.src = full.toDataURL("image/png");
		still.alt = "";
		const box = document.createElement("div");
		box.className = "shot-box";
		const size = document.createElement("div");
		size.className = "shot-size";
		const hint = document.createElement("div");
		hint.className = "shot-hint";
		hint.textContent = "Drag to select an area · Esc to cancel";
		layer.append(still, box, size, hint);
		document.body.appendChild(layer);

		const scaleX = full.width / window.innerWidth;
		const scaleY = full.height / window.innerHeight;
		let start: [number, number] | null = null;
		let rect = { x: 0, y: 0, w: 0, h: 0 };

		const done = () => {
			layer.remove();
			document.removeEventListener("keydown", onKey, true);
			this.#busy = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				done();
			}
		};
		document.addEventListener("keydown", onKey, true);

		layer.addEventListener("pointerdown", (e) => {
			layer.setPointerCapture(e.pointerId);
			start = [e.clientX, e.clientY];
			hint.remove();
		});
		layer.addEventListener("pointermove", (e) => {
			if (!start) return;
			rect = {
				x: Math.min(start[0], e.clientX),
				y: Math.min(start[1], e.clientY),
				w: Math.abs(e.clientX - start[0]),
				h: Math.abs(e.clientY - start[1]),
			};
			Object.assign(box.style, {
				left: rect.x + "px",
				top: rect.y + "px",
				width: rect.w + "px",
				height: rect.h + "px",
				display: "block",
			});
			size.textContent = `${Math.round(rect.w * scaleX)} × ${Math.round(rect.h * scaleY)}`;
			Object.assign(size.style, {
				left: rect.x + rect.w + 8 + "px",
				top: rect.y + rect.h + 8 + "px",
				display: "block",
			});
		});
		layer.addEventListener("pointerup", async () => {
			start = null;
			done();
			if (rect.w < 4 || rect.h < 4) return;
			const out = document.createElement("canvas");
			out.width = Math.round(rect.w * scaleX);
			out.height = Math.round(rect.h * scaleY);
			out
				.getContext("2d")!
				.drawImage(
					full,
					rect.x * scaleX,
					rect.y * scaleY,
					out.width,
					out.height,
					0,
					0,
					out.width,
					out.height,
				);
			this.#flash();
			await this.#save(out);
		});
	}

	/* ---- recording ----------------------------------------------------- */

	static get recording(): boolean {
		return !!this.#recorder;
	}

	/** When the current recording began (epoch ms), for the island's clock. */
	static get recordingStart(): number {
		return this.#recorder ? this.#recStart : 0;
	}

	static async toggleRecording() {
		if (this.#recorder) return this.stopRecording();
		if (!this.supported || typeof MediaRecorder === "undefined")
			return this.#unsupported();
		let stream: MediaStream;
		try {
			stream = await this.#stream();
		} catch (e) {
			if ((e as Error)?.name !== "NotAllowedError")
				console.warn("[recording]", e);
			return;
		}
		const type = [
			"video/webm;codecs=vp9",
			"video/webm;codecs=vp8",
			"video/webm",
		].find((t) => MediaRecorder.isTypeSupported(t));
		const rec = new MediaRecorder(
			stream,
			type ? { mimeType: type } : undefined,
		);
		const chunks: Blob[] = [];
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rec.onstop = async () => {
			stream.getTracks().forEach((t) => t.stop());
			this.#recorder = null;
			clearInterval(this.#recTimer);
			this.#indicator?.remove();
			this.#indicator = null;
			(globalThis as any).AetherIsland?.refresh();
			const blob = new Blob(chunks, { type: "video/webm" });
			const path = await this.#write(
				this.MOVIES,
				`Screen Recording ${this.#stamp()}.webm`,
				blob,
			);
			anura.notifications.add({
				title: "Screen recording saved",
				description: path,
				timeout: 6000,
			});
		};
		// Stopping from the browser's own "Stop sharing" bar ends it too.
		stream
			.getVideoTracks()[0]
			?.addEventListener("ended", () => this.stopRecording());
		rec.start(1000);
		this.#recorder = rec;
		this.#recStart = Date.now();
		this.#showIndicator();
		(globalThis as any).AetherIsland?.refresh();
		(globalThis as any).aetherSound?.play?.("toggleOn");
	}

	static stopRecording() {
		if (this.#recorder && this.#recorder.state !== "inactive")
			this.#recorder.stop();
		(globalThis as any).aetherSound?.play?.("toggleOff");
	}

	static #showIndicator() {
		const host = document.getElementById("menubar-right");
		const el = document.createElement("div");
		el.className = "menubar-item rec-indicator";
		el.title = "Stop recording";
		el.innerHTML =
			'<span class="rec-dot"></span><span class="rec-time">0:00</span>';
		el.addEventListener("click", () => this.stopRecording());
		host?.prepend(el);
		this.#indicator = el;
		const time = el.querySelector(".rec-time")!;
		this.#recTimer = window.setInterval(() => {
			const s = Math.floor((Date.now() - this.#recStart) / 1000);
			time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
		}, 1000);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherScreenshot = AetherScreenshot;
