/**
 * Aether — UI sound engine
 * ---------------------------------------------------------------------------
 * Every sound in the shell is synthesised at play time with WebAudio. There
 * are no audio assets: nothing to ship, nothing to license, and the whole
 * palette is a few hundred bytes of code instead of a few hundred kilobytes of
 * samples.
 *
 * Usage (this file compiles to a plain script, so the singleton is a global):
 *
 *     aetherSound.play("open");
 *     aetherSound.play("notify", { volume: 0.7 });   // one-off scale
 *     aetherSound.enabled = false;                   // persisted
 *     aetherSound.volume = 0.25;                     // persisted, 0..1
 *
 * Settings keys (both read through `anura.settings`, both optional):
 *
 *     sound-enabled   boolean, default true
 *     sound-volume    number 0..1, default 0.4
 *
 * Design constraints this file holds itself to:
 *   - It may load before `anura` exists. Every settings access is lazy and
 *     wrapped; the defaults above apply until anura shows up.
 *   - It must never throw. If WebAudio is missing, blocked, or the context
 *     cannot be created, `play()` is a silent no-op.
 *   - Browsers refuse to start an AudioContext outside a user gesture, so the
 *     context is created on the first pointer/key/touch event and resumed
 *     opportunistically on every play.
 *
 * When each key should fire (suggested wiring — this file does not bind any
 * of it, so nothing surprises you):
 *
 *     click           dock icon / menubar item / launchpad tile activation
 *     open            window created
 *     close           window closed
 *     minimize        window minimised
 *     maximize        window maximised or restored
 *     toggleOn/Off    Control Center switches, settings checkboxes
 *     notify          NotificationService showing a toast
 *     error           anura.dialog.alert / failed action
 *     launchpadOpen   Launchpad revealed
 *     launchpadClose  Launchpad dismissed
 *     boot            end of Bootsplash, once
 */

type AetherSoundName =
	| "click"
	| "open"
	| "close"
	| "minimize"
	| "maximize"
	| "toggleOn"
	| "toggleOff"
	| "notify"
	| "error"
	| "launchpadOpen"
	| "launchpadClose"
	| "boot";

interface AetherToneOptions {
	/** Start time, in seconds, relative to the sound's own t0. */
	at?: number;
	/** Fundamental in Hz. */
	freq: number;
	/** Glide target in Hz. Omitted means a steady pitch. */
	to?: number;
	type?: OscillatorType;
	/** Peak linear gain before the master/volume stages. */
	gain?: number;
	/** Seconds from t0+at to peak. */
	attack?: number;
	/** Seconds from peak to silence. */
	decay?: number;
	/** Cents of detune — a couple of cents keeps a blip from sounding sterile. */
	detune?: number;
	/** -1 (left) .. 1 (right). */
	pan?: number;
}

interface AetherNoiseOptions {
	at?: number;
	/** Seconds of noise. */
	dur?: number;
	gain?: number;
	/** Lowpass corner in Hz — keeps transients from sounding like static. */
	cutoff?: number;
	type?: BiquadFilterType;
}

/** What a recipe is handed: a context, a node to play into, and a start time. */
type AetherRecipe = (
	ctx: BaseAudioContext,
	bus: AudioNode,
	t0: number,
	env: AetherSynth,
) => void;

/**
 * The synthesis primitives, factored out of the engine so they work against
 * any BaseAudioContext — in particular an OfflineAudioContext, which is how
 * the palette is tested without a speaker.
 */
class AetherSynth {
	/** A single enveloped oscillator. */
	tone(
		ctx: BaseAudioContext,
		bus: AudioNode,
		t0: number,
		o: AetherToneOptions,
	): void {
		const at = t0 + (o.at || 0);
		const attack = o.attack === undefined ? 0.006 : o.attack;
		const decay = o.decay === undefined ? 0.18 : o.decay;
		const peak = Math.max(0.0001, o.gain === undefined ? 0.15 : o.gain);

		const osc = ctx.createOscillator();
		osc.type = o.type || "sine";
		osc.frequency.setValueAtTime(Math.max(1, o.freq), at);
		if (o.to !== undefined) {
			// Exponential ramps read as musical glides; linear ones sound
			// like a siren at these short durations.
			osc.frequency.exponentialRampToValueAtTime(
				Math.max(1, o.to),
				at + attack + decay,
			);
		}
		if (o.detune) osc.detune.setValueAtTime(o.detune, at);

		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, at);
		g.gain.exponentialRampToValueAtTime(peak, at + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);

