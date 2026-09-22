/**
 * 2048.
 *
 * Tiles are persistent elements positioned by transform, so a move is a real
 * slide rather than a redraw: each tile keeps its identity across the move,
 * merging tiles slide into the same cell and are replaced by a doubled tile
 * that "bumps", and new tiles scale in. Arrow keys / WASD, or swipe.
 */

interface Tile2048 {
	id: number;
	value: number;
	r: number;
	c: number;
	el?: HTMLElement;
}

class Game2048App extends App {
	name = "2048";
	package = "anura.2048";
	icon = "/assets/icons/2048.svg";

	static readonly BEST_KEY = "aether.2048.best";
	static readonly SIZE = 4;

	css = css`
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		background: radial-gradient(
			120% 90% at 50% 0%,
			#2a2446,
			var(--theme-bg) 70%
		);
		color: var(--ink);
		user-select: none;
		outline: none;
		--cell: 76px;
		--gap: 10px;

		.g-head {
			width: calc(var(--cell) * 4 + var(--gap) * 5);
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 18px 0 14px;
		}

		.g-title {
			font-size: 34px;
			font-weight: 800;
			letter-spacing: -0.03em;
			margin-right: auto;
			background: linear-gradient(90deg, #b3a6ff, #ff9ec4);
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}

		.g-score {
			min-width: 64px;
			padding: 5px 10px;
			border-radius: 10px;
			background: rgba(255, 255, 255, 0.07);
			text-align: center;
			position: relative;
		}

		.g-score small {
			display: block;
			font-size: 10px;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--ink-faint);
		}

		.g-score b {
			font-size: 17px;
			font-variant-numeric: tabular-nums;
		}

		.g-plus {
			position: absolute;
			left: 50%;
			top: 4px;
			transform: translateX(-50%);
			font-weight: 700;
			font-size: 14px;
			color: #b3a6ff;
			animation: g-plus 0.7s var(--ease-out) forwards;
			pointer-events: none;
		}

		@keyframes g-plus {
			to {
				transform: translate(-50%, -26px);
				opacity: 0;
			}
		}

		.g-new {
			border: none;
			border-radius: 10px;
			padding: 10px 12px;
			font-family: inherit;
			font-weight: 600;
			color: #fff;
			background: var(--theme-accent);
			cursor: pointer;
		}

		.g-board {
			position: relative;
			width: calc(var(--cell) * 4 + var(--gap) * 5);
			height: calc(var(--cell) * 4 + var(--gap) * 5);
			border-radius: 16px;
			background: rgba(255, 255, 255, 0.06);
			box-shadow:
				inset 0 0 0 1px rgba(255, 255, 255, 0.08),
				0 20px 50px -20px rgba(0, 0, 0, 0.6);
			touch-action: none;
		}

		.g-cell {
			position: absolute;
			width: var(--cell);
			height: var(--cell);
			border-radius: 10px;
			background: rgba(255, 255, 255, 0.05);
		}

		.g-tile {
			position: absolute;
			left: 0;
			top: 0;
			width: var(--cell);
			height: var(--cell);
			transition: transform 0.11s ease-in-out;
			z-index: 1;
		}

		.g-tile-inner {
			width: 100%;
			height: 100%;
			border-radius: 10px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 800;
			font-size: 30px;
			letter-spacing: -0.02em;
			color: #fff;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
		}

		.g-tile.new .g-tile-inner {
			animation: g-appear 0.18s var(--ease-out) 0.08s backwards;
		}

		.g-tile.merged {
			z-index: 2;
		}

		.g-tile.merged .g-tile-inner {
			animation: g-bump 0.2s var(--ease-overshoot, ease-out) 0.08s backwards;
		}

		@keyframes g-appear {
			from {
				transform: scale(0);
				opacity: 0;
			}
		}

		@keyframes g-bump {
			0% {
				transform: scale(0.6);
			}
			60% {
				transform: scale(1.14);
			}
			100% {
				transform: scale(1);
			}
		}

		.g-hint {
			font-size: 12px;
			color: var(--ink-faint);
			padding: 14px 0;
		}

		.g-over {
			position: absolute;
			inset: 0;
			z-index: 5;
			border-radius: 16px;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 14px;
			background: rgba(16, 14, 28, 0.62);
			backdrop-filter: blur(6px);
			-webkit-backdrop-filter: blur(6px);
			animation: g-fade 0.4s var(--ease-out);
		}

		.g-over h2 {
			margin: 0;
			font-size: 32px;
			font-weight: 800;
		}

		@keyframes g-fade {
			from {
				opacity: 0;
			}
		}
	`;

