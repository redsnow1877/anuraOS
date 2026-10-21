/**
 * Dimension — Linux image
 * ---------------------------------------------------------------------------
 * The x86 subsystem needs a ~1 GB Alpine Linux disk, far too big to host on
 * GitHub Pages. So on builds that don't carry it, Linux is a download: one
 * file (about 270 MB) from the repository's Releases, imported here.
 *
 * The file is a gzip'd tar of three entries, in this order:
 *
 *   bzimage      the kernel
 *   initrd.img   the initramfs
 *   rootfs.bin   the disk image
 *
 * It's unpacked as a stream (DecompressionStream, then a small tar reader), so
 * the 1 GB disk is never held in memory as one piece: it's gathered into a
 * Blob in 32 MB steps, which the browser keeps on disk.
 *
 * The download can't be fetched by the page: GitHub's release URLs send no
 * CORS headers, so a browser won't let a script read them. A normal link
 * download works, so the person downloads it and picks the file.
 */

class AetherLinux {
	static readonly RELEASE_URL =
		"https://github.com/redsnow1877/anuraOS/releases/download/linux-image-1/aether-linux-alpine.tar.gz";
	static readonly RELEASES_PAGE =
		"https://github.com/redsnow1877/anuraOS/releases/tag/linux-image-1";
	static readonly SIZE_LABEL = "about 270 MB";

	static readonly #NEEDED = ["bzimage", "initrd.img", "rootfs.bin"];

	/** Whether this build ships the Linux image itself (a full build does). */
	static async bundled(): Promise<boolean> {
		try {
			const image =
				anura.config.x86?.[anura.settings.get("x86-image") || "alpine"];
			if (!image) return false;
			const r = await fetch(image.bzimage, { method: "HEAD" });
			return r.ok;
		} catch {
			return false;
		}
	}

	/** Whether a kernel is already installed in the filesystem. */
	static async installed(): Promise<boolean> {
		try {
			await anura.fs.promises.stat("/boot/bzimage");
			return true;
		} catch {
			return false;
		}
	}

	/** Ask for the downloaded file. Resolves null if the dialog is dismissed. */
	static pickFile(): Promise<File | null> {
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".gz,.tgz,.tar.gz,application/gzip";
			input.style.display = "none";
			input.addEventListener("change", () => {
				resolve(input.files?.[0] || null);
				input.remove();
			});
			input.addEventListener("cancel", () => {
				resolve(null);
				input.remove();
			});
			document.body.appendChild(input);
			input.click();
		});
	}

	/**
	 * Unpack a downloaded image and install it. `say` gets progress text.
	 * Throws with a message fit to show if the file isn't a Linux image.
	 */
	static async importArchive(
		file: File,
		say: (text: string) => void = () => {},
	): Promise<void> {
		if (typeof DecompressionStream === "undefined")
			throw new Error(
				"This browser can't unpack the image. Try a recent Chrome, Edge, Firefox or Safari.",
			);

		const entries = await this.#readTar(file, say);
		for (const name of this.#NEEDED)
			if (!entries[name])
				throw new Error(
					"That file isn't a Dimension Linux image. Download it again from the link.",
				);

		say("Installing the kernel");
		await anura.fs.promises.mkdir("/boot").catch(() => {});
		await anura.fs.promises.writeFile(
			"/boot/bzimage",
			Filer.Buffer(await entries["bzimage"]!.arrayBuffer()),
		);
		await anura.fs.promises.writeFile(
			"/boot/initrd.img",
			Filer.Buffer(await entries["initrd.img"]!.arrayBuffer()),
		);

		say("Installing the disk. This is the slow part");
		//@ts-ignore - the hard disk exists whether or not the emulator does
		await anura.x86hdd.loadfile(entries["rootfs.bin"]!);

		await anura.settings.set("x86-image", "alpine");
		say("Installed");
	}

	/** Read the tar entries out of a gzip'd tar, as Blobs. */
	static async #readTar(
		file: File,
		say: (text: string) => void,
	): Promise<Record<string, Blob>> {
		let consumed = 0;
		const counter = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				consumed += chunk.length;
				controller.enqueue(chunk);
			},
		});
		const reader = file
			.stream()
			.pipeThrough(counter)
			.pipeThrough(
				new DecompressionStream("gzip") as unknown as ReadableWritablePair<
					Uint8Array,
					Uint8Array
				>,
			)
			.getReader();

		const out: Record<string, Blob> = {};
		const FLUSH = 32 * 1024 * 1024;
		let lastSaid = 0;
		const progress = (name: string) => {
			const now = performance.now();
			if (now - lastSaid < 250) return;
			lastSaid = now;
			const pct = Math.min(99, Math.floor((consumed / file.size) * 100));
			say(`Unpacking ${name}: ${pct}%`);
		};

		// The state machine reads headers (512 bytes), then an entry's data,
		// then the padding up to the next 512 boundary.
		const header = new Uint8Array(512);
		let headerFill = 0;
		let name = "";
		let remaining = 0;
		let pad = 0;
		let keep = false;
		let mode: "header" | "data" | "pad" = "header";
		let ended = false;
		let blob = new Blob();
		let parts: Uint8Array[] = [];
		let pending = 0;
		const flush = () => {
			if (!parts.length) return;
			blob = new Blob([blob, ...(parts as BlobPart[])]);
			parts = [];
			pending = 0;
		};

		const text = (from: number, to: number) => {
			let s = "";
			for (let i = from; i < to && header[i]; i++)
				s += String.fromCharCode(header[i]!);
			return s;
		};

		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			let chunk = value as Uint8Array;
			while (chunk.length && !ended) {
				if (mode === "header") {
					const take = Math.min(512 - headerFill, chunk.length);
					header.set(chunk.subarray(0, take), headerFill);
					headerFill += take;
					chunk = chunk.subarray(take);
					if (headerFill < 512) break;
					headerFill = 0;
					if (header.every((b) => b === 0)) {
						ended = true;
						break;
					}
					name = text(0, 100).replace(/^\.\//, "");
					const size = parseInt(text(124, 136).trim() || "0", 8);
					const type = String.fromCharCode(header[156] || 48);
					remaining = Number.isFinite(size) ? size : 0;
					pad = (512 - (remaining % 512)) % 512;
					keep = (type === "0" || type === "\0") && this.#NEEDED.includes(name);
					blob = new Blob();
					parts = [];
					pending = 0;
					mode = remaining ? "data" : "pad";
				} else if (mode === "data") {
					const take = Math.min(remaining, chunk.length);
					if (keep) {
						parts.push(chunk.subarray(0, take));
						pending += take;
						if (pending >= FLUSH) flush();
						progress(name);
					}
					remaining -= take;
					chunk = chunk.subarray(take);
					if (!remaining) {
						if (keep) {
							flush();
							out[name] = blob;
						}
						mode = "pad";
					}
				} else if (mode === "pad") {
					const take = Math.min(pad, chunk.length);
					pad -= take;
					chunk = chunk.subarray(take);
					if (!pad) mode = "header";
				}
			}
			if (ended) break;
		}
		await reader.cancel().catch(() => {});
		return out;
	}
}

(globalThis as any).AetherLinux = AetherLinux;