		let tail: AudioNode = g;
		if (o.pan !== undefined && typeof ctx.createStereoPanner === "function") {
			const p = ctx.createStereoPanner();
			p.pan.setValueAtTime(Math.max(-1, Math.min(1, o.pan)), at);
			g.connect(p);
			tail = p;
		}

		osc.connect(g);
		tail.connect(bus);
		osc.start(at);
		osc.stop(at + attack + decay + 0.02);
	}

	/** A filtered noise burst — used only for tiny transients. */
	noise(
		ctx: BaseAudioContext,
		bus: AudioNode,
		t0: number,
		o: AetherNoiseOptions,
	): void {
		const at = t0 + (o.at || 0);
		const dur = o.dur === undefined ? 0.03 : o.dur;
		const peak = Math.max(0.0001, o.gain === undefined ? 0.05 : o.gain);

		const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < frames; i++) {
			// Fade the noise itself so the buffer edge never clicks.
			data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
		}

		const src = ctx.createBufferSource();
		src.buffer = buf;

		const filter = ctx.createBiquadFilter();
		filter.type = o.type || "lowpass";
		filter.frequency.setValueAtTime(
			o.cutoff === undefined ? 2400 : o.cutoff,
			at,
		);

		const g = ctx.createGain();
		g.gain.setValueAtTime(peak, at);
		g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

		src.connect(filter);
		filter.connect(g);
		g.connect(bus);
		src.start(at);
		src.stop(at + dur + 0.02);
	}

	/** Convenience: the same tone twice, detuned apart, for a wider blip. */
	pair(
		ctx: BaseAudioContext,
		bus: AudioNode,
		t0: number,
		o: AetherToneOptions,
		spread = 7,
	): void {
		this.tone(ctx, bus, t0, {
			...o,
			detune: (o.detune || 0) - spread,
			pan: -0.12,
		});
		this.tone(ctx, bus, t0, {
			...o,
			gain: (o.gain === undefined ? 0.15 : o.gain) * 0.8,
			detune: (o.detune || 0) + spread,
			pan: 0.12,
		});
	}
}

class AetherSound {
	static readonly KEY_ENABLED = "sound-enabled";
	static readonly KEY_VOLUME = "sound-volume";
	static readonly DEFAULT_VOLUME = 0.4;

	/** Longest sound in the palette, used to size offline renders. */
	static readonly MAX_DURATION = 2.6;

	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private bus: GainNode | null = null;
	private wet: GainNode | null = null;
	private synth = new AetherSynth();

	private supported = false;
	private failed = false;
	private gestureBound = false;

	/** Local mirrors so we behave sanely before anura.settings exists. */
	private enabledCache: boolean = true;
	private volumeCache: number = AetherSound.DEFAULT_VOLUME;
	private settingsRead = false;

	/**
	 * Per-key rate limit. Rapid-fire UI events (a held key, a drag over a dock)
	 * would otherwise stack dozens of voices and turn into a buzz.
	 */
	private lastPlayed: Record<string, number> = {};
	private static readonly THROTTLE_MS = 35;

	constructor() {
		try {
			this.supported =
				typeof window !== "undefined" &&
				(typeof window.AudioContext === "function" ||
					typeof (window as any).webkitAudioContext === "function");
		} catch {
			this.supported = false;
		}
		this.bindGesture();
	}

	// -------------------------------------------------------------- settings

	/**
	 * `anura` is declared with `let` in Boot.tsx, so it may not exist yet (or
	 * may exist but still be undefined). Never assume, never throw.
	 */
	private anura(): any {
		try {
			if (typeof anura === "undefined") return null;
			return (anura as any) || null;
		} catch {
			return null;
		}
	}

	private readSettings(): void {
		const a = this.anura();
		if (!a || !a.settings || typeof a.settings.get !== "function") return;
		try {
			const e = a.settings.get(AetherSound.KEY_ENABLED);
			if (e !== undefined && e !== null) this.enabledCache = !!e;

			const v = a.settings.get(AetherSound.KEY_VOLUME);
			if (typeof v === "number" && isFinite(v)) {
				this.volumeCache = Math.max(0, Math.min(1, v));
			}
			this.settingsRead = true;
		} catch {
			/* settings not ready — keep the cached defaults */
		}
	}

