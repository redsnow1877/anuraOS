#!/usr/bin/env bash
# Builds bin/chimerix.ajs from the chimerix submodule with Dimension's one
# addition: AjsCommandProvider, which runs /usr/bin/<name>.ajs programs by
# name. The submodule itself is left untouched; the patch is applied to a
# scratch copy of its source under build/.chimerix. It's a dot-directory on
# purpose: `make static` copies build/* into the site, and a glob skips
# dotfiles, so the scratch copy (and its node_modules link) stays out of the
# deployed site.
set -euo pipefail
cd "$(dirname "$0")/../.."

(cd chimerix && npm i)

SCRATCH=build/.chimerix
rm -rf build/chimerix "$SCRATCH"
mkdir -p "$SCRATCH" bin
cp -r chimerix/src chimerix/rollup.config.js chimerix/package.json "$SCRATCH/"
ln -s "$PWD/chimerix/node_modules" "$SCRATCH/node_modules"
cp tools/chimerix/AjsCommandProvider.js "$SCRATCH/src/puter-shell/providers/"

main="$SCRATCH/src/puter-shell/main.js"
grep -q "new ScriptCommandProvider()," "$main" || {
	echo "chimerix changed: couldn't find where to add AjsCommandProvider" >&2
	exit 1
}
sed -i \
	-e "s#^import { ScriptCommandProvider } from './providers/ScriptCommandProvider.js';#&\nimport { AjsCommandProvider } from './providers/AjsCommandProvider.js';#" \
	-e "s#        new ScriptCommandProvider(),#&\n        new AjsCommandProvider(),#" \
	"$main"
grep -q "new AjsCommandProvider()" "$main"

(cd "$SCRATCH" && npx rollup -c rollup.config.js)
cp "$SCRATCH/dist/chimerix.ajs" bin/chimerix.ajs
