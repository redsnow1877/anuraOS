/**
 * Aether — screen savers.
 * ---------------------------------------------------------------------------
 * Starts after a stretch of inactivity (Settings → Desktop), from a hot corner
 * or from Spotlight, and ends at the first key, click or nudge of the mouse.
 * It sits above the lock screen: if auto-lock kicked in underneath, waking
 * the screen reveals it, the way a Mac does.
 *
 *   Starfield  the warp-speed classic
 *   Aurora     northern lights over a mountain ridge
 *   Flurry     streams of coloured light
 *   Bounce     the clock, bouncing around like a certain DVD logo.
 *              It changes colour off every wall. Hitting a corner exactly
 *              is rare, and it is celebrated.
 *
 * Soft scenes draw into a small canvas and let the browser's upscaling do the
 * blurring for free; sharp ones draw at device resolution. The loop only runs
 * while a screen saver is showing.
 */

type AetherSaverMode = "starfield" | "aurora" | "flurry" | "bounce";

interface AetherSaverScene {
	/** Canvas pixels per CSS pixel. */
	scale: number;
	/** Drawn once, full resolution, under the animated layer. */
	backdrop?(g: CanvasRenderingContext2D, w: number, h: number): void;
	init(g: CanvasRenderingContext2D, w: number, h: number): void;
	frame(
		g: CanvasRenderingContext2D,
		w: number,
		h: number,
		t: number,
		dt: number,
	): void;
}

const aetherRand = (a: number, b: number) => a + Math.random() * (b - a);

/** A soft round glow, drawn once and stamped many times. */
function aetherGlowSprite(color: string, size = 32): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = c.height = size;
	const g = c.getContext("2d")!;
	const r = size / 2;
	const grad = g.createRadialGradient(r, r, 0, r, r, r);
	grad.addColorStop(0, color);
	grad.addColorStop(0.35, color.replace(/[\d.]+\)$/, "0.35)"));
	grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
	g.fillStyle = grad;
	g.fillRect(0, 0, size, size);
	return c;
}

const AETHER_SAVERS: Record<
	AetherSaverMode,
	{ name: string; make: () => AetherSaverScene }
