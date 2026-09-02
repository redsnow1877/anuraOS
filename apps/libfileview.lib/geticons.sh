#!/bin/bash
set -euo pipefail

if [ -d "icons" ]; then
  echo "Icons already saved, remove icons folder to download again"
  exit 0
fi

# A plain clone pulls the whole Papirus history and working tree — over 100k
# files — to lift out ~25 SVGs. Sparse-checkout on just the two mimetype/places
# directories icons.json actually references cuts that from tens of seconds
# to a couple, without needing anything beyond git itself.
git clone --quiet --depth 1 --filter=blob:none --sparse \
  https://github.com/PapirusDevelopmentTeam/papirus-icon-theme.git papirus
git -C papirus sparse-checkout set Papirus/16x16/mimetypes Papirus/16x16/places

mkdir icons

# Entries without a "source"/"icon" pair (the .app shortcut type, matched by
# extension alone rather than a themed icon) are intentionally skipped here.
jq -r '.files[] | select(.source and .icon) | "\(.source)\t\(.icon)"' icons.json |
  while IFS=$'\t' read -r source icon_path; do
    cp "$source" "$icon_path"
  done

cp "$(jq -r '.defaultSource' icons.json)" "$(jq -r '.default' icons.json)"
cp "$(jq -r '.folderSource' icons.json)" "$(jq -r '.folder' icons.json)"
rm -rf papirus
