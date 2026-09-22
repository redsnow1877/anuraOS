/**
 * Aether — a demo album, synthesized on the spot.
 * ---------------------------------------------------------------------------
 * A fresh install has no music, and a music player with nothing to play is a
 * sad thing to open. So Music offers to make some: three short lo-fi pieces
 * rendered offline with WebAudio (detuned-saw pads, plucked arpeggios through
 * a ping-pong delay, a round bass, synthesized drums, a little vinyl crackle,
 * all into a generated reverb) and saved as tagged WAV files.
 *
 * Every sound is made from oscillators and noise; no samples ship with this.
 */

interface AetherDemoSong {
	title: string;
	bpm: number;
	/** Four chords, MIDI note numbers, lowest first. Each lasts a bar. */
	chords: number[][];
	/** Arpeggio pattern: indices into the chord's notes, an octave up. */
	arp: number[];
	swing: number;
	crackle: boolean;
	/** Lowpass on the whole mix, for the tape-ish ones. */
	tone: number;
}

const AETHER_DEMO_ALBUM = "Aether Sessions";

const AETHER_DEMO_SONGS: AetherDemoSong[] = [
	{
		title: "Night Drive",
		bpm: 88,
		// Am9 · Fmaj9 · Cmaj7 · G6
		chords: [
			[45, 52, 55, 59, 60, 64],
			[41, 48, 52, 55, 57, 64],
			[48, 52, 55, 59, 62],
			[43, 50, 55, 59, 64],
		],
		arp: [0, 2, 3, 4, 2, 3, 1, 3],
		swing: 0.12,
		crackle: true,
		tone: 5200,
	},
	{
		title: "Glass Rain",
		bpm: 72,
		// Dm9 · B♭maj7 · Fmaj9 · C6/E
		chords: [
			[38, 50, 53, 57, 60, 64],
			[46, 50, 53, 57, 62],
			[41, 48, 52, 55, 57, 64],
			[40, 48, 52, 55, 57, 62],
		],
		arp: [4, 2, 3, 1, 2, 0, 3, 2],
		swing: 0.2,
		crackle: true,
		tone: 3600,
	},
	{
		title: "Aurora",
		bpm: 104,
		// Emaj9 · C♯m9 · Amaj9 · B6sus
		chords: [
			[40, 51, 54, 56, 59, 63],
			[37, 49, 52, 56, 59, 63],
			[45, 49, 52, 56, 59, 64],
			[47, 51, 54, 56, 59, 61],
		],
		arp: [0, 1, 2, 3, 4, 3, 2, 1],
		swing: 0,
		crackle: false,
		tone: 9000,
	},
];

class AetherMusicDemo {
	static readonly RATE = 32000;
	static readonly BARS = 12;

