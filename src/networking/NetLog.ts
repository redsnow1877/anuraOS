/**
 * Dimension — the network recorder
 * ---------------------------------------------------------------------------
 * Every connection that leaves Dimension goes through the Wisp bus as a
 * stream: a CONNECT naming the host and port, DATA both ways, then a CLOSE.
 * WispBus reports those here, and this keeps the last few hundred
 * connections with their byte counts and timing for the Network app and
 * `top`.
 *
 * Most traffic is TLS, encrypted inside Dimension before it reaches the bus,
 * so there are no URLs or contents to show. What a TLS connection does say
 * in the clear is its first message, the ClientHello, which names the site
 * it's for (SNI) and the protocols it wants (ALPN). That's read here, the
 * way a packet sniffer would. Plain HTTP shows its request line.
 */

interface NetConn {
	id: number;
	host: string;
	port: number;
	proto: "TCP" | "UDP";
	opened: number;
	closed: number;
	up: number;
	down: number;
	reason: number;
	/** What the first bytes say: a TLS ClientHello's SNI, or an HTTP line. */
	sni: string;
	alpn: string;
	http: string;
	firstOut: Uint8Array | null;
	firstIn: Uint8Array | null;
}

class DimensionNet {
	static readonly KEEP = 400;
	static conns = new Map<number, NetConn>();
	static events = new EventTarget();
	/** Bytes per second for the last minute: [up, down], newest last. */
	static #secs: Array<[number, number]> = Array.from({ length: 60 }, () => [
		0, 0,
	]);
	static #sec = Math.floor(Date.now() / 1000);
	static #queued = false;
	static paused = false;

	static #tick() {
		const now = Math.floor(Date.now() / 1000);
		while (this.#sec < now) {
			this.#secs.push([0, 0]);
			if (this.#secs.length > 60) this.#secs.shift();
			this.#sec++;
		}
	}

	static #changed() {
		if (this.#queued) return;
		this.#queued = true;
		setTimeout(() => {
			this.#queued = false;
			this.events.dispatchEvent(new Event("change"));
		}, 200);
	}

	static open(id: number, host: string, port: number, type: number) {
		if (this.paused) return;
		this.conns.set(id, {
			id,
			host,
			port,
			proto: type === 2 ? "UDP" : "TCP",
			opened: Date.now(),
			closed: 0,
			up: 0,
			down: 0,
			reason: 0,
			sni: "",
			alpn: "",
			http: "",
			firstOut: null,
			firstIn: null,
		});
		if (this.conns.size > this.KEEP) {
			for (const [k, c] of this.conns) {
				if (this.conns.size <= this.KEEP) break;
				if (c.closed) this.conns.delete(k);
			}
		}
		this.#changed();
	}

	static data(id: number, dir: "up" | "down", payload: Uint8Array) {
		this.#tick();
		const slot = this.#secs[this.#secs.length - 1]!;
		slot[dir === "up" ? 0 : 1] += payload.length;
		const c = this.conns.get(id);
		if (!c) return;
		c[dir] += payload.length;
		if (dir === "up" && !c.firstOut) {
			c.firstOut = payload.slice(0, 512);
			this.#sniff(c, payload);
		} else if (dir === "down" && !c.firstIn) c.firstIn = payload.slice(0, 512);
		this.#changed();
	}

	static close(id: number, reason: number) {
		const c = this.conns.get(id);
		if (!c || c.closed) return;
		c.closed = Date.now();
		c.reason = reason;
		this.#changed();
	}

	static clear() {
		for (const [k, c] of this.conns) if (c.closed) this.conns.delete(k);
		this.#changed();
	}

	static summary() {
		this.#tick();
		let open = 0;
		for (const c of this.conns.values()) if (!c.closed) open++;
		// The last full second and the one in progress, averaged.
		const [a, b] = [
			this.#secs[this.#secs.length - 2]!,
			this.#secs[this.#secs.length - 1]!,
		];
		return {
			open,
			total: this.conns.size,
			upRate: (a[0] + b[0]) / 2,
			downRate: (a[1] + b[1]) / 2,
		};
	}

	static series(): Array<[number, number]> {
		this.#tick();
		return this.#secs.map((s) => [s[0], s[1]]);
	}

	/** Read the SNI and ALPN out of a TLS ClientHello, or an HTTP request line. */
	static #sniff(c: NetConn, p: Uint8Array) {
		try {
			if (p[0] === 0x16 && p[5] === 0x01) {
				// record(5) handshake(4) version(2) random(32)
				let i = 5 + 4 + 2 + 32;
				i += 1 + p[i]!; // session id
				i += 2 + ((p[i]! << 8) | p[i + 1]!); // cipher suites
				i += 1 + p[i]!; // compression
				const end = i + 2 + ((p[i]! << 8) | p[i + 1]!);
				i += 2;
				while (i + 4 <= end && i + 4 <= p.length) {
					const type = (p[i]! << 8) | p[i + 1]!;
					const len = (p[i + 2]! << 8) | p[i + 3]!;
					const body = p.subarray(i + 4, i + 4 + len);
					if (type === 0 && body.length > 5) {
						const n = (body[3]! << 8) | body[4]!;
						c.sni = new TextDecoder().decode(body.subarray(5, 5 + n));
					} else if (type === 16 && body.length > 2) {
						const names: string[] = [];
						let j = 2;
						while (j < body.length) {
							const n = body[j]!;
							names.push(
								new TextDecoder().decode(body.subarray(j + 1, j + 1 + n)),
							);
							j += 1 + n;
						}
						c.alpn = names.join(", ");
					}
					i += 4 + len;
				}
			} else {
				const head = new TextDecoder().decode(p.subarray(0, 120));
				const line = head.split("\r\n")[0] || "";
				if (/^[A-Z]+ \S+ HTTP\/\d/.test(line)) c.http = line;
			}
		} catch {
			/* not something we can read */
		}
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).DimensionNet = DimensionNet;
