# Aether — shell overhaul and Pages deployment

This fork replaces anuraOS's ChromeOS-style shell with a translucent,
macOS-flavoured one called **Aether**, and adds a GitHub Pages deployment.

Upstream is [MercuryWorkshop/anuraOS](https://github.com/MercuryWorkshop/anuraOS),
AGPL-3.0. The product name and the entire look are changed; `LICENSE` and
`CREDITS.md` are deliberately untouched, because the attribution is not ours to
drop.

---

## Renaming the product

Everything user-visible reads its name from one place:

```ts
// src/Branding.ts
const BRANDING = {
	name: "Aether",
	fullName: "…",
	tagline: "…",
	accent: "#7a6cff",
};
```

Change `name` there and the menu bar, boot splash, OOBE, About, Settings and
window titles all follow. `public/index.html`'s `<title>`, `public/manifest.json`
and the two `Aether*.svg` wallpapers are static and need editing by hand.

## The shell

| Piece                                                   | Where                                  |
| ------------------------------------------------------- | -------------------------------------- |
| Design tokens — blur, tint, elevation, geometry, motion | `src/Glass.css`                        |
| Menu bar + dock                                         | `src/Taskbar.tsx`, `src/Taskbar.css`   |
| Launchpad                                               | `src/Launcher.tsx`, `src/Launcher.css` |
| Window chrome, traffic lights, snapping                 | `src/AliceWM.tsx`, `src/AliceWM.css`   |
| Boot splash                                             | `src/Bootsplash.tsx`, `src/anura.css`  |
| Setup flow                                              | `src/oobe/OobeView.tsx`                |

`taskbar.element` is a `display: contents` wrapper holding both the fixed menu
bar and the fixed dock, so existing callers that do `taskbar.element.remove()`
(About, kiosk mode) keep working.

**Screen insets are duplicated in two places and must stay in step:**
`WM_TOP_INSET` / `WM_BOTTOM_INSET` at the top of `src/AliceWM.tsx`, and
`--menubar-h` / `--dock-reserve` in `src/Glass.css`. They replaced a hardcoded
`49` that appeared fifteen times. A maximized window should land exactly
between the menu bar's bottom edge and the dock's top edge.

Dock magnification is a gaussian of the cursor's horizontal distance, written
to a per-item `--mag` custom property (`Taskbar#magnify`). It is skipped when
the `disable-animation` setting is on.

### Gotcha: class arrays

dreamland calls `classList.add()` on each entry of a `class={[...]}` array, and
`classList.add("")` throws — which takes down the whole shell init with a
`SyntaxError: The token provided must not be empty`. Use `cond && "name"`
(yields `false`, which dreamland skips), never `cond ? "name" : ""`.

### Gotcha: Matter theming

Every Matter component re-declares `--matter-helper-theme` from
`--matter-theme-rgb` inside its own rule, so setting `--matter-helper-theme` on
`body` never wins. `src/api/Theme.ts` sets `--matter-theme-rgb` instead, as a
bare `r, g, b` triplet derived from the accent hex.

## Deploying

`.github/workflows/pages.yml` builds with `make static` and publishes to Pages.
The repository needs **Settings → Pages → Source: GitHub Actions** enabled once.

A project site is served from `https://<user>.github.io/<repo>/`, not the origin
root, so `.github/scripts/set-base-path.mjs` re-bases the build's absolute URLs
afterwards. The workflow derives the base from the repo name and skips the step
entirely for a `<user>.github.io` repo.

The script rewrites only an explicit allowlist, because several root-looking
paths in this codebase are **not** URLs:

- `/usr`, `/opt`, `/tmp`, `/anura_files` are virtual-filesystem paths.
- `/bin/ash`, `/bin/bash` are paths inside the emulated x86 guest. `/bin/*` is
  a URL only inside `config.json`'s `bin` array, which is rewritten by key.

It also patches the service worker's `pathname === "/"` comparisons to compare
against the scope root instead. `Boot.tsx` probes `fetch("/fs/")` to decide
whether the worker is alive, and a 404 there drops the desktop into safe mode —
so the worker's virtual routes (`/fs`, `/dav`, `/blob`, `/display`,
`/extension`, `/service`) are re-based too. After rewriting, the script
re-scans and exits non-zero if it missed anything.

### Known limits on Pages

- Pages is static. Proxied browsing needs a wisp relay; the default
  `relay-url` is the public `wss://relay.widgetry.org/`.
- `make static` does not build the Alpine rootfs (that's `make full`), so the
  x86 subsystem has no images to boot.

## Verifying locally

There is no committed harness — the checks below were run ad hoc with
Playwright against a locally assembled `static/` tree, and are worth repeating
after shell changes:

- Menu bar and dock render; dock has one item per pinned app plus Launchpad.
- Launchpad opens from the dock, filters as you type, closes on Escape.
- Opening apps gives exactly one `.aliceWMwin.focused`, the menu bar names it,
  and dock running-dots track open windows.
- Maximizing puts the window's top at `WM_TOP_INSET` and its bottom exactly at
  the dock's top edge, and the menu bar goes opaque.

A full local `make static` needs the v86 submodule and a Rust nightly
toolchain; stubbing `build/lib/libv86.js` is enough to exercise everything
except the x86 subsystem.
