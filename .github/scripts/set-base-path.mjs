#!/usr/bin/env node
/**
 * Rewrites a built `static/` tree so it can be served from a sub-path.
 *
 * GitHub Pages serves a project site at `https://<user>.github.io/<repo>/`, but
 * the app is written assuming it owns the origin root. Relative references
 * (`<script src="lib/…">`) already resolve correctly under a sub-path; this
 * script fixes the absolute ones.
 *
 *   node .github/scripts/set-base-path.mjs static /anuraos/
 *
 * Two things it deliberately does NOT do:
 *
 *   1. It never rewrites a bare `/`-prefixed path that isn't on the allowlist
 *      below. Several root-looking paths in this codebase are *not* URLs —
 *      `/usr`, `/opt`, `/tmp`, `/anura_files` are virtual-filesystem paths, and
 *      `/bin/ash`, `/bin/bash` are paths inside the emulated x86 guest.
 *      Rewriting those would break the VM and the filesystem.
 *   2. It doesn't blindly rewrite the service worker's `pathname === "/"`
 *      comparisons. Those are handled as named patches, because under a
 *      sub-path the worker must compare against the scope root instead.
 *
 * After rewriting it re-scans and fails loudly if an allowlisted prefix was
 * missed, so a silent half-rewrite can't ship.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const [, , ROOT, RAW_BASE] = process.argv;
if (!ROOT) {
	console.error("usage: set-base-path.mjs <static-dir> [/base/]");
	process.exit(1);
}

// actions/configure-pages reports an empty base_path for a site served from the
// origin root (a user/org site, or a custom domain), which is the same case as
// an explicit "/". Trim first and rebuild, so an empty value yields "/" rather
// than the "//" that concatenating slashes around it would give.
const trimmed = (RAW_BASE || "").replace(/^\/+|\/+$/g, "");
const BASE = trimmed ? `/${trimmed}/` : "/";
if (BASE === "/") {
	console.log("base is root, nothing to rewrite");
	process.exit(0);
}

/** Top-level directories in the build output that are always URLs. */
const DIRS = [
	"assets",
	"libs",
	"lib",
	"uv",
	"bios",
	"x86images",
	"apps",
	"artifacts",
];

/**
 * Virtual routes served by the service worker rather than by files on disk.
 * The worker's own route patterns are unanchored regexes, so they still match
 * once the scope moves under a sub-path — but callers that request them with a
 * leading slash would escape the scope entirely and hit the real server. In
 * particular Boot.tsx probes `fetch("/fs/")` to decide whether the worker is
 * alive, and a 404 there drops the whole desktop into safe mode.
 */
const ROUTES = [
	"fs",
	"dav",
	"blob",
	"display",
	"extension",
	"service",
	"showFilePicker",
];

/** Top-level files in the build output that are always URLs. */
const FILES = [
	"bundle.css",
	"theme.css",
	"config.json",
	"cache-load.json",
	"MILESTONE",
	"manifest.json",
	"anura-sw.js",
	"index.html",
	"icon.png",
	"icon_dark.png",
	"pwa_icon.png",
	"mw_icon.png",
	"mw_icon_colored.png",
];

