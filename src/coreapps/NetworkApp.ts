/**
 * Network — every connection Dimension makes, live.
 *
 * Reads DimensionNet (networking/NetLog.ts): a minute of throughput as a
 * graph, the connections as a table (newest first), and the first bytes of
 * the selected one as a hex dump, where a TLS ClientHello's SNI and ALPN
 * show up in the clear.
 */
class NetworkApp extends App {
	name = "Network";
	package = "anura.network";
	icon = "/assets/icons/network.svg";

	#selected = -1;
	#filter = "";

	constructor() {
		super();
	}

	async open(): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "",
			width: "860px",
			height: "560px",
			resizable: true,
		});
		win.content.append(this.#build(win));
		return win;
	}

	#build(win: WMWindow): HTMLElement {
		const root = document.createElement("div");
		root.className = "netapp";
		root.innerHTML = `
			<div class="net-top">
				<canvas class="net-graph"></canvas>
				<div class="net-stats">
					<div><span class="net-k">Up</span><b class="net-up">0 B/s</b></div>
					<div><span class="net-k">Down</span><b class="net-down">0 B/s</b></div>
					<div><span class="net-k">Open</span><b class="net-open">0</b></div>
					<div><span class="net-k">Relay</span><b class="net-relay">…</b></div>
				</div>
			</div>
			<div class="net-tools">
				<input class="net-filter" placeholder="Filter by host, port or protocol" spellcheck="false" />
				<button class="net-btn net-pause"><span class="material-symbols-outlined">pause</span>Pause</button>
				<button class="net-btn net-clear"><span class="material-symbols-outlined">delete_sweep</span>Clear closed</button>
			</div>
			<div class="net-table">
				<div class="net-row net-head"><span></span><span>Proto</span><span>Host</span><span>Port</span><span>Says</span><span>Sent</span><span>Received</span><span>Time</span></div>
				<div class="net-rows"></div>
			</div>
			<div class="net-detail"></div>`;

		const rows = root.querySelector<HTMLElement>(".net-rows")!;
		const detail = root.querySelector<HTMLElement>(".net-detail")!;
		const canvas = root.querySelector<HTMLCanvasElement>(".net-graph")!;
		const filter = root.querySelector<HTMLInputElement>(".net-filter")!;
		const pause = root.querySelector<HTMLButtonElement>(".net-pause")!;

		filter.addEventListener("input", () => {
			this.#filter = filter.value.trim().toLowerCase();
			renderRows();
		});
		pause.addEventListener("click", () => {
			DimensionNet.paused = !DimensionNet.paused;
			pause.innerHTML = DimensionNet.paused
				? '<span class="material-symbols-outlined">play_arrow</span>Resume'
				: '<span class="material-symbols-outlined">pause</span>Pause';
		});
		root
			.querySelector(".net-clear")!
			.addEventListener("click", () => DimensionNet.clear());
		rows.addEventListener("click", (e) => {
			const r = (e.target as Element).closest<HTMLElement>("[data-id]");
			if (!r) return;
			this.#selected = Number(r.dataset.id);
			renderRows();
			renderDetail();
		});

		const size = (n: number) =>
			n >= 1048576
				? (n / 1048576).toFixed(1) + " MB"
				: n >= 1024
					? (n / 1024).toFixed(1) + " KB"
					: n + " B";
		const ago = (c: NetConn) => {
			const ms = (c.closed || Date.now()) - c.opened;
			return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s";
		};
		const esc = (s: string) =>
			s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

		const renderRows = () => {
			const list = [...DimensionNet.conns.values()].reverse().filter((c) => {
				const f = this.#filter;
				return (
					!f ||
					c.host.toLowerCase().includes(f) ||
					c.sni.toLowerCase().includes(f) ||
					String(c.port) === f ||
					c.proto.toLowerCase() === f
				);
			});
			rows.innerHTML =
				list
					.slice(0, 300)
					.map((c) => {
						const says = c.sni
							? `TLS${c.alpn ? " · " + c.alpn.split(", ")[0] : ""}`
							: c.http
								? c.http.split(" ").slice(0, 2).join(" ")
								: "";
						return `<div class="net-row${c.id === this.#selected ? " is-on" : ""}${c.closed ? " is-closed" : ""}" data-id="${c.id}">
						<span><i class="net-dot"></i></span>
						<span>${c.proto}</span>
						<span class="net-host" title="${esc(c.host)}">${esc(c.host)}</span>
						<span>${c.port}</span>
						<span>${esc(says)}</span>
						<span>${size(c.up)}</span>
						<span>${size(c.down)}</span>
						<span>${c.closed ? ago(c) : "live"}</span>
					</div>`;
					})
					.join("") ||
				`<div class="net-empty">Nothing yet. Open a page in the browser and watch it connect.</div>`;
		};

		const hexdump = (b: Uint8Array | null) => {
			if (!b || !b.length) return '<div class="net-empty">No data yet.</div>';
			const lines: string[] = [];
			for (let i = 0; i < Math.min(b.length, 256); i += 16) {
				const chunk = Array.from(b.subarray(i, i + 16));
				const hex = chunk.map((x) => x.toString(16).padStart(2, "0")).join(" ");
				const ascii = chunk
					.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : "."))
					.join("");
				lines.push(
					`<span class="net-off">${i.toString(16).padStart(4, "0")}</span>  ${hex.padEnd(47)}  <span class="net-ascii">${esc(ascii)}</span>`,
				);
			}
			return `<pre>${lines.join("\n")}</pre>`;
		};

		const renderDetail = () => {
			const c = DimensionNet.conns.get(this.#selected);
			root.classList.toggle("has-detail", !!c);
			if (!c) return;
			const facts = [
				["Connection", `#${c.id} · ${c.proto} to ${esc(c.host)}:${c.port}`],
				["Opened", new Date(c.opened).toLocaleTimeString()],
				["Duration", c.closed ? ago(c) : "still open"],
				c.sni ? ["TLS server name", esc(c.sni)] : null,
				c.alpn ? ["Protocols offered", esc(c.alpn)] : null,
				c.http ? ["Request", esc(c.http)] : null,
				c.closed
					? [
							"Closed",
							`reason 0x${c.reason.toString(16).padStart(2, "0")}${c.reason === 2 ? " (normal)" : ""}`,
						]
					: null,
			].filter(Boolean) as string[][];
			detail.innerHTML = `
				<div class="net-facts">${facts.map(([k, v]) => `<div><span class="net-k">${k}</span>${v}</div>`).join("")}</div>
				<div class="net-dumps">
					<div><div class="net-k">First bytes sent</div>${hexdump(c.firstOut)}</div>
					<div><div class="net-k">First bytes received</div>${hexdump(c.firstIn)}</div>
				</div>`;
		};

		const drawGraph = () => {
			const dpr = devicePixelRatio || 1;
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			if (!w || !h) return;
			if (canvas.width !== Math.round(w * dpr)) {
				canvas.width = Math.round(w * dpr);
				canvas.height = Math.round(h * dpr);
			}
			const g = canvas.getContext("2d")!;
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, w, h);
			const s = DimensionNet.series();
			const max = Math.max(4096, ...s.map(([u, d]) => Math.max(u, d)));
			g.strokeStyle = "rgba(255,255,255,0.07)";
			g.lineWidth = 1;
			for (let i = 1; i < 4; i++) {
				const y = Math.round((h * i) / 4) + 0.5;
				g.beginPath();
				g.moveTo(0, y);
				g.lineTo(w, y);
				g.stroke();
			}
			const accent =
				getComputedStyle(document.documentElement)
					.getPropertyValue("--theme-accent")
					.trim() || "#7a6cff";
			const plot = (idx: 0 | 1, color: string) => {
				g.beginPath();
				s.forEach((p, i) => {
					const x = (i / (s.length - 1)) * w;
					const y = h - 4 - (p[idx] / max) * (h - 12);
					if (i) g.lineTo(x, y);
					else g.moveTo(x, y);
				});
				g.strokeStyle = color;
				g.lineWidth = 2;
				g.lineJoin = "round";
				g.stroke();
				g.lineTo(w, h);
				g.lineTo(0, h);
				g.closePath();
				const fill = g.createLinearGradient(0, 0, 0, h);
				fill.addColorStop(0, color + "55");
				fill.addColorStop(1, color + "00");
				g.fillStyle = fill;
				g.fill();
			};
			plot(1, "#34d399");
			plot(0, accent.length === 7 ? accent : "#7a6cff");
			g.fillStyle = "rgba(255,255,255,0.45)";
			g.font = "11px system-ui";
			g.fillText(size(max) + "/s", 6, 14);
			g.fillText("60 s", w - 30, h - 6);
		};

		const renderStats = () => {
			const sm = DimensionNet.summary();
			root.querySelector(".net-up")!.textContent = size(sm.upRate) + "/s";
			root.querySelector(".net-down")!.textContent = size(sm.downRate) + "/s";
			root.querySelector(".net-open")!.textContent =
				`${sm.open} of ${sm.total}`;
			const R = (globalThis as any).DimensionRelay;
			root.querySelector(".net-relay")!.textContent = R
				? `${R.name(R.current)}${R.latency != null ? ` · ${R.latency} ms` : ""}`
				: "unknown";
		};

		const onChange = () => {
			if (!root.isConnected) return;
			renderRows();
			renderStats();
			if (this.#selected >= 0) renderDetail();
		};
		DimensionNet.events.addEventListener("change", onChange);
		const timer = setInterval(() => {
			if (!root.isConnected) {
				clearInterval(timer);
				DimensionNet.events.removeEventListener("change", onChange);
				return;
			}
			drawGraph();
			renderStats();
		}, 1000);
		requestAnimationFrame(() => {
			renderRows();
			renderStats();
			drawGraph();
		});
		void win;
		return root;
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).NetworkApp = NetworkApp;
