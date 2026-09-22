/**
 * Photos — a gallery for /Documents/Pictures.
 *
 * Images are loaded through the service worker's /fs/ route, so a thumbnail
 * is just a lazily-loaded <img>: no blob URLs to create and revoke, and the
 * browser handles decoding and caching. Import brings photos in from the real
 * computer; Export hands one back out.
 */

class PhotosApp extends App {
	name = "Photos";
	package = "anura.photos";
	icon = "/assets/icons/photos.svg";

	static readonly DIR = "/Documents/Pictures";
	static readonly EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

	/** Filesystem path → URL served by the /fs/ route. */
	static url(path: string): string {
		// Built by concatenation, not a template: the Pages base-path rewriter
		// only recognises a quoted "/fs" literal.
		return "/fs" + path.split("/").map(encodeURIComponent).join("/");
	}

	css = css`
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--theme-bg);
		color: var(--ink);
		user-select: none;

		.ph-bar {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 10px 14px;
			flex-shrink: 0;
			border-bottom: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		}

		.ph-title {
			font-size: 15px;
			font-weight: 600;
			margin-right: auto;
		}

		.ph-count {
			font-size: 12px;
			color: var(--ink-faint);
			margin-left: 8px;
			font-weight: 400;
		}

		.ph-btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			border: none;
			border-radius: 8px;
			padding: 6px 11px;
			font-family: inherit;
			font-size: 12.5px;
			color: var(--ink);
			background: rgba(255, 255, 255, 0.08);
			cursor: pointer;
		}

		.ph-btn:hover {
			background: rgba(255, 255, 255, 0.14);
		}

		.ph-btn .material-symbols-outlined {
			font-size: 17px;
		}

		.ph-btn.danger:hover {
			background: rgba(255, 69, 58, 0.3);
		}

		.ph-grid {
			flex: 1;
			overflow-y: auto;
			padding: 14px;
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			grid-auto-rows: 120px;
			gap: 8px;
			align-content: start;
		}

		.ph-cell {
			position: relative;
			border-radius: 10px;
			overflow: hidden;
			background: rgba(255, 255, 255, 0.05);
			cursor: pointer;
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
			transition: transform 0.15s var(--ease-out);
		}

		.ph-cell:hover {
			transform: scale(1.03);
		}

		.ph-cell img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}

		.ph-cell span {
			position: absolute;
			left: 0;
			right: 0;
			bottom: 0;
			padding: 14px 8px 5px;
			font-size: 11px;
			color: #fff;
			background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			opacity: 0;
			transition: opacity 0.15s;
		}

		.ph-cell:hover span {
			opacity: 1;
		}

		.ph-empty {
			grid-column: 1 / -1;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 8px;
			padding: 70px 20px;
			color: var(--ink-faint);
			font-size: 13px;
			text-align: center;
		}

		.ph-empty .material-symbols-outlined {
			font-size: 48px;
			opacity: 0.5;
		}

		.ph-viewer {
			flex: 1;
			min-height: 0;
			position: relative;
			overflow: hidden;
			background: #09090c;
			cursor: grab;
		}

		.ph-viewer.is-panning {
			cursor: grabbing;
		}

		.ph-viewer img {
			position: absolute;
			left: 50%;
			top: 50%;
			max-width: 100%;
			max-height: 100%;
			transform: translate(-50%, -50%) translate(var(--px, 0px), var(--py, 0px))
				scale(var(--z, 1));
			transition: transform 0.18s var(--ease-out);
			user-select: none;
			-webkit-user-drag: none;
		}

		.ph-viewer.is-panning img {
			transition: none;
		}

		.ph-nav {
			position: absolute;
			top: 50%;
			transform: translateY(-50%);
			width: 38px;
			height: 38px;
			border-radius: 50%;
			border: none;
			background: rgba(20, 20, 26, 0.6);
			color: #fff;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			backdrop-filter: blur(10px);
			-webkit-backdrop-filter: blur(10px);
			opacity: 0;
			transition: opacity 0.15s;
			z-index: 2;
		}

		.ph-viewer:hover .ph-nav {
			opacity: 1;
		}

		.ph-nav.prev {
			left: 12px;
		}

		.ph-nav.next {
			right: 12px;
		}
	`;

