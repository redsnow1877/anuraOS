/*
 * Minimal CSS minifier for build/bundle.css.
 *
 * Uses postcss's parser (already a devDependency) rather than regexes, so a
 * "/*" inside a string or url() can never be mistaken for a comment. It drops
 * comments and the whitespace between nodes; it does not rewrite values,
 * merge rules or reorder anything, so the cascade is byte-for-byte the same
 * rules in the same order — only smaller.
 *
 * Usage: node tools/minify-css.mjs <in.css> <out.css>
 */
import fs from "node:fs";
import postcss from "postcss";

const [, , input, output] = process.argv;
if (!input || !output) {
	console.error("usage: minify-css.mjs <in.css> <out.css>");
	process.exit(2);
}

const source = fs.readFileSync(input, "utf8");
const root = postcss.parse(source, { from: input });

root.walkComments((c) => c.remove());
root.walk((node) => {
	node.raws.before = "";
	node.raws.after = "";
	if (node.type === "decl") {
		node.raws.between = ":";
		// Collapse runs of whitespace inside values (multi-line box-shadows,
		// transitions) without touching the characters themselves.
		if (!/["']/.test(node.value))
			node.value = node.value.replace(/\s+/g, " ").trim();
		if (node.important) node.raws.important = "!important";
	} else if (node.type === "rule") {
		node.raws.between = "";
		node.raws.semicolon = false;
		node.selector = node.selector
			.replace(/\s*\n\s*/g, " ")
			.replace(/\s*,\s*/g, ",");
	} else if (node.type === "atrule") {
		node.raws.between = "";
		node.raws.afterName = node.params ? " " : "";
		node.params = node.params.replace(/\s+/g, " ").trim();
	}
});
root.raws.after = "\n";

const out = root.toString();
fs.writeFileSync(output, out);
const kb = (n) => (n / 1024).toFixed(1) + "KB";
console.log(`bundle.css ${kb(source.length)} -> ${kb(out.length)}`);
