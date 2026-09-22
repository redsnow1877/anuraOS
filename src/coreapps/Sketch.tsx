/**
 * Sketch — a small painting app.
 *
 * Strokes are kept as vector data (points, colour, width, tool) and replayed
 * onto the canvas, rather than snapshotting pixels for undo. A pixel snapshot
 * of a window-sized canvas at 2× density is ~6MB per undo step; a stroke is a
 * few kilobytes. Replaying also means a resized window re-renders crisply
 * instead of stretching a bitmap.
 *
 * Pen pressure (where the hardware reports it) varies the line width, and
 * coalesced pointer events are used so fast strokes stay smooth.
 */

interface SketchStroke {
	/** "clear" is an operation, not a line: undoing it brings the drawing back. */
	tool: "brush" | "marker" | "eraser" | "clear";
	color: string;
	size: number;
	/** x, y, pressure triples, in CSS pixels. */
	points: number[];
}

class SketchApp extends App {
	name = "Sketch";
	package = "anura.sketch";
	icon = "/assets/icons/sketch.svg";

	static readonly PALETTE = [
		"#1d1d24",
		"#ffffff",
		"#ff5f57",
		"#ffb454",
		"#ffd60a",
		"#34c759",
		"#40c8e0",
		"#6a5cf0",
		"#ff6fb5",
		"#a2845e",
	];

	css = css`
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--theme-bg);
		color: var(--ink);
		user-select: none;

		.sk-bar {
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 8px 12px;
			flex-shrink: 0;
			border-bottom: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
			flex-wrap: wrap;
		}

		.sk-group {
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.sk-tool {
			width: 32px;
			height: 30px;
			border-radius: 8px;
			border: none;
			background: transparent;
			color: var(--ink-dim);
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 0;
		}

		.sk-tool:hover {
			background: rgba(255, 255, 255, 0.08);
			color: var(--ink);
		}

		.sk-tool.is-on {
			background: color-mix(in srgb, var(--theme-accent) 75%, transparent);
			color: #fff;
		}

		.sk-tool:disabled {
			opacity: 0.35;
			cursor: default;
			background: transparent;
		}

		.sk-swatch {
			width: 20px;
			height: 20px;
			border-radius: 50%;
			border: none;
			cursor: pointer;
			padding: 0;
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
			transition: transform 0.12s var(--ease-out);
		}

		.sk-swatch.is-on {
			transform: scale(1.18);
			box-shadow:
				0 0 0 2px var(--theme-bg),
				0 0 0 4px var(--theme-accent);
		}

		.sk-custom {
			width: 22px;
			height: 22px;
			border: none;
			padding: 0;
			background: none;
			cursor: pointer;
		}

		.sk-size {
			width: 110px;
		}

		.sk-size-dot {
			width: 22px;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.sk-size-dot span {
			display: block;
			border-radius: 50%;
			background: var(--ink);
		}

		.sk-sep {
			width: 1px;
			height: 22px;
			background: var(--hairline, rgba(255, 255, 255, 0.1));
		}

		.sk-stage {
			flex: 1;
			min-height: 0;
			position: relative;
			overflow: hidden;
		}

		.sk-stage canvas {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			touch-action: none;
			cursor: crosshair;
		}
	`;