> = {
	starfield: {
		name: "Starfield",
		make: () => {
			type Star = { x: number; y: number; z: number; px: number; py: number };
			let stars: Star[] = [];
			const reset = (s: Star, far: boolean) => {
				s.x = aetherRand(-1, 1);
				s.y = aetherRand(-1, 1);
				s.z = far ? aetherRand(0.85, 1) : aetherRand(0.05, 1);
				s.px = NaN;
				s.py = NaN;
			};
			return {
				scale: 1,
				init(g, w, h) {
					stars = Array.from({ length: 700 }, () => {
						const s = { x: 0, y: 0, z: 0, px: NaN, py: NaN };
						reset(s, false);
						return s;
					});
					g.fillStyle = "#000";
					g.fillRect(0, 0, w, h);
				},
				frame(g, w, h, _t, dt) {
					// Not a full clear: a little of the last frame stays, as streaks.
					g.fillStyle = "rgba(0, 0, 0, 0.4)";
					g.fillRect(0, 0, w, h);
					const cx = w / 2;
					const cy = h / 2;
					const f = Math.max(w, h) * 0.55;
					g.lineCap = "round";
					for (const s of stars) {
						s.z -= 0.3 * dt;
						if (s.z <= 0.02) {
							reset(s, true);
							continue;
						}
						const sx = cx + (s.x / s.z) * f;
						const sy = cy + (s.y / s.z) * f;
						if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) {
							reset(s, true);
							continue;
						}
						if (!Number.isNaN(s.px)) {
							const b = Math.min(1, (1 - s.z) * 1.3);
							g.strokeStyle = `rgba(${(190 + 65 * b) | 0}, ${(205 + 50 * b) | 0}, 255, ${b})`;
							g.lineWidth = Math.max(0.6, (1 - s.z) * 3.2);
							g.beginPath();
							g.moveTo(s.px, s.py);
							g.lineTo(sx, sy);
							g.stroke();
						}
						s.px = sx;
						s.py = sy;
					}
				},
			};
		},
	},

	aurora: {
		name: "Aurora",
		make: () => {
			const curtains = [
				{
					hue: 150,
					base: 0.56,
					amp: 0.07,
					k1: 1.3,
					k2: 3.7,
					s1: 0.035,
					s2: 0.06,
					len: 0.42,
					alpha: 0.5,
					phase: 0,
				},
				{
					hue: 170,
					base: 0.46,
					amp: 0.09,
					k1: 2.1,
					k2: 2.9,
					s1: -0.028,
					s2: 0.045,
					len: 0.34,
					alpha: 0.38,
					phase: 2,
				},
				{
					hue: 135,
					base: 0.62,
					amp: 0.05,
					k1: 0.9,
					k2: 4.8,
					s1: 0.022,
					s2: -0.04,
					len: 0.28,
					alpha: 0.3,
					phase: 4,
				},
			];
			// One vertical strip per curtain: a sharp bright hem, fading up
			// through violet into the dark.
			const strips = curtains.map((c) => {
				const s = document.createElement("canvas");
				s.width = 1;
				s.height = 128;
				const g = s.getContext("2d")!;
				const grad = g.createLinearGradient(0, 0, 0, 128);
				grad.addColorStop(0, `hsla(${c.hue + 140}, 80%, 60%, 0)`);
				grad.addColorStop(0.45, `hsla(${c.hue + 120}, 80%, 62%, 0.25)`);
				grad.addColorStop(0.88, `hsla(${c.hue}, 90%, 62%, 0.9)`);
				grad.addColorStop(0.95, `hsla(${c.hue - 10}, 100%, 75%, 1)`);
				grad.addColorStop(1, `hsla(${c.hue}, 90%, 62%, 0)`);
				g.fillStyle = grad;
				g.fillRect(0, 0, 1, 128);
				return s;
			});
			return {
				scale: 0.25,
				backdrop(g, w, h) {
					const sky = g.createLinearGradient(0, 0, 0, h);
					sky.addColorStop(0, "#01030a");
					sky.addColorStop(0.6, "#051326");
					sky.addColorStop(1, "#0a1f2e");
					g.fillStyle = sky;
					g.fillRect(0, 0, w, h);
					for (let i = 0; i < 380; i++) {
						const r =
							Math.random() < 0.08 ? aetherRand(1, 1.7) : aetherRand(0.3, 0.9);
						g.fillStyle = `rgba(255, 255, 255, ${aetherRand(0.25, 0.9)})`;
						g.beginPath();
						g.arc(
							Math.random() * w,
							Math.random() * h * 0.8,
							r,
							0,
							Math.PI * 2,
						);
						g.fill();
					}
					// Two ridges, the nearer one darker.
					for (const [top, color, rough] of [
						[0.78, "#07131c", 0.05],
						[0.86, "#02070b", 0.035],
					] as const) {
						g.fillStyle = color;
						g.beginPath();
						g.moveTo(0, h);
						const p1 = Math.random() * 10;
						const p2 = Math.random() * 10;
						for (let x = 0; x <= w; x += 6) {
							const nx = x / w;
							const y =
								h *
								(top +
									rough * Math.sin(nx * 7 + p1) +
									rough * 0.5 * Math.sin(nx * 19 + p2) +
									rough * 0.25 * Math.sin(nx * 43 + p1));
							g.lineTo(x, y);
						}
						g.lineTo(w, h);
						g.fill();
					}
				},
				init() {},
				frame(g, w, h, t) {
					g.clearRect(0, 0, w, h);
					g.globalCompositeOperation = "lighter";
					const TAU = Math.PI * 2;
					curtains.forEach((c, ci) => {
						const strip = strips[ci]!;
						const len = c.len * h;
						// One strip per canvas pixel (the canvas is a quarter scale).
						for (let x = 0; x < w; x += 4) {
							const nx = x / w;
							const hem =
								h *
								(c.base +
									c.amp * Math.sin(nx * c.k1 * TAU + t * c.s1 * TAU + c.phase) +
									c.amp * 0.5 * Math.sin(nx * c.k2 * TAU - t * c.s2 * TAU));
							// Brightness ripples along the curtain, like folds.
							g.globalAlpha =
								c.alpha *
								(0.45 +
									0.55 *
										Math.pow(
											Math.sin(nx * 9 + t * 0.4 + c.phase) * 0.5 + 0.5,
											2,
										));
							g.drawImage(strip, x, hem - len, 5, len);
						}
					});
					g.globalAlpha = 1;
					g.globalCompositeOperation = "source-over";
				},
			};
		},
	},

	flurry: {
		name: "Flurry",
		make: () => {
			type P = {
				x: number;
				y: number;
				vx: number;
				vy: number;
				age: number;
				life: number;
			};
			const streams = Array.from({ length: 4 }, (_, i) => ({
				hue: i * 90 + aetherRand(0, 40),
				a: aetherRand(0.23, 0.41),
				b: aetherRand(0.29, 0.47),
				p: aetherRand(0, 6),
				q: aetherRand(0, 6),
				hx: NaN,
				hy: NaN,
				sprite: null as HTMLCanvasElement | null,
				spriteAt: -1,
				parts: [] as P[],
				carry: 0,
			}));
			return {
				scale: 0.5,
				init(g, w, h) {
					g.fillStyle = "#000";
					g.fillRect(0, 0, w, h);
				},
				frame(g, w, h, t, dt) {
					g.globalCompositeOperation = "source-over";
					g.fillStyle = "rgba(0, 0, 0, 0.16)";
					g.fillRect(0, 0, w, h);
					g.globalCompositeOperation = "lighter";
					const cx = w / 2;
					const cy = h / 2;
					const R = Math.min(w, h) * 0.38;
					for (const s of streams) {
						// Colours drift; the sprite is re-tinted twice a second.
						if (!s.sprite || t - s.spriteAt > 0.5) {
							const hue = (s.hue + t * 12) % 360;
							s.sprite = aetherGlowSprite(`hsla(${hue}, 95%, 62%, 1)`);
							s.spriteAt = t;
						}
						const hx = cx + R * Math.sin(t * s.a * 2 + s.p);
						const hy = cy + R * 0.75 * Math.sin(t * s.b * 2 + s.q);
						// NaN until the first frame: no previous position to trail from.
						const px = Number.isNaN(s.hx) ? hx : s.hx;
						const py = Number.isNaN(s.hy) ? hy : s.hy;
						const hvx = (hx - px) / Math.max(dt, 0.001);
						const hvy = (hy - py) / Math.max(dt, 0.001);
						s.hx = hx;
						s.hy = hy;
						// Spawn along the path the head took this frame, so the
						// stream stays continuous however long the frame was.
						s.carry += dt * 220;
						const count = Math.floor(s.carry);
						for (let k = 0; k < count; k++) {
							const f = (k + 1) / count;
							s.parts.push({
								x: px + (hx - px) * f,
								y: py + (hy - py) * f,
								vx: -hvx * 0.25 + aetherRand(-38, 38),
								vy: -hvy * 0.25 + aetherRand(-38, 38),
								// Earlier spawns have lived a little already.
								age: (1 - f) * dt,
								life: aetherRand(1.1, 1.9),
							});
						}
						s.carry -= count;
						let n = 0;
						for (const p of s.parts) {
							p.age += dt;
							if (p.age >= p.life) continue;
							p.x += p.vx * dt;
							p.y += p.vy * dt;
							p.vx *= 1 - dt * 0.6;
							p.vy *= 1 - dt * 0.6;
							const k = 1 - p.age / p.life;
							const size = 6 + 22 * k;
							g.globalAlpha = k * 0.5;
							g.drawImage(
								s.sprite!,
								p.x - size / 2,
								p.y - size / 2,
								size,
								size,
							);
							s.parts[n++] = p;
						}
						s.parts.length = n;
					}
					g.globalAlpha = 1;
				},
			};
		},
	},

	bounce: {
		name: "Bounce",
		make: () => {
			const colors = [
				"#ff375f",
				"#ff9f0a",
				"#ffd60a",
				"#30d158",
				"#64d2ff",
				"#0a84ff",
				"#bf5af2",
			];
			let x = 0;
			let y = 0;
			let vx = 0;
			let vy = 0;
			let color = 0;
			let text = "";
			let date = "";
			let bw = 0;
			let bh = 0;
			let corners = 0;
			type Bit = {
				x: number;
				y: number;
				vx: number;
				vy: number;
				r: number;
				vr: number;
				c: string;
				age: number;
			};
			const confetti: Bit[] = [];
			const measure = (g: CanvasRenderingContext2D) => {
				const now = new Date();
				text = now.toLocaleTimeString(navigator.language, {
					hour: "numeric",
					minute: "2-digit",
					hour12: !anura.settings.get("24h-time"),
				});
				date = now.toLocaleDateString(navigator.language, {
					weekday: "long",
					month: "long",
					day: "numeric",
				});
				g.font = "700 92px system-ui, -apple-system, sans-serif";
				const tw = g.measureText(text).width;
				g.font = "500 22px system-ui, -apple-system, sans-serif";
				const dw = g.measureText(date).width;
				bw = Math.max(tw, dw) + 16;
				bh = 92 + 30 + 12;
			};
			const celebrate = (cx: number, cy: number) => {
				corners++;
				for (let i = 0; i < 140; i++) {
					const a =
						Math.atan2(cy > 100 ? -1 : 1, cx > 100 ? -1 : 1) +
						aetherRand(-0.7, 0.7);
					const v = aetherRand(250, 750);
					confetti.push({
						x: cx,
						y: cy,
						vx: Math.cos(a) * v,
						vy: Math.sin(a) * v,
						r: aetherRand(0, 6),
						vr: aetherRand(-10, 10),
						c: colors[i % colors.length]!,
						age: 0,
					});
				}
			};
			return {
				scale: Math.min(2, window.devicePixelRatio || 1),
				init(g, w, h) {
					measure(g);
					x = aetherRand(0, Math.max(1, w - bw));
					y = aetherRand(0, Math.max(1, h - bh));
					const speed = 120;
					const a = aetherRand(0.5, 1.07);
					vx = Math.cos(a) * speed * (Math.random() < 0.5 ? -1 : 1);
					vy = Math.sin(a) * speed * (Math.random() < 0.5 ? -1 : 1);
					color = Math.floor(Math.random() * colors.length);
				},
				frame(g, w, h, t, dt) {
					if (Math.floor(t) % 5 === 0) measure(g);
					x += vx * dt;
					y += vy * dt;
					let hitX = false;
					let hitY = false;
					if (x <= 0 || x + bw >= w) {
						vx = -vx;
						x = Math.max(0, Math.min(w - bw, x));
						hitX = true;
					}
					if (y <= 0 || y + bh >= h) {
						vy = -vy;
						y = Math.max(0, Math.min(h - bh, y));
						hitY = true;
					}
					if (hitX || hitY) {
						color =
							(color + 1 + Math.floor(Math.random() * (colors.length - 1))) %
							colors.length;
						// "Exactly" means within a few pixels of the other wall too.
						const nearX = x <= 4 || x + bw >= w - 4;
						const nearY = y <= 4 || y + bh >= h - 4;
						if (nearX && nearY) celebrate(x <= 4 ? 0 : w, y <= 4 ? 0 : h);
					}

					g.clearRect(0, 0, w, h);
					g.fillStyle = colors[color]!;
					g.textBaseline = "top";
					g.font = "700 92px system-ui, -apple-system, sans-serif";
					g.textAlign = "center";
					g.fillText(text, x + bw / 2, y);
					g.font = "500 22px system-ui, -apple-system, sans-serif";
					g.globalAlpha = 0.8;
					g.fillText(date, x + bw / 2, y + 104);
					g.globalAlpha = 1;

					if (corners) {
						g.textAlign = "right";
						g.font = "500 13px system-ui, -apple-system, sans-serif";
						g.fillStyle = "rgba(255, 255, 255, 0.35)";
						g.fillText(`corner hits: ${corners}`, w - 16, h - 28);
					}

					let n = 0;
					for (const b of confetti) {
						b.age += dt;
						if (b.age > 4 || b.y > h + 20) continue;
						b.vy += 900 * dt;
						b.vx *= 1 - dt * 0.8;
						b.x += b.vx * dt;
						b.y += b.vy * dt;
						b.r += b.vr * dt;
						g.save();
						g.translate(b.x, b.y);
						g.rotate(b.r);
						g.fillStyle = b.c;
						g.fillRect(-5, -3, 10, 6);
						g.restore();
						confetti[n++] = b;
					}
					confetti.length = n;
				},
			};
		},
	},
};

