/**
 * Merge runs of compiled scripts in a built index.html into bundles.
 *
 *   node tools/bundle-scripts.mjs <static-dir>
 *
 * Aether ships as ~95 classic <script> tags. Every one is served by the
 * service worker out of IndexedDB, and those reads queue up: on a warm boot
 * the last script only arrives ~700 ms in, and nothing can start before that.
 * Merging each run of adjacent compiled scripts into one file turns ~85 reads
 * into a handful.
 *
 * Concatenating classic scripts keeps their meaning (they already share one
 * global scope) with two caveats this respects:
 *   - a "use strict" at the top applies to the whole file, so only files that
 *     are already strict are merged; anything else breaks the run;
 *   - order is everything, so only adjacent tags are merged; any other script
 *     between two of them (a vendored library, a module) breaks the run.
 * Tags inside HTML comments are ignored. The unbundled files stay in place.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node tools/bundle-scripts.mjs <static-dir>");
	process.exit(1);
}

const htmlPath = join(dir, "index.html");
const html = readFileSync(htmlPath, "utf8");
// Blank out comments (keeping offsets) so commented-out tags don't count.
const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));

const tags = [];
for (const m of masked.matchAll(/<script\b([^>]*)>\s*<\/script>/g)) {
	const attrs = m[1];
	const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1] || "";
	const classic = /\btype="text\/javascript"/.test(attrs);
	let code = null;
	if (classic && /^lib\/.+\.js$/.test(src) && existsSync(join(dir, src))) {
		const text = readFileSync(join(dir, src), "utf8");
		if (/^\s*"use strict";/.test(text)) code = text;
	}
	tags.push({ start: m.index, end: m.index + m[0].length, src, code });
}

// Runs: consecutive bundlable tags with only whitespace between them.
const runs = [];
let run = [];
for (let i = 0; i < tags.length; i++) {
	const t = tags[i];
	const prev = run[run.length - 1];
	const adjacent = prev && masked.slice(prev.end, t.start).trim() === "";
	if (t.code && (!prev || adjacent)) run.push(t);
	else {
		if (run.length > 1) runs.push(run);
		run = t.code ? [t] : [];
	}
}
if (run.length > 1) runs.push(run);

let out = html;
const bundles = [];
// Replace from the end so earlier offsets stay valid.
runs.reverse().forEach((r, i) => {
	const name = `lib/aether-${runs.length - i}.bundle.js`;
	const body = r
		.map(
			(t) =>
				`// ---- ${t.src}\n` +
				// Per-file source maps would mislabel the whole bundle.
				t.code.replace(/^\/\/# sourceMappingURL=.*$/gm, "").trimEnd(),
		)
		.join("\n;\n");
	writeFileSync(join(dir, name), body + "\n");
	out =
		out.slice(0, r[0].start) +
		`<script type="text/javascript" src="${name}"></script>` +
		out.slice(r[r.length - 1].end);
	bundles.push({ name, files: r.length, kb: Math.round(body.length / 1024) });
});
writeFileSync(htmlPath, out);

// Let offline mode preload the bundles like any other file.
const cachePath = join(dir, "cache-load.json");
if (existsSync(cachePath)) {
	const list = JSON.parse(readFileSync(cachePath, "utf8"));
	for (const b of bundles) if (!list.includes(b.name)) list.push(b.name);
	writeFileSync(cachePath, JSON.stringify(list));
}

const merged = bundles.reduce((n, b) => n + b.files, 0);
console.log(
	`bundle-scripts: ${merged} scripts -> ${bundles.length} bundles ` +
		bundles
			.reverse()
			.map((b) => `(${b.name}: ${b.files} files, ${b.kb} KB)`)
			.join(" "),
);