	async open(): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "Sketch",
			width: "860px",
			height: "580px",
		});
		const root = document.createElement("div");
		root.className = this.css;
		win.content.appendChild(root);

		const strokes: SketchStroke[] = [];
		const redo: SketchStroke[] = [];
		let tool: Exclude<SketchStroke["tool"], "clear"> = "brush";
		let color = SketchApp.PALETTE[7]!;
		let size = 6;
		let paper = "#fbfaf7";

		const bar = document.createElement("div");
		bar.className = "sk-bar";
		const stage = document.createElement("div");
		stage.className = "sk-stage";
		const canvas = document.createElement("canvas");
		stage.appendChild(canvas);
		root.append(bar, stage);
		const ctx = canvas.getContext("2d")!;

		const btn = (icon: string, title: string, cls = "sk-tool") => {
			const b = document.createElement("button");
			b.className = cls;
			b.title = title;
			b.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
			return b;
		};

		/* tools */
		const tools = document.createElement("div");
		tools.className = "sk-group";
		const toolButtons: Record<string, HTMLButtonElement> = {};
		for (const [id, icon, title] of [
			["brush", "brush", "Brush (B)"],
			["marker", "ink_highlighter", "Marker (M)"],
			["eraser", "ink_eraser", "Eraser (E)"],
		] as const) {
			const b = btn(icon, title);
			b.addEventListener("click", () => setTool(id));
			tools.appendChild(b);
			toolButtons[id] = b;
		}
		const setTool = (t: Exclude<SketchStroke["tool"], "clear">) => {
			tool = t;
			for (const [id, b] of Object.entries(toolButtons))
				b.classList.toggle("is-on", id === t);
		};

		/* colours */
		const colours = document.createElement("div");
		colours.className = "sk-group";
		const swatches: HTMLButtonElement[] = [];
		const setColor = (c: string) => {
			color = c;
			swatches.forEach((s) => s.classList.toggle("is-on", s.dataset.c === c));
			if (tool === "eraser") setTool("brush");
		};
		for (const c of SketchApp.PALETTE) {
			const s = document.createElement("button");
			s.className = "sk-swatch";
			s.style.background = c;
			s.dataset.c = c;
			s.title = c;
			s.addEventListener("click", () => setColor(c));
			swatches.push(s);
			colours.appendChild(s);
		}
		const custom = document.createElement("input");
		custom.type = "color";
		custom.className = "sk-custom";
		custom.title = "Custom colour";
		custom.value = color;
		custom.addEventListener("input", () => setColor(custom.value));
		colours.appendChild(custom);

		/* size */
		const sizeGroup = document.createElement("div");
		sizeGroup.className = "sk-group";
		const slider = document.createElement("input");
		slider.type = "range";
		slider.className = "aether-slider sk-size";
		slider.min = "1";
		slider.max = "48";
		slider.value = String(size);
		const dotWrap = document.createElement("div");
		dotWrap.className = "sk-size-dot";
		const dot = document.createElement("span");
		dotWrap.appendChild(dot);
		const paintSize = () => {
			const d = Math.max(2, Math.min(22, size));
			dot.style.width = dot.style.height = d + "px";
			slider.style.setProperty("--v", ((size - 1) / 47) * 100 + "%");
		};
		slider.addEventListener("input", () => {
			size = Number(slider.value);
			paintSize();
		});
		sizeGroup.append(dotWrap, slider);

		/* actions */
		const actions = document.createElement("div");
		actions.className = "sk-group";
		actions.style.marginLeft = "auto";
		const undoBtn = btn("undo", "Undo (Ctrl+Z)");
		const redoBtn = btn("redo", "Redo (Ctrl+Shift+Z)");
		const paperBtn = btn("contrast", "Toggle paper");
		const clearBtn = btn("delete_sweep", "Clear");
		const saveBtn = btn("save", "Save as PNG (Ctrl+S)");
		actions.append(undoBtn, redoBtn, paperBtn, clearBtn, saveBtn);

		const sep = () => {
			const s = document.createElement("div");
			s.className = "sk-sep";
			return s;
		};
		bar.append(tools, sep(), colours, sep(), sizeGroup, actions);

		/* rendering */
		let dpr = 1;
		const resize = () => {
			dpr = window.devicePixelRatio || 1;
			const r = stage.getBoundingClientRect();
			canvas.width = Math.max(1, Math.round(r.width * dpr));
			canvas.height = Math.max(1, Math.round(r.height * dpr));
			redraw();
		};

		const drawStroke = (s: SketchStroke) => {
			if (s.tool === "clear") {
				ctx.fillStyle = paper;
				ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
				return;
			}
			const p = s.points;
			if (p.length < 3) return;
			ctx.save();
			ctx.lineCap = s.tool === "marker" ? "square" : "round";
			ctx.lineJoin = "round";
			if (s.tool === "eraser") {
				ctx.strokeStyle = paper;
				ctx.fillStyle = paper;
			} else {
				ctx.strokeStyle = s.color;
				ctx.fillStyle = s.color;
			}
			ctx.globalAlpha = s.tool === "marker" ? 0.35 : 1;
			const width = (i: number) =>
				s.tool === "marker"
					? s.size * 2.2
					: s.size * (0.35 + 0.65 * (p[i + 2] ?? 1));
			if (p.length === 3) {
				ctx.beginPath();
				ctx.arc(p[0]!, p[1]!, width(0) / 2, 0, Math.PI * 2);
				ctx.fill();
			} else if (s.tool === "marker") {
				// One path so overlapping segments don't stack their alpha.
				ctx.lineWidth = width(0);
				ctx.beginPath();
				ctx.moveTo(p[0]!, p[1]!);
				for (let i = 3; i < p.length - 3; i += 3) {
					const mx = (p[i]! + p[i + 3]!) / 2;
					const my = (p[i + 1]! + p[i + 4]!) / 2;
					ctx.quadraticCurveTo(p[i]!, p[i + 1]!, mx, my);
				}
				ctx.lineTo(p[p.length - 3]!, p[p.length - 2]!);
				ctx.stroke();
			} else {
				// Per-segment so pressure can vary the width along the line;
				// curves pass through segment midpoints for smoothness.
				let px = p[0]!;
				let py = p[1]!;
				for (let i = 3; i < p.length; i += 3) {
					const nx = i + 3 < p.length ? (p[i]! + p[i + 3]!) / 2 : p[i]!;
					const ny = i + 3 < p.length ? (p[i + 1]! + p[i + 4]!) / 2 : p[i + 1]!;
					ctx.lineWidth = width(i);
					ctx.beginPath();
					ctx.moveTo(px, py);
					ctx.quadraticCurveTo(p[i]!, p[i + 1]!, nx, ny);
					ctx.stroke();
					px = nx;
					py = ny;
				}
			}
			ctx.restore();
		};

		const redraw = () => {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.fillStyle = paper;
			ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
			for (const s of strokes) drawStroke(s);
			if (live) drawStroke(live);
			undoBtn.disabled = !strokes.length;
			redoBtn.disabled = !redo.length;
		};

		/* input */
		let live: SketchStroke | null = null;
		let pending = false;
		const point = (e: PointerEvent) => {
			const r = canvas.getBoundingClientRect();
			const pressure =
				e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1;
			return [e.clientX - r.left, e.clientY - r.top, pressure];
		};
		canvas.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			canvas.setPointerCapture(e.pointerId);
			live = { tool, color, size, points: point(e) };
			redo.length = 0;
			redraw();
		});
		canvas.addEventListener("pointermove", (e) => {
			if (!live) return;
			const events = (e as any).getCoalescedEvents?.() || [e];
			for (const ev of events) live.points.push(...point(ev));
			// Draw at most once per frame, however fast the input arrives.
			if (!pending) {
				pending = true;
				requestAnimationFrame(() => {
					pending = false;
					redraw();
				});
			}
		});
		const finish = () => {
			if (!live) return;
			strokes.push(live);
			live = null;
			redraw();
		};
		canvas.addEventListener("pointerup", finish);
		canvas.addEventListener("pointercancel", finish);

		const undo = () => {
			const s = strokes.pop();
			if (s) redo.push(s);
			redraw();
		};
		const redoOne = () => {
			const s = redo.pop();
			if (s) strokes.push(s);
			redraw();
		};
		const save = async () => {
			const blob: Blob | null = await new Promise((r) =>
				canvas.toBlob(r, "image/png"),
			);
			if (!blob) return;
			const dir = "/Documents/Pictures";
			try {
				await new anura.fs.Shell().promises.mkdirp(dir);
			} catch {
				/* exists */
			}
			const stamp = new Date()
				.toISOString()
				.slice(0, 19)
				.replace("T", " ")
				.replace(/:/g, ".");
			const path = `${dir}/Sketch ${stamp}.png`;
			await anura.fs.promises.writeFile(
				path,
				new Uint8Array(await blob.arrayBuffer()) as any,
			);
			anura.notifications.add({
				title: "Sketch saved",
				description: path,
				timeout: 5000,
			});
		};

		undoBtn.addEventListener("click", undo);
		redoBtn.addEventListener("click", redoOne);
		clearBtn.addEventListener("click", () => {
			if (!strokes.length || strokes[strokes.length - 1]!.tool === "clear")
				return;
			strokes.push({ tool: "clear", color: "", size: 0, points: [] });
			redo.length = 0;
			redraw();
		});
		paperBtn.addEventListener("click", () => {
			paper = paper === "#fbfaf7" ? "#15151b" : "#fbfaf7";
			redraw();
		});
		saveBtn.addEventListener("click", save);

		root.tabIndex = -1;
		root.addEventListener("keydown", (e) => {
			const mod = e.ctrlKey || e.metaKey;
			if (mod && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redoOne();
				else undo();
			} else if (mod && e.key.toLowerCase() === "y") {
				e.preventDefault();
				redoOne();
			} else if (mod && e.key.toLowerCase() === "s") {
				e.preventDefault();
				save();
			} else if (!mod && e.key === "b") setTool("brush");
			else if (!mod && e.key === "m") setTool("marker");
			else if (!mod && e.key === "e") setTool("eraser");
			else if (!mod && (e.key === "[" || e.key === "]")) {
				size = Math.max(1, Math.min(48, size + (e.key === "]" ? 2 : -2)));
				slider.value = String(size);
				paintSize();
			}
		});

		const ro = new ResizeObserver(() => resize());
		ro.observe(stage);
		win.addEventListener("close", () => ro.disconnect());
		setTool("brush");
		setColor(color);
		paintSize();
		setTimeout(() => root.focus(), 50);
		return win;
	}
}