	async #list(): Promise<{ path: string; name: string; modified: number }[]> {
		const fs = anura.fs.promises;
		try {
			await new anura.fs.Shell().promises.mkdirp(PhotosApp.DIR);
		} catch {
			/* exists */
		}
		let names: string[] = [];
		try {
			names = await fs.readdir(PhotosApp.DIR);
		} catch {
			return [];
		}
		const out = [];
		for (const name of names) {
			if (!PhotosApp.EXT.test(name)) continue;
			const path = PhotosApp.DIR + "/" + name;
			try {
				const st: any = await fs.stat(path);
				out.push({ path, name, modified: st.mtimeMs ?? +new Date(st.mtime) });
			} catch {
				/* skip */
			}
		}
		return out.sort((a, b) => b.modified - a.modified);
	}

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "Photos",
			width: "820px",
			height: "560px",
		});
		const root = document.createElement("div");
		root.className = this.css;
		root.tabIndex = -1;
		win.content.appendChild(root);

		let photos = await this.#list();
		let index = -1;

		const bar = document.createElement("div");
		bar.className = "ph-bar";
		const body = document.createElement("div");
		body.style.cssText =
			"flex:1;min-height:0;display:flex;flex-direction:column;";
		root.append(bar, body);

		const button = (icon: string, label: string, cls = "ph-btn") => {
			const b = document.createElement("button");
			b.className = cls;
			b.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
			if (label) b.append(label);
			return b;
		};

		const importer = document.createElement("input");
		importer.type = "file";
		importer.accept = "image/*";
		importer.multiple = true;
		importer.style.display = "none";
		importer.addEventListener("change", async () => {
			for (const file of Array.from(importer.files || [])) {
				await anura.fs.promises.writeFile(
					PhotosApp.DIR + "/" + file.name.replace(/[\\/]/g, "_"),
					new Uint8Array(await file.arrayBuffer()) as any,
				);
			}
			importer.value = "";
			photos = await this.#list();
			showGrid();
		});
		root.appendChild(importer);

		const showGrid = () => {
			index = -1;
			win.title = "Photos";
			bar.textContent = "";
			const title = document.createElement("div");
			title.className = "ph-title";
			title.textContent = "Pictures";
			const count = document.createElement("span");
			count.className = "ph-count";
			count.textContent =
				photos.length + (photos.length === 1 ? " item" : " items");
			title.appendChild(count);
			const imp = button("add_photo_alternate", "Import");
			imp.addEventListener("click", () => importer.click());
			bar.append(title, imp);

			body.textContent = "";
			const grid = document.createElement("div");
			grid.className = "ph-grid";
			if (!photos.length) {
				const empty = document.createElement("div");
				empty.className = "ph-empty";
				empty.innerHTML =
					'<span class="material-symbols-outlined">photo_library</span><span>No pictures yet.</span><span>Screenshots (Ctrl+Shift+3) and sketches saved from Sketch appear here, or import some.</span>';
				grid.appendChild(empty);
			}
			photos.forEach((ph, i) => {
				const cell = document.createElement("div");
				cell.className = "ph-cell";
				const img = document.createElement("img");
				img.loading = "lazy";
				img.decoding = "async";
				img.src = PhotosApp.url(ph.path);
				img.alt = ph.name;
				const cap = document.createElement("span");
				cap.textContent = ph.name;
				cell.append(img, cap);
				cell.addEventListener("click", () => showPhoto(i));
				grid.appendChild(cell);
			});
			body.appendChild(grid);
		};

		const showPhoto = (i: number) => {
			if (!photos.length) return showGrid();
			index = (i + photos.length) % photos.length;
			const ph = photos[index]!;
			win.title = ph.name + " — Photos";

			bar.textContent = "";
			const back = button("grid_view", "All Photos");
			back.addEventListener("click", showGrid);
			const title = document.createElement("div");
			title.className = "ph-title";
			title.style.marginLeft = "8px";
			title.style.fontSize = "13px";
			title.textContent = ph.name;
			const wall = button("wallpaper", "Set as Wallpaper");
			wall.addEventListener("click", () => {
				const url = PhotosApp.url(ph.path);
				anura.settings.set("wallpaper", url);
				anura.settings.set("wallpaper-name", ph.name);
				document.body.style.background = `url("${url}") no-repeat center center fixed`;
				document.body.style.backgroundSize =
					anura.settings.get("wallpaper-fit") || "cover";
				anura.notifications.add({
					title: "Wallpaper set",
					description: ph.name,
					timeout: 3000,
				});
			});
			const exp = button("download", "Export");
			exp.addEventListener("click", async () => {
				const data = await anura.fs.promises.readFile(ph.path);
				const a = document.createElement("a");
				a.href = URL.createObjectURL(new Blob([data as any]));
				a.download = ph.name;
				a.click();
				setTimeout(() => URL.revokeObjectURL(a.href), 1000);
			});
			const del = button("delete", "", "ph-btn danger");
			del.title = "Delete";
			del.addEventListener("click", async () => {
				try {
					await anura.fs.promises.unlink(ph.path);
				} catch {
					/* already gone */
				}
				photos = await this.#list();
				if (photos.length) showPhoto(Math.min(index, photos.length - 1));
				else showGrid();
			});
			bar.append(back, title, wall, exp, del);

			body.textContent = "";
			const viewer = document.createElement("div");
			viewer.className = "ph-viewer";
			const img = document.createElement("img");
			img.src = PhotosApp.url(ph.path);
			img.alt = ph.name;
			const prev = button("chevron_left", "", "ph-nav prev");
			const next = button("chevron_right", "", "ph-nav next");
			prev.addEventListener("click", () => showPhoto(index - 1));
			next.addEventListener("click", () => showPhoto(index + 1));
			viewer.append(img, prev, next);
			body.appendChild(viewer);

			// Zoom around the pointer with the wheel; double-click toggles 2x;
			// drag to pan while zoomed.
			let z = 1;
			let px = 0;
			let py = 0;
			const apply = () => {
				img.style.setProperty("--z", String(z));
				img.style.setProperty("--px", px + "px");
				img.style.setProperty("--py", py + "px");
			};
			viewer.addEventListener(
				"wheel",
				(e) => {
					e.preventDefault();
					const factor = Math.exp(-e.deltaY * 0.0015);
					const nz = Math.max(1, Math.min(8, z * factor));
					const r = viewer.getBoundingClientRect();
					const cx = e.clientX - r.left - r.width / 2;
					const cy = e.clientY - r.top - r.height / 2;
					// Keep the point under the cursor fixed while scaling.
					px = cx - ((cx - px) * nz) / z;
					py = cy - ((cy - py) * nz) / z;
					z = nz;
					if (z === 1) px = py = 0;
					apply();
				},
				{ passive: false },
			);
			viewer.addEventListener("dblclick", () => {
				z = z > 1 ? 1 : 2;
				if (z === 1) px = py = 0;
				apply();
			});
			let drag: [number, number, number, number] | null = null;
			viewer.addEventListener("pointerdown", (e) => {
				if (z === 1 || (e.target as Element).closest(".ph-nav")) return;
				drag = [e.clientX, e.clientY, px, py];
				viewer.setPointerCapture(e.pointerId);
				viewer.classList.add("is-panning");
			});
			viewer.addEventListener("pointermove", (e) => {
				if (!drag) return;
				px = drag[2] + e.clientX - drag[0];
				py = drag[3] + e.clientY - drag[1];
				apply();
			});
			viewer.addEventListener("pointerup", () => {
				drag = null;
				viewer.classList.remove("is-panning");
			});
		};

		root.addEventListener("keydown", (e) => {
			if (index < 0) return;
			if (e.key === "ArrowLeft") showPhoto(index - 1);
			else if (e.key === "ArrowRight") showPhoto(index + 1);
			else if (e.key === "Escape") showGrid();
		});

		const target = args[0] ? photos.findIndex((p) => p.path === args[0]) : -1;
		if (target >= 0) showPhoto(target);
		else showGrid();
		setTimeout(() => root.focus(), 50);
		return win;
	}
}