	private writeSetting(key: string, value: unknown): void {
		const a = this.anura();
		if (!a || !a.settings || typeof a.settings.set !== "function") return;
		try {
			// Settings.set is async and swallows nothing; make sure a rejected
			// promise can't surface as an unhandled rejection.
			const r = a.settings.set(key, value);
			if (r && typeof r.catch === "function") r.catch(() => {});
		} catch {
			/* ignore */
		}
	}

	get enabled(): boolean {
		if (!this.settingsRead) this.readSettings();
		return this.enabledCache;
	}

	set enabled(on: boolean) {
		this.enabledCache = !!on;
		this.settingsRead = true;
		this.writeSetting(AetherSound.KEY_ENABLED, this.enabledCache);
	}

	get volume(): number {
		if (!this.settingsRead) this.readSettings();
		return this.volumeCache;
	}

	set volume(v: number) {
		const clamped =
			typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
		this.volumeCache = clamped;
		this.settingsRead = true;
		this.writeSetting(AetherSound.KEY_VOLUME, clamped);
		if (this.master && this.ctx) {
			try {
				this.master.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
			} catch {
				/* ignore */
			}
		}
	}

	/** Re-read from anura.settings — call after the settings store is ready. */
	refresh(): void {
		this.settingsRead = false;
		this.readSettings();
		if (this.master && this.ctx) {
			try {
				this.master.gain.setTargetAtTime(
					this.volumeCache,
					this.ctx.currentTime,
					0.02,
				);
			} catch {
				/* ignore */
			}
		}
	}

	// ----------------------------------------------------------- audio graph

	/**
	 * Autoplay policy: a context created outside a gesture starts "suspended"
	 * and silently drops everything. Listening once for the first real input
	 * means the very first UI sound of the session actually plays.
	 */
	private bindGesture(): void {
		if (this.gestureBound || typeof document === "undefined") return;
		this.gestureBound = true;

		const unlock = () => {
			this.ensureContext();
			if (this.ctx && this.ctx.state === "running") {
				document.removeEventListener("pointerdown", unlock, true);
				document.removeEventListener("keydown", unlock, true);
				document.removeEventListener("touchstart", unlock, true);
			}
		};

		try {
			document.addEventListener("pointerdown", unlock, true);
			document.addEventListener("keydown", unlock, true);
			document.addEventListener("touchstart", unlock, true);
		} catch {
			/* ignore */
		}
	}

	private ensureContext(): AudioContext | null {
		if (this.ctx) {
			if (this.ctx.state === "suspended") {
				try {
					void this.ctx.resume();
				} catch {
					/* ignore */
				}
			}
			return this.ctx;
		}
		if (!this.supported || this.failed) return null;

		try {
			const Ctor: typeof AudioContext =
				(window as any).AudioContext || (window as any).webkitAudioContext;
			const ctx = new Ctor({ latencyHint: "interactive" });

			const master = ctx.createGain();
			master.gain.setValueAtTime(this.volume, ctx.currentTime);
			master.connect(ctx.destination);

			const { bus, wet } = this.buildBus(ctx, master);

			this.ctx = ctx;
			this.master = master;
			this.bus = bus;
			this.wet = wet;

			if (ctx.state === "suspended") void ctx.resume();
			return ctx;
		} catch {
			// A blocked or unsupported context is permanent for this page —
			// don't retry on every click.
			this.failed = true;
			return null;
		}
	}

	/**
	 * Voices play into `bus`, which goes straight to the destination and also
	 * through a short synthesised room. The reverb is deliberately quiet: it
	 * is there to keep blips from sounding like they were recorded in a box,
	 * not to make the desktop sound like a cathedral.
	 */
	private buildBus(
		ctx: BaseAudioContext,
		dest: AudioNode,
	): { bus: GainNode; wet: GainNode } {
		const bus = ctx.createGain();
		bus.gain.value = 1;
		bus.connect(dest);

		const wet = ctx.createGain();
		wet.gain.value = 0.16;

		try {
			const conv = ctx.createConvolver();
			conv.buffer = AetherSound.impulse(ctx, 0.85, 3.4);
			// A hair of pre-delay separates the tail from the transient.
			const pre = ctx.createDelay(0.2);
			pre.delayTime.value = 0.012;
			// Rolling off the top keeps the tail from adding sibilance.
			const damp = ctx.createBiquadFilter();
			damp.type = "lowpass";
			damp.frequency.value = 4200;

			bus.connect(pre);
			pre.connect(conv);
			conv.connect(damp);
			damp.connect(wet);
			wet.connect(dest);
		} catch {
			// No convolver? Fall back to a single short echo, which is a
			// passable stand-in and costs nothing.
			try {
				const d = ctx.createDelay(0.3);
				d.delayTime.value = 0.07;
				const fb = ctx.createGain();
				fb.gain.value = 0.22;
				bus.connect(d);
				d.connect(fb);
				fb.connect(d);
				d.connect(wet);
				wet.connect(dest);
			} catch {
				/* dry only */
			}
		}

		return { bus, wet };
	}

