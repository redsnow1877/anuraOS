#!/usr/bin/env node
/* global process, Buffer */
// Dimension relay
// ---------------------------------------------------------------------------
// The browser inside Dimension can't open network connections on its own (no
// web page can), so it sends them through a relay: a tiny server that opens
// them on its behalf and passes the bytes back and forth. This is that
// server, for your own computer. It speaks Wisp (the protocol anuraOS uses),
// needs nothing but Node.js, and has no dependencies.
//
//   node dimension-relay.mjs                listen on ws://localhost:7171
//   node dimension-relay.mjs --port 9000
//   node dimension-relay.mjs --origin https://example.com   allow another site
//   node dimension-relay.mjs --any-origin                   allow every site
//   node dimension-relay.mjs --allow-private                reach your LAN too
//
// Safe by default:
//   - it only listens on this computer (127.0.0.1), not your network;
//   - only Dimension's own site (and localhost) may use it. Any other page
//     you visit is turned away, so it can't borrow your connection;
//   - it won't connect to private addresses (your router, other devices,
//     this machine) unless you pass --allow-private. Addresses are checked
//     after DNS, and the connection goes to the address that was checked.

import http from "node:http";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns/promises";
import { createHash } from "node:crypto";

const VERSION = "1.0.0";

/* ---- options ------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const many = (name) =>
	args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

if (flag("--help") || flag("-h")) {
	console.log(`Dimension relay ${VERSION}

  --port <n>          port to listen on (default 7171)
  --host <addr>       address to listen on (default 127.0.0.1)
  --origin <url>      also allow this site (repeatable)
  --any-origin        allow any site to use the relay
  --allow-private     allow connections to private and local addresses
  --quiet             don't log each connection`);
	process.exit(0);
}

const PORT = Number(opt("--port", process.env.PORT || 7171));
const HOST = opt("--host", "127.0.0.1");
const ANY_ORIGIN = flag("--any-origin");
const ALLOW_PRIVATE = flag("--allow-private");
const QUIET = flag("--quiet");
const ORIGINS = new Set([
	"https://redsnow1877.github.io",
	...many("--origin").map((o) => o.replace(/\/+$/, "")),
]);

function originAllowed(origin) {
	if (ANY_ORIGIN) return true;
	if (!origin) return true; // not a browser: a local program, which could
	// reach the internet without us anyway
	try {
		const u = new URL(origin);
		if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return true;
	} catch {
		return false;
	}
	return ORIGINS.has(origin);
}

/* ---- private address check ---------------------------------------------- */

function v4ToInt(ip) {
	return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKED = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
].map(([base, bits]) => [
	v4ToInt(base),
	bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0,
]);

function isPrivate(ip) {
	if (net.isIPv4(ip)) {
		const n = v4ToInt(ip);
		return V4_BLOCKED.some(([base, mask]) => (n & mask) >>> 0 === base);
	}
	const v6 = ip.toLowerCase();
	const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivate(mapped[1]);
	return (
		v6 === "::" ||
		v6 === "::1" ||
		/^f[cd]/.test(v6) || // unique local
		/^fe[89ab]/.test(v6) || // link local
		/^ff/.test(v6) // multicast
	);
}

async function resolve(host) {
	if (net.isIP(host)) return host;
	const all = await dns.lookup(host, { all: true, verbatim: true });
	if (!all.length)
		throw Object.assign(new Error("no address"), { reason: 0x42 });
	return all[0].address;
}

