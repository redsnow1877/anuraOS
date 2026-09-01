# Aether shell overhaul — handoff

Branch: `claude/virtual-proxy-browser-ui-y75fvi` (repo `redsnow1877/anuraos`, fork of MercuryWorkshop/anuraOS).

Goal from the user: strip the upstream ChromeOS-flavoured identity, rebuild the
desktop UI as something unique and macOS-ish with blur on as many surfaces as
possible, then deploy to GitHub Pages so they can test it.

---

## 1. What is already done

Everything below is committed and **typechecks clean** (`npx tsc` exits 0) and
has been run through `npx prettier -w .` + `npx eslint . --fix`.

### New files

| File | Purpose |
| --- | --- |
| `src/Branding.ts` | Single source of truth for the product name. `BRANDING = { name: "Aether", fullName, tagline, accent }`. Also assigned to `globalThis`. Loaded first in `public/index.html` as `lib/Branding.js` because `Bootsplash.js` reads `BRANDING.name` at script-eval time. **Change the name here and nowhere else.** |
| `src/Glass.css` | The design system. All tokens: `--menubar-h`, `--dock-icon`, `--dock-reserve`, `--glass-blur*`, `--glass-tint*`, `--glass-stroke`, `--glass-highlight`, `--shadow-window*`, `--radius-*`, `--ease-out`, `--ease-spring`, traffic-light colours, font stacks. Also contains the `body.blur-disable` fallback (swaps translucency for solid tints rather than just dropping the filter) and global thin scrollbars. |
| `public/assets/wallpaper/bundled_wallpapers/Aether.svg` | New default wallpaper — mesh gradient + SVG film grain. Registered first in `bundled_wallpapers/manifest.json`. |
| `public/assets/wallpaper/bundled_wallpapers/Aether Dusk.svg` | Second bundled wallpaper. |

### Rewritten / restructured

**`src/Taskbar.tsx` — the big one.** The old single bottom `<footer>` is gone.
`taskbar.element` is now `<div id="shell-root">` with `display: contents`,
holding two fixed children so `taskbar.element.remove()` (used by AboutApp and
kiosk mode) still works unchanged:

- `<header id="menubar">` — brand glyph (opens a context menu: About / System
  Settings / Wallpaper & Style / Activity Monitor / Restart), active app name,
  spacer, then right cluster: `.systray` (class kept for `src/api/Systray.tsx`),
  wifi + battery, notification badge, date + time (opens Calendar).
- `<footer id="dock">` — Launchpad button, separator, pinned apps, separator,
  running apps.
- **Dock magnification** is real: `#magnify(clientX)` on `pointermove` sets a
  per-item `--mag` CSS var from a gaussian of the cursor distance
  (`MAGNIFY_SIGMA = 78`, `MAGNIFY_PEAK = 0.55`). Skipped when
  `disable-animation` is set.
- `updateRadius()` kept under its old name (callers depend on it) but now
  toggles `state.solidMenubar` instead of rounding a taskbar.
- Drag-to-reorder still works; selectors moved from `.taskbar-button .showDialog`
  to `.dock-item .dock-icon`.
- Menu wording changed to macOS vocabulary: "Keep in Dock" / "Remove from Dock" / "Quit".

**`src/Launcher.tsx`** — was a dropdown panel, now a full-screen Launchpad:
`#launcher` fixed inset-0, `backdrop-filter: blur(44px) saturate(170%)`, search
field near the top, grid of 62px icons that scales in from 1.06. Escape closes;
Enter opens the first visible result; clicking the frosted background dismisses.
No longer uses the `Panel` component.

**`src/AliceWM.tsx`** —
- Added module constants `WM_TOP_INSET = 28`, `WM_BOTTOM_INSET = 82`,
  `WM_V_INSET`. Every hardcoded `- 49` was replaced by these, plus maximize /
  remaximize / snap now position windows *below the menu bar* (`top =
  WM_TOP_INSET`), drag clamps to `WM_TOP_INSET`, and new windows centre in the
  usable area rather than the raw viewport. **These mirror `--menubar-h` /
  `--dock-reserve` in Glass.css — keep the two in step.**
- Title bar restructured: a `.window-controls` cluster (close / minimize /
  maximize, macOS order, on the **left**) then an absolutely-positioned centred
  `.titleContent`. Glyphs are hidden until the pointer enters the cluster.
- `maximizeImg` was a plain field, so assigning it never actually swapped the
  glyph. It is now a real getter/setter backed by `#maximizeImg` that calls
  `button.replaceChildren(value)`; guarded with `?.` because the first
  assignment happens inside the JSX that builds `this.element`.
- Added `markWindowFocused(win)` and `focusTopmostWindow()` plus a
  `wmWindowByElement` WeakMap. Exactly one window carries `.focused` (drives
  coloured traffic lights + heavier shadow), and it dispatches
  `anura-window-focus` / `anura-window-blur` which Taskbar listens for to fill
  the menu bar app name. Focus is handed off on close and on minimize.
- The green button now calls `togglemaximize` (was `maximize`).

**CSS rewrites:** `src/anura.css` (base, boot splash, context menus,
notifications), `src/Taskbar.css` (menu bar + dock), `src/AliceWM.css` (window
chrome, traffic lights, snapping, resize handles), `src/Launcher.css`
(Launchpad), `src/AltTabView.css` (⌘-Tab switcher).

**Smaller edits:**
- `src/api/UI.tsx` — the `Panel` component now uses the glass tokens.
- `src/QuickSettings.tsx`, `src/Calendar.tsx` — moved from bottom-right to
  `top: calc(var(--menubar-h) + 6px); right: 8px` with `transform-origin: top
  right`; hidden state now scales down + `pointer-events: none`.
