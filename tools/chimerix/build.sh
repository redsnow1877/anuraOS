#!/usr/bin/env bash
# Builds bin/chimerix.ajs from the chimerix submodule with Dimension's one
# addition: AjsCommandProvider, which runs /usr/bin/<name>.ajs programs by
# name. The submodule itself is left untouched; the patch is applied to a
# scratch copy of its source under build/.
set -euo pipefail
cd "$(dirname "$0")/../.."

(cd chimerix && npm i)

rm -rf build/chimerix
mkdir -p build/chimerix bin
cp -r chimerix/src chimerix/rollup.config.js chimerix/package.json build/chimerix/
ln -s ../../chimerix/node_modules build/chimerix/node_modules
cp tools/chimerix/AjsCommandProvider.js build/chimerix/src/puter-shell/providers/

main=build/chimerix/src/puter-shell/main.js
grep -q "new ScriptCommandProvider()," "$main" || {
	echo "chimerix changed: couldn't find where to add AjsCommandProvider" >&2
	exit 1
}
sed -i \
	-e "s#^import { ScriptCommandProvider } from './providers/ScriptCommandProvider.js';#&\nimport { AjsCommandProvider } from './providers/AjsCommandProvider.js';#" \
	-e "s#        new ScriptCommandProvider(),#&\n        new AjsCommandProvider(),#" \
	"$main"
grep -q "new AjsCommandProvider()" "$main"

(cd build/chimerix && npx rollup -c rollup.config.js)
cp build/chimerix/dist/chimerix.ajs bin/chimerix.ajs