	static #hz(midi: number): number {
		return 440 * Math.pow(2, (midi - 69) / 12);
	}

	static #noise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
		const b = ctx.createBuffer(
			1,
			Math.ceil(ctx.sampleRate * seconds),
			ctx.sampleRate,
		);
		const d = b.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
		return b;
	}

	/** A stereo hall: decaying noise, a touch different per ear. */
	static #impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
		const n = Math.ceil(ctx.sampleRate * seconds);
		const b = ctx.createBuffer(2, n, ctx.sampleRate);
		for (let c = 0; c < 2; c++) {
			const d = b.getChannelData(c);
			for (let i = 0; i < n; i++)
				d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
		}
		return b;
	}

	/** Render one song to an AudioBuffer. */
	static async render(song: AetherDemoSong): Promise<AudioBuffer> {
		const beat = 60 / song.bpm;
		const bar = beat * 4;
		const tail = 3;
		const length = this.BARS * bar + tail;
		const ctx = new OfflineAudioContext(
			2,
			Math.ceil(length * this.RATE),
			this.RATE,
		);

		// ---- buses: everything → tone → glue compressor → fade → out
		const fade = ctx.createGain();
		fade.gain.setValueAtTime(0, 0);
		fade.gain.linearRampToValueAtTime(1, 1.2);
		fade.gain.setValueAtTime(1, this.BARS * bar - bar);
		fade.gain.linearRampToValueAtTime(0, length - 0.2);
		const glue = ctx.createDynamicsCompressor();
		glue.threshold.value = -16;
		glue.ratio.value = 3;
		glue.attack.value = 0.012;
		glue.release.value = 0.22;
		const tone = ctx.createBiquadFilter();
		tone.type = "lowpass";
		tone.frequency.value = song.tone;
		tone.Q.value = 0.5;
		const mix = ctx.createGain();
		mix.connect(tone).connect(glue).connect(fade).connect(ctx.destination);

		const reverb = ctx.createConvolver();
		reverb.buffer = this.#impulse(ctx, 2.8);
		const reverbOut = ctx.createGain();
		reverbOut.gain.value = 0.45;
		reverb.connect(reverbOut).connect(mix);

		const bus = (level: number, wet: number) => {
			const g = ctx.createGain();
			g.gain.value = level;
			g.connect(mix);
			if (wet) {
				const s = ctx.createGain();
				s.gain.value = wet;
				g.connect(s).connect(reverb);
			}
			return g;
		};
		const padBus = bus(1, 0.9);
		const arpBus = bus(1, 0.5);
		const bassBus = bus(1, 0);
		const drumBus = bus(1, 0.12);

		// Ping-pong delay on the arpeggio: dotted eighths, darker each repeat.
		const dl = ctx.createDelay(2);
		const dr = ctx.createDelay(2);
		dl.delayTime.value = dr.delayTime.value = beat * 0.75;
		const fb = ctx.createGain();
		fb.gain.value = 0.38;
		const dark = ctx.createBiquadFilter();
		dark.type = "lowpass";
		dark.frequency.value = 2600;
		const merge = ctx.createChannelMerger(2);
		const arpSend = ctx.createGain();
		arpSend.gain.value = 0.5;
		arpBus.connect(arpSend).connect(dl);
		dl.connect(dr);
		dr.connect(dark).connect(fb).connect(dl);
		dl.connect(merge, 0, 0);
		dr.connect(merge, 0, 1);
		const delayOut = ctx.createGain();
		delayOut.gain.value = 0.55;
		merge.connect(delayOut).connect(mix);
		delayOut.connect(reverb);

		const noise = this.#noise(ctx, 1);

		// ---- instruments
		// One filter, envelope and pan trio per chord, shared by its notes:
		// automating a filter per note costs more than the rest of the song.
		const pad = (t: number, dur: number, notes: number[]) => {
			const f = ctx.createBiquadFilter();
			f.type = "lowpass";
			f.Q.value = 0.7;
			f.frequency.setValueAtTime(500, t);
			f.frequency.linearRampToValueAtTime(1500, t + dur * 0.55);
			f.frequency.linearRampToValueAtTime(700, t + dur + 0.8);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0, t);
			g.gain.linearRampToValueAtTime(0.03, t + 0.7);
			g.gain.setValueAtTime(0.03, t + dur - 0.05);
			g.gain.linearRampToValueAtTime(0, t + dur + 1.1);
			f.connect(g).connect(padBus);
			const voices = ([-8, 8, 0] as const).map((det) => {
				let into: AudioNode = f;
				if (det) {
					const p = ctx.createStereoPanner();
					p.pan.value = det < 0 ? -0.45 : 0.45;
					p.connect(f);
					into = p;
				}
				return { det, into };
			});
			for (const midi of notes)
				for (const { det, into } of voices) {
					const o = ctx.createOscillator();
					o.type = det ? "sawtooth" : "triangle";
					o.frequency.value = this.#hz(midi);
					o.detune.value = det;
					o.connect(into);
					o.start(t);
					o.stop(t + dur + 1.2);
				}
		};

		const arpL = ctx.createStereoPanner();
		arpL.pan.value = -0.35;
		arpL.connect(arpBus);
		const arpR = ctx.createStereoPanner();
		arpR.pan.value = 0.35;
		arpR.connect(arpBus);
		const pluck = (t: number, midi: number, right: boolean, level: number) => {
			const g = ctx.createGain();
			g.gain.setValueAtTime(0, t);
			g.gain.linearRampToValueAtTime(level, t + 0.004);
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
			g.connect(right ? arpR : arpL);
			for (const [type, mult, amt] of [
				["triangle", 1, 1],
				["sine", 2, 0.35],
			] as const) {
				const o = ctx.createOscillator();
				o.type = type;
				o.frequency.value = this.#hz(midi) * mult;
				const og = ctx.createGain();
				og.gain.value = amt;
				o.connect(og).connect(g);
				o.start(t);
				o.stop(t + 0.45);
			}
		};

		const bass = (t: number, dur: number, midi: number) => {
			const o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.value = this.#hz(midi);
			const o2 = ctx.createOscillator();
			o2.type = "triangle";
			o2.frequency.value = this.#hz(midi);
			const o2g = ctx.createGain();
			o2g.gain.value = 0.25;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0, t);
			g.gain.linearRampToValueAtTime(0.32, t + 0.012);
			g.gain.setValueAtTime(0.3, t + dur - 0.06);
			g.gain.linearRampToValueAtTime(0, t + dur);
			o.connect(g);
			o2.connect(o2g).connect(g);
			g.connect(bassBus);
			o.start(t);
			o2.start(t);
			o.stop(t + dur + 0.02);
			o2.stop(t + dur + 0.02);
		};

		const kick = (t: number) => {
			const o = ctx.createOscillator();
			o.frequency.setValueAtTime(140, t);
			o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.95, t);
			g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
			o.connect(g).connect(drumBus);
			o.start(t);
			o.stop(t + 0.45);
		};

		const hit = (
			t: number,
			type: BiquadFilterType,
			freq: number,
			level: number,
			decay: number,
		) => {
			const s = ctx.createBufferSource();
			s.buffer = noise;
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = freq;
			f.Q.value = 0.8;
			const g = ctx.createGain();
			g.gain.setValueAtTime(level, t);
			g.gain.exponentialRampToValueAtTime(0.001, t + decay);
			s.connect(f).connect(g).connect(drumBus);
			s.start(t, Math.random() * 0.5);
			s.stop(t + decay + 0.02);
		};

		const snare = (t: number) => {
			hit(t, "bandpass", 1900, 0.42, 0.2);
			const o = ctx.createOscillator();
			o.type = "triangle";
			o.frequency.setValueAtTime(210, t);
			o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.18, t);
			g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
			o.connect(g).connect(drumBus);
			o.start(t);
			o.stop(t + 0.14);
		};

		// ---- arrangement: 4 bars intro, 6 bars full, 2 bars outro
		for (let b = 0; b < this.BARS; b++) {
			const t0 = b * bar;
			const chord = song.chords[b % song.chords.length]!;
			const full = b >= 4 && b < 10;
			const intro = b < 4;

			pad(t0, bar, chord.slice(1));

			// Eighth-note arpeggio an octave up; offbeats swung.
			const tones = chord.slice(1).map((n) => n + 12);
			for (let e = 0; e < 8; e++) {
				if (intro && b < 2 && e % 2) continue; // sparser opening
				const idx = song.arp[e % song.arp.length]! % tones.length;
				const t = t0 + e * (beat / 2) + (e % 2 ? song.swing * beat : 0);
				pluck(t, tones[idx]!, e % 2 === 1, full ? 0.09 : 0.075);
			}

			if (!intro) {
				// Keep the bass in one octave (A1–G♯2) whatever the voicing.
				let root = chord[0]!;
				while (root > 44) root -= 12;
				while (root < 33) root += 12;
				bass(t0, beat * 1.4, root);
				bass(t0 + beat * 2.5, beat * 0.45, root);
				bass(t0 + beat * 3, beat * 0.9, root + (b % 2 ? 7 : 12));
			}

			if (full) {
				kick(t0);
				kick(t0 + beat * 2.5);
				if (b % 2) kick(t0 + beat * 3.75);
				snare(t0 + beat);
				snare(t0 + beat * 3);
				for (let e = 0; e < 8; e++) {
					const t = t0 + e * (beat / 2) + (e % 2 ? song.swing * beat : 0);
					hit(t, "highpass", 7500, e % 2 ? 0.06 : 0.1, 0.045);
				}
			} else if (b === 3) {
				// A single snare roll into the drop.
				for (let i = 0; i < 4; i++) snare(t0 + beat * 3 + i * (beat / 4));
			}
		}

		// Vinyl: sparse clicks over a whisper of hiss.
		if (song.crackle) {
			const vb = ctx.createBuffer(1, Math.ceil(length * this.RATE), this.RATE);
			const d = vb.getChannelData(0);
			for (let i = 0; i < d.length; i++) {
				let v = (Math.random() * 2 - 1) * 0.004;
				if (Math.random() < 0.00035) v += (Math.random() * 2 - 1) * 0.5;
				d[i] = v;
			}
			const vs = ctx.createBufferSource();
			vs.buffer = vb;
			const hp = ctx.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = 900;
			const vg = ctx.createGain();
			vg.gain.value = 0.55;
			vs.connect(hp).connect(vg).connect(mix);
			vs.start(0);
		}

		return ctx.startRendering();
	}

	/** 16-bit PCM WAV with a LIST/INFO chunk so the song carries its tags. */
	static wav(
		buf: AudioBuffer,
		tags: { title: string; artist: string; album: string },
	): Blob {
		const ch = buf.numberOfChannels;
		const n = buf.length;
		const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
		let peak = 0;
		for (const d of chans)
			for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]!));
		const norm = peak > 0 ? 0.89 / peak : 1;

		const enc = new TextEncoder();
		const info: Uint8Array[] = [];
		for (const [id, val] of [
			["INAM", tags.title],
			["IART", tags.artist],
			["IPRD", tags.album],
			["ISFT", "Aether"],
		] as const) {
			const text = enc.encode(val + "\u0000");
			const padded = new Uint8Array(8 + text.length + (text.length & 1));
			padded.set(enc.encode(id), 0);
			new DataView(padded.buffer).setUint32(4, text.length, true);
			padded.set(text, 8);
			info.push(padded);
		}
		const infoLen = 4 + info.reduce((s, c) => s + c.length, 0);
		const dataLen = n * ch * 2;
		const total = 12 + 24 + 8 + infoLen + 8 + dataLen;
		const out = new Uint8Array(total);
		const v = new DataView(out.buffer);
		let o = 0;
		const str = (s: string) => {
			out.set(enc.encode(s), o);
			o += s.length;
		};
		const u32 = (x: number) => {
			v.setUint32(o, x, true);
			o += 4;
		};
		const u16 = (x: number) => {
			v.setUint16(o, x, true);
			o += 2;
		};
		str("RIFF");
		u32(total - 8);
		str("WAVE");
		str("fmt ");
		u32(16);
		u16(1);
		u16(ch);
		u32(buf.sampleRate);
		u32(buf.sampleRate * ch * 2);
		u16(ch * 2);
		u16(16);
		str("LIST");
		u32(infoLen);
		str("INFO");
		for (const c of info) {
			out.set(c, o);
			o += c.length;
		}
		str("data");
		u32(dataLen);
		for (let i = 0; i < n; i++)
			for (let c = 0; c < ch; c++) {
				const s = Math.max(-1, Math.min(1, chans[c]![i]! * norm));
				v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
				o += 2;
			}
		return new Blob([out], { type: "audio/wav" });
	}

	/**
	 * Render and save the whole album. Each OfflineAudioContext renders on its
	 * own audio thread, so the songs are composed side by side; `onProgress`
	 * hears about each one as it lands on disk.
	 */
	static async makeAlbum(onProgress?: (done: number, total: number) => void) {
		try {
			await new anura.fs.Shell().promises.mkdirp(AetherMusic.DIR);
		} catch {
			/* exists */
		}
		const total = AETHER_DEMO_SONGS.length;
		let done = 0;
		onProgress?.(0, total);
		await Promise.all(
			AETHER_DEMO_SONGS.map(async (song, i) => {
				const buf = await this.render(song);
				const blob = this.wav(buf, {
					title: song.title,
					artist: "Aether",
					album: AETHER_DEMO_ALBUM,
				});
				await anura.fs.promises.writeFile(
					`${AetherMusic.DIR}/${String(i + 1).padStart(2, "0")} ${song.title}.wav`,
					new Uint8Array(await blob.arrayBuffer()) as any,
				);
				onProgress?.(++done, total);
			}),
		);
		await AetherMusic.scan();
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherMusicDemo = AetherMusicDemo;