const TEXT_EXT = new Set([
	".html",
	".htm",
	".js",
	".mjs",
	".cjs",
	".css",
	".json",
	".ajs",
	".webmanifest",
	".map",
	".svg",
]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
 * Only rewrite a path that directly follows a string or call delimiter. That
 * keeps `https://cdn.example.com/assets/x` intact, because the character before
 * `/assets/` there is `m`, not a delimiter.
 */
const DELIM = "([\"'`(,=])";
const dirRe = new RegExp(`${DELIM}\\/(${DIRS.map(esc).join("|")})\\/`, "g");
const fileRe = new RegExp(
	`${DELIM}\\/(${FILES.map(esc).join("|")})(?=["'\`)?#,\\s])`,
	"g",
);
// Routes may be followed by a slash, a query string, or the end of the literal.
const routeRe = new RegExp(
	`${DELIM}\\/(${ROUTES.map(esc).join("|")})(?=[\\/?"'\`)])`,
	"g",
);

/**
 * @param includeFiles - the service worker opts out of the top-level *file*
 * rules: its only occurrences of `/index.html` are pathname comparisons, not
 * URLs, and rewriting those would silently break routing.
 */
function rewriteGeneric(text, includeFiles = true) {
	text = text.replace(dirRe, (_m, d, dir) => `${d}${BASE}${dir}/`);
	text = text.replace(routeRe, (_m, d, route) => `${d}${BASE}${route}`);
	if (includeFiles) {
		text = text.replace(fileRe, (_m, d, file) => `${d}${BASE}${file}`);
	}
	return text;
}

/** Named patches for logic that compares a pathname against the origin root. */
function patchServiceWorker(text) {
	const patches = [
		// Requests reaching the worker are prefixed with the scope; strip it once
		// so every downstream comparison and cache lookup stays base-agnostic.
		// The cache index is keyed on root-relative paths, so strip the scope
		// prefix straight after `path` is derived from the request URL.
		[
			"let path = decodeURI(event.url.pathname);",
			"let path = stripBase(decodeURI(event.url.pathname));",
		],
		[
			'decodeURIComponent(url.pathname.replace(/^\\/dav/, "") || "/")',
			'decodeURIComponent(stripBase(url.pathname).replace(/^\\/dav/, "") || "/")',
		],
		[
			'new URL(v.url).pathname === "/"',
			'stripBase(new URL(v.url).pathname) === "/"',
		],
		[
			'!cacheenabled && event.url.pathname === "/" && !navigator.onLine',
			'!cacheenabled && stripBase(event.url.pathname) === "/" && !navigator.onLine',
		],
		[
			'event.url.pathname === "/index.html" &&',
			'stripBase(event.url.pathname) === "/index.html" &&',
		],
		[
			'if (event.url.pathname === "/") event.url.pathname = "/index.html";',
			`if (stripBase(event.url.pathname) === "/")\n\t\t\tevent.url.pathname = ANURA_BASE + "index.html";`,
		],
	];

	for (const [from, to] of patches) {
		if (!text.includes(from)) {
			throw new Error(
				`service worker patch target not found — upstream changed?\n  ${from}`,
			);
		}
		text = text.replace(from, to);
	}

	const preamble = `// Injected by .github/scripts/set-base-path.mjs for sub-path hosting.
const ANURA_BASE = ${JSON.stringify(BASE)};
function stripBase(p) {
	return p.startsWith(ANURA_BASE) ? "/" + p.slice(ANURA_BASE.length) : p;
}
`;
	return preamble + text;
}

let changed = 0;
function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			walk(full);
			continue;
		}
		if (!TEXT_EXT.has(extname(full).toLowerCase())) continue;

		const before = readFileSync(full, "utf8");
		const isServiceWorker = entry === "anura-sw.js" && dir === ROOT;
		let after = rewriteGeneric(before, !isServiceWorker);

		if (isServiceWorker) {
			after = patchServiceWorker(after);
		}

		/*
		 * `config.json`'s `bin` array holds URLs under /bin/, but /bin is NOT on
		 * the allowlist — inside the x86 guest, /bin/ash and /bin/bash are real
		 * guest paths that must stay untouched. So the array is rewritten here,
		 * by key, rather than by pattern.
		 */
		if (entry === "config.json" && dir === ROOT) {
			const c = JSON.parse(after);
			if (Array.isArray(c.bin)) {
				c.bin = c.bin.map((u) =>
					u.startsWith("/") && !u.startsWith(BASE) ? BASE + u.slice(1) : u,
				);
			}
			after = JSON.stringify(c, null, "\t") + "\n";
		}

		if (entry === "manifest.json" && dir === ROOT) {
			const m = JSON.parse(after);
			m.start_url = BASE;
			after = JSON.stringify(m, null, "\t") + "\n";
		}

		if (before !== after) {
			writeFileSync(full, after);
			changed++;
		}
	}
}

walk(ROOT);

/* --- verification -------------------------------------------------------- */
const leftovers = [];
function verify(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			verify(full);
			continue;
		}
		if (!TEXT_EXT.has(extname(full).toLowerCase())) continue;
		const text = readFileSync(full, "utf8");
		for (const m of text.matchAll(dirRe)) leftovers.push(`${full}: ${m[0]}`);
		if (entry === "anura-sw.js" && dir === ROOT) continue;
		for (const m of text.matchAll(routeRe)) leftovers.push(`${full}: ${m[0]}`);
		for (const m of text.matchAll(fileRe)) leftovers.push(`${full}: ${m[0]}`);
	}
}
verify(ROOT);

console.log(`rewrote ${changed} file(s) for base ${BASE}`);
if (leftovers.length) {
	console.error("un-rewritten absolute references remain:");
	for (const l of leftovers.slice(0, 40)) console.error("  " + l);
	process.exit(1);
}