	/** Exponentially decaying stereo noise — a serviceable small-room IR. */
	private static impulse(
		ctx: BaseAudioContext,
		seconds: number,
		decay: number,
	): AudioBuffer {
		const rate = ctx.sampleRate;
		const frames = Math.max(1, Math.floor(rate * seconds));
		const buf = ctx.createBuffer(2, frames, rate);
		for (let c = 0; c < 2; c++) {
			const ch = buf.getChannelData(c);
			for (let i = 0; i < frames; i++) {
				const t = i / frames;
				ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
			}
		}
		return buf;
	}

	// --------------------------------------------------------------- palette

	/**
	 * Recipes are pure: given a context, a bus and a start time they schedule
	 * their voices and return. That is what lets `render()` run them through an
	 * OfflineAudioContext for testing.
	 */
	private static readonly RECIPES: Record<AetherSoundName, AetherRecipe> = {
		// Barely-there tick. Two very short partials plus a filtered transient
		// so it has a "surface" without being a beep.
		click(ctx, bus, t, s) {
			s.tone(ctx, bus, t, {
				freq: 1320,
				to: 990,
				type: "sine",
				gain: 0.075,
				attack: 0.002,
				decay: 0.045,
			});
			s.tone(ctx, bus, t, {
				freq: 2640,
				type: "sine",
				gain: 0.022,
				attack: 0.001,
				decay: 0.028,
			});
			s.noise(ctx, bus, t, { dur: 0.018, gain: 0.018, cutoff: 5200 });
		},

		// Rising perfect fifth, C5 → G5. Reads as "something appeared".
		open(ctx, bus, t, s) {
			s.pair(ctx, bus, t, {
				freq: 523.25,
				type: "triangle",
				gain: 0.11,
				attack: 0.008,
				decay: 0.16,
			});
			s.pair(ctx, bus, t, {
				at: 0.055,
				freq: 783.99,
				type: "triangle",
				gain: 0.1,
				attack: 0.01,
				decay: 0.24,
			});
			s.tone(ctx, bus, t, {
				at: 0.055,
				freq: 1567.98,
				type: "sine",
				gain: 0.025,
				attack: 0.01,
				decay: 0.2,
			});
		},

		// The same interval inverted and softened.
		close(ctx, bus, t, s) {
			s.pair(ctx, bus, t, {
				freq: 659.25,
				type: "triangle",
				gain: 0.085,
				attack: 0.006,
				decay: 0.12,
			});
			s.pair(ctx, bus, t, {
				at: 0.05,
				freq: 392,
				type: "triangle",
				gain: 0.075,
				attack: 0.008,
				decay: 0.22,
			});
		},

		// A single downward glide — the window "pouring" into the dock.
		minimize(ctx, bus, t, s) {
			s.tone(ctx, bus, t, {
				freq: 760,
				to: 250,
				type: "sine",
				gain: 0.1,
				attack: 0.006,
				decay: 0.19,
			});
			s.tone(ctx, bus, t, {
				freq: 1520,
				to: 500,
				type: "sine",
				gain: 0.02,
				attack: 0.006,
				decay: 0.13,
			});
		},

		maximize(ctx, bus, t, s) {
			s.tone(ctx, bus, t, {
				freq: 300,
				to: 820,
				type: "sine",
				gain: 0.1,
				attack: 0.008,
				decay: 0.2,
			});
			s.tone(ctx, bus, t, {
				at: 0.02,
				freq: 600,
				to: 1640,
				type: "sine",
				gain: 0.022,
				attack: 0.008,
				decay: 0.16,
			});
		},

		toggleOn(ctx, bus, t, s) {
			s.tone(ctx, bus, t, {
				freq: 659.25,
				type: "sine",
				gain: 0.075,
				attack: 0.004,
				decay: 0.055,
			});
			s.tone(ctx, bus, t, {
				at: 0.045,
				freq: 987.77,
				type: "sine",
				gain: 0.075,
				attack: 0.004,
				decay: 0.1,
			});
		},

		toggleOff(ctx, bus, t, s) {
			s.tone(ctx, bus, t, {
				freq: 987.77,
				type: "sine",
				gain: 0.07,
				attack: 0.004,
				decay: 0.055,
			});
			s.tone(ctx, bus, t, {
				at: 0.045,
				freq: 587.33,
				type: "sine",
				gain: 0.07,
				attack: 0.004,
				decay: 0.11,
			});
		},

		// D major triad, spread as an arpeggio, with the longest tail in the
		// palette. Should read across a room without being an alarm.
		notify(ctx, bus, t, s) {
			const notes = [587.33, 880, 1174.66];
			notes.forEach((f, i) => {
				s.tone(ctx, bus, t, {
					at: i * 0.075,
					freq: f,
					type: "triangle",
					gain: 0.085 - i * 0.012,
					attack: 0.01,
					decay: 0.34 + i * 0.12,
					pan: (i - 1) * 0.18,
				});
				s.tone(ctx, bus, t, {
					at: i * 0.075,
					freq: f * 2,
					type: "sine",
					gain: 0.016,
					attack: 0.01,
					decay: 0.22,
				});
			});
		},

		// Low, damped, slightly sour minor second — clearly negative, but not
		// a buzzer. Repeats once so it registers.
		error(ctx, bus, t, s) {
			[0, 0.14].forEach((at) => {
				s.tone(ctx, bus, t, {
					at,
					freq: 233.08,
					type: "triangle",
					gain: 0.1,
					attack: 0.006,
					decay: 0.13,
				});
				s.tone(ctx, bus, t, {
					at,
					freq: 246.94,
					type: "sine",
					gain: 0.055,
					attack: 0.006,
					decay: 0.12,
				});
			});
		},

		// A rising shimmer: five partials of a Dsus2 stack, staggered, each
		// gliding up a little. Mirrors the tiles fanning outward.
		launchpadOpen(ctx, bus, t, s) {
			const stack = [293.66, 440, 587.33, 659.25, 880];
			stack.forEach((f, i) => {
				s.tone(ctx, bus, t, {
					at: i * 0.032,
					freq: f,
					to: f * 1.06,
					type: "sine",
					gain: 0.055 - i * 0.005,
					attack: 0.02,
					decay: 0.36 + i * 0.05,
					pan: (i / (stack.length - 1)) * 1.4 - 0.7,
				});
			});
			s.noise(ctx, bus, t, {
				dur: 0.22,
				gain: 0.012,
				cutoff: 7000,
				type: "highpass",
			});
		},

		// The same stack, top-down and shorter.
		launchpadClose(ctx, bus, t, s) {
			const stack = [880, 659.25, 587.33, 440, 293.66];
			stack.forEach((f, i) => {
				s.tone(ctx, bus, t, {
					at: i * 0.024,
					freq: f,
					to: f * 0.95,
					type: "sine",
					gain: 0.045 - i * 0.004,
					attack: 0.008,
					decay: 0.18 + i * 0.03,
					pan: 0.7 - (i / (stack.length - 1)) * 1.4,
				});
			});
		},

		// Warm, slow swell — root, fifth, octave, tenth. Long attack so it
		// fades up under the bootsplash rather than announcing itself.
		boot(ctx, bus, t, s) {
			const chord = [130.81, 196, 261.63, 329.63, 392];
			chord.forEach((f, i) => {
				s.tone(ctx, bus, t, {
					at: i * 0.09,
					freq: f,
					type: i < 2 ? "triangle" : "sine",
					gain: 0.075 - i * 0.008,
					attack: 0.34 + i * 0.05,
					decay: 1.1 + i * 0.14,
					detune: i % 2 ? 4 : -4,
					pan: (i / (chord.length - 1)) * 1.2 - 0.6,
				});
			});
			s.tone(ctx, bus, t, {
				at: 0.5,
				freq: 1046.5,
				type: "sine",
				gain: 0.028,
				attack: 0.24,
				decay: 0.9,
			});
		},
	};