/* ---- WebSocket, just enough of it --------------------------------------- */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class WsConnection {
	constructor(socket, onMessage, onClose) {
		this.socket = socket;
		this.onMessage = onMessage;
		this.onClose = onClose;
		this.buf = Buffer.alloc(0);
		this.fragments = [];
		this.closed = false;
		socket.setNoDelay(true);
		socket.on("data", (d) => this.#feed(d));
		socket.on("close", () => this.#gone());
		socket.on("error", () => this.#gone());
	}

	#gone() {
		if (this.closed) return;
		this.closed = true;
		this.onClose();
	}

	#feed(chunk) {
		this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
		for (;;) {
			const b = this.buf;
			if (b.length < 2) return;
			const fin = (b[0] & 0x80) !== 0;
			const op = b[0] & 0x0f;
			const masked = (b[1] & 0x80) !== 0;
			let len = b[1] & 0x7f;
			let at = 2;
			if (len === 126) {
				if (b.length < 4) return;
				len = b.readUInt16BE(2);
				at = 4;
			} else if (len === 127) {
				if (b.length < 10) return;
				const big = b.readBigUInt64BE(2);
				if (big > 64n * 1024n * 1024n) return this.close(1009);
				len = Number(big);
				at = 10;
			}
			if (!masked) return this.close(1002); // clients must mask
			if (b.length < at + 4 + len) return;
			const mask = b.subarray(at, at + 4);
			const payload = Buffer.from(b.subarray(at + 4, at + 4 + len));
			for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
			this.buf = b.subarray(at + 4 + len);

			if (op === 0x8) return this.close(1000);
			if (op === 0x9) {
				this.#frame(0xa, payload);
				continue;
			}
			if (op === 0xa) continue;
			if (op === 0x0 || op === 0x1 || op === 0x2) {
				this.fragments.push(payload);
				if (fin) {
					const msg =
						this.fragments.length === 1
							? this.fragments[0]
							: Buffer.concat(this.fragments);
					this.fragments = [];
					this.onMessage(msg);
				}
			}
		}
	}

	#frame(op, payload) {
		if (this.closed) return true;
		const len = payload.length;
		let head;
		if (len < 126) head = Buffer.from([0x80 | op, len]);
		else if (len < 65536) {
			head = Buffer.alloc(4);
			head[0] = 0x80 | op;
			head[1] = 126;
			head.writeUInt16BE(len, 2);
		} else {
			head = Buffer.alloc(10);
			head[0] = 0x80 | op;
			head[1] = 127;
			head.writeBigUInt64BE(BigInt(len), 2);
		}
		this.socket.write(head);
		return this.socket.write(payload);
	}

	send(payload) {
		return this.#frame(0x2, payload);
	}

	close(code = 1000) {
		if (this.closed) return;
		const p = Buffer.alloc(2);
		p.writeUInt16BE(code);
		try {
			this.#frame(0x8, p);
			this.socket.end();
		} catch {
			/* already gone */
		}
		this.#gone();
	}
}

/* ---- Wisp v1 ------------------------------------------------------------- */

const CONNECT = 1;
const DATA = 2;
const CONTINUE = 3;
const CLOSE = 4;
const BUFFER = 128;

function packet(type, id, payload = Buffer.alloc(0)) {
	const head = Buffer.alloc(5);
	head[0] = type;
	head.writeUInt32LE(id, 1);
	return Buffer.concat([head, payload]);
}

function u32(n) {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(n);
	return b;
}

const stats = { sessions: 0, streams: 0, up: 0, down: 0 };

function wispSession(ws, label) {
	const streams = new Map();
	const sendClose = (id, reason) =>
		ws.send(packet(CLOSE, id, Buffer.from([reason])));

	const end = (id, reason) => {
		const s = streams.get(id);
		if (!s) return;
		streams.delete(id);
		stats.streams--;
		try {
			s.kind === "tcp" ? s.sock.destroy() : s.sock.close();
		} catch {
			/* gone */
		}
		if (reason !== undefined) sendClose(id, reason);
	};

	async function open(id, type, port, host) {
		if (type !== 1 && type !== 2) return sendClose(id, 0x41);
		if (!host || !port) return sendClose(id, 0x41);
		if (port === 25) return sendClose(id, 0x48); // no mail relaying
		let addr;
		try {
			addr = await resolve(host);
		} catch {
			return sendClose(id, 0x42);
		}
		if (!ALLOW_PRIVATE && isPrivate(addr)) {
			if (!QUIET) console.log(`  blocked  ${host}:${port} (private address)`);
			return sendClose(id, 0x48);
		}
		if (ws.closed) return;
		stats.streams++;

		if (type === 2) {
			const sock = dgram.createSocket(net.isIPv6(addr) ? "udp6" : "udp4");
			const s = { kind: "udp", sock, addr, port };
			streams.set(id, s);
			sock.on("message", (m) => {
				stats.down += m.length;
				ws.send(packet(DATA, id, m));
			});
			sock.on("error", () => end(id, 0x03));
			return;
		}

		const sock = net.connect({ host: addr, port });
		const s = { kind: "tcp", sock, pending: [], ready: false, count: 0 };
		streams.set(id, s);
		sock.setNoDelay(true);
		const timer = setTimeout(() => {
			if (!s.ready) end(id, 0x43);
		}, 15000);
		sock.on("connect", () => {
			clearTimeout(timer);
			s.ready = true;
			for (const d of s.pending) sock.write(d);
			s.pending = [];
			if (!QUIET) console.log(`  open     ${host}:${port}`);
		});
		sock.on("data", (d) => {
			stats.down += d.length;
			// Back-pressure: if the browser end is backed up, stop reading
			// from the site until it drains.
			if (!ws.send(packet(DATA, id, d))) {
				sock.pause();
				ws.socket.once("drain", () => sock.resume());
			}
		});
		sock.on("error", (e) => {
			clearTimeout(timer);
			end(
				id,
				e.code === "ECONNREFUSED" ? 0x44 : e.code === "ETIMEDOUT" ? 0x43 : 0x03,
			);
		});
		sock.on("close", () => {
			clearTimeout(timer);
			end(id, 0x02);
		});
	}

	ws.onMessage = (msg) => {
		if (msg.length < 5) return;
		const type = msg[0];
		const id = msg.readUInt32LE(1);
		const body = msg.subarray(5);
		if (type === CONNECT) {
			if (body.length < 3) return sendClose(id, 0x41);
			const st = body[0];
			const port = body.readUInt16LE(1);
			const host = body.subarray(3).toString("utf8");
			open(id, st, port, host);
		} else if (type === DATA) {
			const s = streams.get(id);
			if (!s) return;
			stats.up += body.length;
			if (s.kind === "udp") {
				s.sock.send(body, s.port, s.addr);
				return;
			}
			const flushed = () => {
				// Tell the browser it may send more once half its window is
				// written out.
				if (++s.count >= BUFFER / 2 && streams.has(id)) {
					s.count = 0;
					ws.send(packet(CONTINUE, id, u32(BUFFER)));
				}
			};
			if (s.ready) s.sock.write(body, flushed);
			else {
				s.pending.push(body);
				flushed();
			}
		} else if (type === CLOSE) {
			end(id);
		}
	};

	ws.onClose = () => {
		for (const id of [...streams.keys()]) end(id);
		stats.sessions--;
		if (!QUIET) console.log(`- session closed (${label})`);
	};

	stats.sessions++;
	if (!QUIET) console.log(`+ session from ${label}`);
	// A Wisp server speaks first: stream 0's buffer size.
	ws.send(packet(CONTINUE, 0, u32(BUFFER)));
}