class AetherScreensaver {
	static readonly MODE_KEY = "aether.saver.mode";
	static readonly DELAY_KEY = "aether.saver.minutes";

	static #el: HTMLElement | null = null;
	static #scene: AetherSaverScene | null = null;
	static #raf = 0;
	static #last = 0;
	static #startedAt = 0;
	static #t = 0;
	static #listeners: AbortController | null = null;

	static get showing(): boolean {
		return !!this.#el;
	}

	/** "off", "random", or one of the scenes. */
	static get mode(): string {
		const m = anura.settings.get(this.MODE_KEY);
		return typeof m === "string" ? m : "random";
	}

	static get minutes(): number {
		const v = Number(anura.settings.get(this.DELAY_KEY));
		return Number.isFinite(v) && v > 0 ? v : 10;
	}

	static start(mode?: string) {
		if (this.#el) return;
		let pick = mode || this.mode;
		if (pick === "off") return;
		const names = Object.keys(AETHER_SAVERS) as AetherSaverMode[];
		if (!names.includes(pick as AetherSaverMode))
			pick = names[Math.floor(Math.random() * names.length)]!;
		const scene = AETHER_SAVERS[pick as AetherSaverMode].make();

		const el = document.createElement("div");
		el.id = "screensaver";
		el.dataset.scene = pick;
		const w = window.innerWidth;
		const h = window.innerHeight;
		if (scene.backdrop) {
			const bg = document.createElement("canvas");
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			bg.width = Math.round(w * dpr);
			bg.height = Math.round(h * dpr);
			const bgg = bg.getContext("2d")!;
			bgg.scale(dpr, dpr);
			scene.backdrop(bgg, w, h);
			el.append(bg);
		}
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(w * scene.scale));
		canvas.height = Math.max(1, Math.round(h * scene.scale));
		el.append(canvas);
		document.body.append(el);
		document.body.classList.add("saver-on");
		requestAnimationFrame(() => el.classList.add("is-shown"));

		const g = canvas.getContext("2d")!;
		g.scale(scene.scale, scene.scale);
		scene.init(g, w, h);
		this.#el = el;
		this.#scene = scene;
		this.#t = 0;
		this.#last = performance.now();
		this.#startedAt = this.#last;

		const frame = (now: number) => {
			if (!this.#el) return;
			const dt = Math.min(0.1, (now - this.#last) / 1000);
			this.#last = now;
			this.#t += dt;
			// Input inside an app's iframe never reaches this document; the
			// lock screen's activity tracker sees it, so ask it too.
			const since = now - this.#startedAt;
			if (since > 1000 && AetherLockScreen.idleFor < since - 250) {
				this.stop();
				return;
			}
			if (!document.hidden) this.#scene!.frame(g, w, h, this.#t, dt);
			this.#raf = requestAnimationFrame(frame);
		};
		this.#raf = requestAnimationFrame(frame);

		// Waking up: anything at all, after a moment's grace (the pointer is
		// often still moving when a hot corner starts it).
		this.#listeners = new AbortController();
		const wake = () => {
			if (performance.now() - this.#startedAt > 1000) this.stop();
		};
		for (const type of ["pointermove", "pointerdown", "keydown", "wheel"])
			window.addEventListener(type, wake, {
				capture: true,
				passive: true,
				signal: this.#listeners.signal,
			});
		// Swallow the waking click so it doesn't land on whatever is beneath.
		el.addEventListener("pointerdown", (e) => e.preventDefault());
	}

	static stop() {
		const el = this.#el;
		if (!el) return;
		this.#el = null;
		this.#scene = null;
		cancelAnimationFrame(this.#raf);
		this.#listeners?.abort();
		this.#listeners = null;
		document.body.classList.remove("saver-on");
		el.classList.remove("is-shown");
		setTimeout(() => el.remove(), 300);
	}

	static init() {
		AetherCommands.register({
			id: "screensaver",
			title: "Start Screen Saver",
			icon: "nights_stay",
			keywords: ["screensaver", "idle", "starfield", "aurora", "flurry"],
			run: () => setTimeout(() => this.start(), 300),
		});
		// Minute-granularity delays: a coarse check is plenty.
		window.setInterval(() => {
			if (this.#el || this.mode === "off") return;
			if ((globalThis as any).AetherScreenshot?.recording) return;
			if (AetherLockScreen.idleFor >= this.minutes * 60_000) this.start();
		}, 5000);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherScreensaver = AetherScreensaver;
(globalThis as any).AETHER_SAVERS = AETHER_SAVERS;