	/** Every key in the palette, for settings UIs and tests. */
	static names(): AetherSoundName[] {
		return Object.keys(AetherSound.RECIPES) as AetherSoundName[];
	}

	// ------------------------------------------------------------------ play

	/**
	 * Play a UI sound. Safe to call from anywhere at any time: unknown keys,
	 * a missing AudioContext, a suspended context, sound disabled, or zero
	 * volume all resolve to a silent no-op rather than an exception.
	 */
	play(name: AetherSoundName | string, opts?: { volume?: number }): void {
		try {
			const recipe = (
				AetherSound.RECIPES as Record<string, AetherRecipe | undefined>
			)[name];
			if (!recipe) return;
			if (!this.enabled || this.volume <= 0) return;

			const now = Date.now();
			const last = this.lastPlayed[name];
			if (last !== undefined && now - last < AetherSound.THROTTLE_MS) return;
			this.lastPlayed[name] = now;

			const ctx = this.ensureContext();
			if (!ctx || !this.bus) return;
			// Still locked by the autoplay policy — drop it rather than
			// queueing a sound that would fire minutes later.
			if (ctx.state !== "running") return;

			let target: AudioNode = this.bus;
			const scale = opts && typeof opts.volume === "number" ? opts.volume : 1;
			if (scale !== 1) {
				const g = ctx.createGain();
				g.gain.value = Math.max(0, Math.min(4, scale));
				g.connect(this.bus);
				target = g;
			}

			recipe(ctx, target, ctx.currentTime + 0.001, this.synth);
		} catch {
			/* a UI sound is never worth an exception */
		}
	}