/* ---- server -------------------------------------------------------------- */

const page = `<!doctype html><meta charset="utf-8"><title>Dimension relay</title>
<body style="font:15px system-ui;background:#0b0b12;color:#e8e6ff;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:42px">&#9649;</div>
<h2 style="margin:8px 0">Dimension relay is running</h2>
<p style="opacity:.7">Version ${VERSION}. Open Dimension and the browser will find it.</p></div>`;

const server = http.createServer((req, res) => {
	res.writeHead(200, {
		"content-type": "text/html; charset=utf-8",
		"access-control-allow-origin": "*",
	});
	res.end(page);
});

server.on("upgrade", (req, socket) => {
	const origin = req.headers.origin;
	const key = req.headers["sec-websocket-key"];
	if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket") {
		socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
		return;
	}
	if (!originAllowed(origin)) {
		if (!QUIET) console.log(`  refused  ${origin} (not an allowed site)`);
		socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
		return;
	}
	const accept = createHash("sha1")
		.update(key + WS_GUID)
		.digest("base64");
	socket.write(
		"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
	);
	const ws = new WsConnection(
		socket,
		() => {},
		() => {},
	);
	wispSession(ws, origin || "a local program");
});

server.on("error", (e) => {
	if (e.code === "EADDRINUSE")
		console.error(
			`\nPort ${PORT} is already in use. Is the relay already running?\n`,
		);
	else console.error(e);
	process.exit(1);
});

server.listen(PORT, HOST, () => {
	const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
	console.log(
		[
			"",
			c("38;5;189", "      ▄▀▀▄"),
			c("38;5;141", "    ▄▀▄▄▄▄▀▄") +
				"    " +
				c("1", "Dimension relay ") +
				c("2", VERSION),
			c("38;5;99", "    █▀▀▄▄▀▀█") +
				"    listening on " +
				c("1;38;5;141", `ws://localhost:${PORT}/`),
			c("38;5;61", "     ▀▄▄▄▄▀") +
				"     " +
				c(
					"2",
					ALLOW_PRIVATE
						? "private addresses allowed"
						: "private addresses blocked",
				),
			"",
			"  Leave this window open while you browse in Dimension. Ctrl+C stops it.",
			"",
		].join("\n"),
	);
});

// A one-line pulse every minute while something is connected.
setInterval(() => {
	if (QUIET || !stats.sessions) return;
	const mb = (n) => (n / 1048576).toFixed(1) + " MB";
	console.log(
		`  ${stats.sessions} session(s), ${stats.streams} connection(s) open · ↑ ${mb(stats.up)} ↓ ${mb(stats.down)}`,
	);
}, 60000).unref();