- `src/api/Theme.ts` — new default palette (accent `#7A6CFF`, bg `#1C1C21`,
  darkBg `#141418`, secondaryFg `#A7A7AF`). `public/theme.css` matched.
- `src/Bootsplash.tsx` — new gradient triangle mark (`BootMark()`, a plain
  function, **not** a dreamland component), wordmark, sweeping progress bar.
  `#systemstatus` / `#systemstatus-br` ids preserved because `Boot.tsx` drives them.
- `src/Boot.tsx` — deleted the mobile/tablet `#taskbar-right` relocation hacks
  (the menu bar is natively on top now); compact devices only get a denser
  Launchpad grid. Default wallpaper → `Aether.svg`. Safe-mode banner offset uses
  `var(--dock-reserve)`.
- Rebranded user-visible copy in `Anura.ts`, `AboutApp`, `SettingsApp`,
  `OobeView`, `ExploreApp` (its "visually based off Google's ChromeOS" /
  "taskbar" paragraph was rewritten to describe the new shell), `index.html`
  title + meta + theme-color, `public/manifest.json`.
- `public/index.html` — added Inter from Google Fonts (with a full system
  fallback stack in Glass.css) and the `lib/Branding.js` script tag.

### Deliberately NOT touched
`LICENSE` and `CREDITS.md`. Upstream anuraOS is **AGPL-3.0**; the product name
and UI are fair to change, the copyright notices and attribution are not.
Tell the user this if it comes up.

---

## 2. What is left to do

### 2a. Visual verification (was in progress when the session ended)
Nothing has been rendered yet — the design is unverified in a browser. The
plan was: build the CSS bundle
(`shopt -s globstar; cat src/**/*.css > build/bundle.css`, already runs clean,
1517 lines), then write a standalone harness HTML in the scratchpad that inlines
`build/bundle.css` + `public/theme.css` + the theme `:root` vars, mocks up the
menu bar / dock / two windows / Launchpad, and screenshot it with Playwright
(Chromium is preinstalled at `/opt/pw-browsers/chromium`;
`PLAYWRIGHT_BROWSERS_PATH` is already set — **do not run `playwright install`**).
A full `make static` build is not feasible in-session: it needs the v86 rust
wasm toolchain and the submodules are empty (`git submodule update --init` was
never run).

Things worth checking specifically once rendered:
- Traffic lights only colour when `.focused` is present — verify a fresh window
  actually gets it (constructor calls `markWindowFocused(this)`).
- `#dock` uses `overflow: visible` so magnified icons spill out; confirm they
  don't get clipped by the `border-radius`.
- The `.titleContent` centring uses `padding: 0 96px` to clear the controls —
  may need tuning for narrow windows.
- `Bootsplash.tsx` has four splash variants each defining SVG gradients with the
  same `id="bootGrad"`/`id="bootGlass"`. Only one is ever appended to the
  document so this should be fine, but if the gradient renders black, that's why.

### 2b. GitHub Pages deployment (not started)
This is the part the user explicitly asked for and it has a real complication.

**The problem.** Pages will serve this at `https://redsnow1877.github.io/anuraos/`,
but the app is written for a root deployment. Relative `<script src="lib/…">`
tags are fine, but roughly 100 references use absolute URLs.

**The plan I settled on** — a build-time rewrite over the `static/` output with a
*fixed, audited* prefix list, plus a `<base href>`:

Safe to rewrite globally (verified these never collide with the virtual FS):
`/assets/ /libs/ /lib/ /uv/ /bios/ /x86images/ /apps/ /bundle.css /theme.css
/config.json /cache-load.json /MILESTONE /manifest.json /icon.png /icon_dark.png
/pwa_icon.png /anura-sw.js /index.html`

**Do NOT blanket-rewrite these** — they are virtual-filesystem or v86-guest
paths, not URLs: `/fs /usr /tmp /opt /boot /home`, and critically **`/bin`**
(`directories.bin` is `/usr/bin`, and `v86.tsx` runs `/bin/ash`, `/bin/bash`
inside the guest). `/bin/*` *is* a URL inside `config.default.json`'s `"bin"`
array only — rewrite it there and nowhere else.

Workflow shape (`.github/workflows/pages.yml`), mirroring the existing
`.github/workflows/main.yml` build job which is known to work:
```yaml
permissions: { contents: read, pages: write, id-token: write }
- actions/checkout@v4 with submodules: recursive
- actions/setup-node@v4 (node 22)
- sudo apt install -y git build-essential clang default-jre
- make static          # rust nightly comes from rust-toolchain.toml
- <base-path rewrite step over static/>
- actions/upload-pages-artifact@v3 with path: static
- actions/deploy-pages@v4
```
The user must also flip Settings → Pages → Source to "GitHub Actions".

**Caveats to tell the user up front:** Pages is static-only. The proxy stack
needs a wisp relay; `config.default.json` defaults `relay-url` to the public
`wss://relay.widgetry.org/`, so browsing *may* work, but the sub-path deployment
plus the service-worker scope (`/anuraos/`) makes it the fragile part. The new
UI will render regardless — that is what they want to look at first.

If sub-path rewriting turns out to be too brittle, the clean alternative is a
`redsnow1877.github.io` user repo (serves at root, everything Just Works), but
this session only had access to `redsnow1877/anuraos`.

### 2c. Open decisions for the user
- **The name "Aether" was my pick, not theirs.** It is a one-line change in
  `src/Branding.ts`. Ask.
- The brand glyph is a placeholder triangle-aperture SVG (inline in
  `Taskbar.tsx` and `Bootsplash.tsx`); `public/icon.png` / `pwa_icon.png` are
  still the upstream Anura icons and should be replaced.