	/** Fire-and-forget alias, so `onclick={() => aetherSound.click()}` reads well. */
	click(): void {
		this.play("click");
	}

	/** Suspend the context (e.g. on lock screen) without tearing it down. */
	suspend(): void {
		try {
			if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
		} catch {
			/* ignore */
		}
	}

	resume(): void {
		try {
			if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
		} catch {
			/* ignore */
		}
	}

	/**
	 * Render one sound through an OfflineAudioContext and hand back the buffer.
	 * Used by the test harness to prove a recipe is audible without needing a
	 * speaker or a user gesture; also handy for a settings-page waveform.
	 * Resolves to null if offline rendering is unavailable.
	 */
	async render(
		name: AetherSoundName | string,
		seconds = AetherSound.MAX_DURATION,
	): Promise<AudioBuffer | null> {
		try {
			const recipe = (
				AetherSound.RECIPES as Record<string, AetherRecipe | undefined>
			)[name];
			if (!recipe) return null;
			const Ctor: any =
				(globalThis as any).OfflineAudioContext ||
				(globalThis as any).webkitOfflineAudioContext;
			if (!Ctor) return null;

			const rate = 44100;
			const ctx: OfflineAudioContext = new Ctor(
				2,
				Math.ceil(rate * seconds),
				rate,
			);
			const master = ctx.createGain();
			master.gain.value = 1;
			master.connect(ctx.destination);
			const { bus } = this.buildBus(ctx, master);
			recipe(ctx, bus, 0.005, this.synth);
			return await ctx.startRendering();
		} catch {
			return null;
		}
	}
}

/**
 * Motion.css needs `body.reduce-motion` kept in sync with the existing
 * `disable-animation` setting. It lives here rather than in a third file
 * because it is three lines and shares this file's "guard every anura access"
 * posture. Call `AetherMotion.sync()` once anura is up; it is idempotent and
 * re-syncs on `anura-settings-change`.
 */
const AetherMotion = {
	bound: false,

	/** Push the current `disable-animation` value onto <body>. */
	sync(): void {
		try {
			if (typeof document === "undefined" || !document.body) return;
			const a = typeof anura === "undefined" ? null : (anura as any);
			if (!a || !a.settings || typeof a.settings.get !== "function") return;
			document.body.classList.toggle(
				"reduce-motion",
				!!a.settings.get("disable-animation"),
			);
		} catch {
			/* ignore */
		}
	},

	/** Sync now and on every settings change event the shell emits. */
	watch(): void {
		if (this.bound) return;
		this.bound = true;
		this.sync();
		try {
			document.addEventListener("anura-settings-change", () => this.sync());
			document.addEventListener("anura-theme-change", () => this.sync());
		} catch {
			/* ignore */
		}
	},
};

/**
 * The singleton. Declared as a top-level `const` (visible to every other
 * script in the shared global scope) and mirrored onto globalThis so app
 * iframes and dynamically-evaluated code can reach it too.
 */
const aetherSound = new AetherSound();
try {
	(globalThis as any).aetherSound = aetherSound;
	(globalThis as any).AetherSound = AetherSound;
	(globalThis as any).AetherMotion = AetherMotion;
} catch {
	/* ignore */
}