	/** Tile colours, climbing from muted violet to hot gold. */
	static colour(v: number): string {
		const map: Record<number, string> = {
			2: "linear-gradient(145deg,#4a4270,#3b3558)",
			4: "linear-gradient(145deg,#5a4f8f,#463e72)",
			8: "linear-gradient(145deg,#8f7cff,#6a5cf0)",
			16: "linear-gradient(145deg,#b07cff,#8a4cf0)",
			32: "linear-gradient(145deg,#ff7cd4,#e0559a)",
			64: "linear-gradient(145deg,#ff6f91,#e0435f)",
			128: "linear-gradient(145deg,#ff9d5c,#f0703a)",
			256: "linear-gradient(145deg,#ffb454,#f09426)",
			512: "linear-gradient(145deg,#ffd166,#f0b429)",
			1024: "linear-gradient(145deg,#58e1c1,#20b597)",
			2048: "linear-gradient(145deg,#ffe57a,#ffb800)",
		};
		return map[v] || "linear-gradient(145deg,#2de2e6,#0a84ff)";
	}

	async open(): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "2048",
			width: "420px",
			height: "580px",
		});
		const root = document.createElement("div");
		root.className = this.css;
		root.tabIndex = -1;
		win.content.appendChild(root);

		const N = Game2048App.SIZE;
		let tiles: Tile2048[] = [];
		let nextId = 1;
		let score = 0;
		let won = false;
		let keepGoing = false;
		let busy = false;
		let best = Number(anura.settings.get(Game2048App.BEST_KEY)) || 0;

		const head = document.createElement("div");
		head.className = "g-head";
		const title = document.createElement("div");
		title.className = "g-title";
		title.textContent = "2048";
		const scoreBox = document.createElement("div");
		scoreBox.className = "g-score";
		scoreBox.innerHTML = "<small>Score</small><b>0</b>";
		const bestBox = document.createElement("div");
		bestBox.className = "g-score";
		bestBox.innerHTML = `<small>Best</small><b>${best}</b>`;
		const newBtn = document.createElement("button");
		newBtn.className = "g-new";
		newBtn.textContent = "New";
		head.append(title, scoreBox, bestBox, newBtn);

		const board = document.createElement("div");
		board.className = "g-board";
		const hint = document.createElement("div");
		hint.className = "g-hint";
		hint.textContent = "Arrow keys, WASD, or swipe";
		root.append(head, board, hint);

		const pos = (i: number) =>
			`calc(var(--gap) + ${i} * (var(--cell) + var(--gap)))`;
		for (let r = 0; r < N; r++)
			for (let c = 0; c < N; c++) {
				const cell = document.createElement("div");
				cell.className = "g-cell";
				cell.style.left = pos(c);
				cell.style.top = pos(r);
				board.appendChild(cell);
			}

		const place = (t: Tile2048) => {
			t.el!.style.transform = `translate(${pos(t.c)}, ${pos(t.r)})`;
		};

		const makeTile = (
			value: number,
			r: number,
			c: number,
			kind: "new" | "merged",
		) => {
			const t: Tile2048 = { id: nextId++, value, r, c };
			const el = document.createElement("div");
			el.className = "g-tile " + kind;
			const inner = document.createElement("div");
			inner.className = "g-tile-inner";
			inner.textContent = String(value);
			inner.style.background = Game2048App.colour(value);
			if (value >= 1024) inner.style.fontSize = "24px";
			if (value >= 2048)
				inner.style.boxShadow =
					"0 0 24px rgba(255,200,60,.55), inset 0 1px 0 rgba(255,255,255,.4)";
			el.appendChild(inner);
			t.el = el;
			place(t);
			board.appendChild(el);
			return t;
		};

		const at = (r: number, c: number) =>
			tiles.find((t) => t.r === r && t.c === c);

		const spawn = () => {
			const free: [number, number][] = [];
			for (let r = 0; r < N; r++)
				for (let c = 0; c < N; c++) if (!at(r, c)) free.push([r, c]);
			if (!free.length) return;
			const [r, c] = free[Math.floor(Math.random() * free.length)]!;
			tiles.push(makeTile(Math.random() < 0.9 ? 2 : 4, r, c, "new"));
		};

		const setScore = (add: number) => {
			score += add;
			scoreBox.querySelector("b")!.textContent = String(score);
			if (add) {
				const plus = document.createElement("div");
				plus.className = "g-plus";
				plus.textContent = "+" + add;
				scoreBox.appendChild(plus);
				setTimeout(() => plus.remove(), 700);
			}
			if (score > best) {
				best = score;
				bestBox.querySelector("b")!.textContent = String(best);
				anura.settings.set(Game2048App.BEST_KEY, best);
			}
		};

		const canMove = () => {
			if (tiles.length < N * N) return true;
			for (const t of tiles) {
				const right = at(t.r, t.c + 1);
				const down = at(t.r + 1, t.c);
				if (
					(right && right.value === t.value) ||
					(down && down.value === t.value)
				)
					return true;
			}
			return false;
		};

		const overlay = (
			heading: string,
			button: string,
			onClick: () => void,
			extra?: [string, () => void],
		) => {
			const o = document.createElement("div");
			o.className = "g-over";
			const h = document.createElement("h2");
			h.textContent = heading;
			const b = document.createElement("button");
			b.className = "g-new";
			b.textContent = button;
			b.addEventListener("click", () => {
				o.remove();
				onClick();
				root.focus();
			});
			o.append(h, b);
			if (extra) {
				const x = document.createElement("button");
				x.className = "g-new";
				x.style.background = "rgba(255,255,255,.14)";
				x.textContent = extra[0];
				x.addEventListener("click", () => {
					o.remove();
					extra[1]();
					root.focus();
				});
				o.appendChild(x);
			}
			board.appendChild(o);
		};

		const move = (dr: number, dc: number) => {
			if (busy || board.querySelector(".g-over")) return;
			// Walk from the far edge back, so tiles slide as far as they can.
			const order: number[] = [...Array(N).keys()];
			const rows = dr > 0 ? order.slice().reverse() : order;
			const cols = dc > 0 ? order.slice().reverse() : order;
			const mergedInto = new Set<Tile2048>();
			const doomed: Tile2048[] = [];
			const born: [number, number, number][] = [];
			let moved = false;
			let gained = 0;
			for (const r of rows)
				for (const c of cols) {
					const t = at(r, c);
					if (!t || doomed.includes(t)) continue;
					let nr = r;
					let nc = c;
					while (true) {
						const rr = nr + dr;
						const cc = nc + dc;
						if (rr < 0 || rr >= N || cc < 0 || cc >= N) break;
						const other = at(rr, cc);
						if (!other) {
							nr = rr;
							nc = cc;
							continue;
						}
						if (
							other.value === t.value &&
							!mergedInto.has(other) &&
							!doomed.includes(other)
						) {
							// Both slide into this cell; a doubled tile replaces them.
							mergedInto.add(other);
							doomed.push(t, other);
							nr = rr;
							nc = cc;
							born.push([t.value * 2, rr, cc]);
							gained += t.value * 2;
						}
						break;
					}
					if (nr !== r || nc !== c) {
						moved = true;
						t.r = nr;
						t.c = nc;
						place(t);
					}
				}
			if (!moved) return;
			busy = true;
			(globalThis as any).aetherSound?.play?.("click");
			setTimeout(() => {
				for (const d of doomed) d.el!.remove();
				tiles = tiles.filter((t) => !doomed.includes(t));
				for (const [v, r, c] of born) {
					tiles.push(makeTile(v, r, c, "merged"));
					if (v === 2048 && !won && !keepGoing) won = true;
				}
				for (const t of tiles) t.el!.classList.remove("new");
				setScore(gained);
				spawn();
				busy = false;
				if (won && !keepGoing) {
					keepGoing = true;
					(globalThis as any).aetherSound?.play?.("notify");
					overlay("You win!", "Keep going", () => {}, ["New game", reset]);
				} else if (!canMove()) {
					(globalThis as any).aetherSound?.play?.("error");
					overlay("Game over", "Try again", reset);
				}
			}, 115);
		};

		const reset = () => {
			for (const t of tiles) t.el!.remove();
			board.querySelector(".g-over")?.remove();
			tiles = [];
			score = 0;
			won = false;
			keepGoing = false;
			setScore(0);
			spawn();
			spawn();
		};

		root.addEventListener("keydown", (e) => {
			const k = e.key.toLowerCase();
			const dirs: Record<string, [number, number]> = {
				arrowup: [-1, 0],
				w: [-1, 0],
				arrowdown: [1, 0],
				s: [1, 0],
				arrowleft: [0, -1],
				a: [0, -1],
				arrowright: [0, 1],
				d: [0, 1],
			};
			const d = dirs[k];
			if (d && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				move(d[0], d[1]);
			}
		});
		let start: [number, number] | null = null;
		board.addEventListener("pointerdown", (e) => {
			start = [e.clientX, e.clientY];
		});
		board.addEventListener("pointerup", (e) => {
			if (!start) return;
			const dx = e.clientX - start[0];
			const dy = e.clientY - start[1];
			start = null;
			if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
			if (Math.abs(dx) > Math.abs(dy)) move(0, Math.sign(dx));
			else move(Math.sign(dy), 0);
		});
		newBtn.addEventListener("click", () => {
			reset();
			root.focus();
		});

		reset();
		setTimeout(() => root.focus(), 50);
		return win;
	}
}
