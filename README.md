# Mareo

Mareo is a thin macOS desktop host for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It packages the published DSH runtime without forking or patching its source, starts the local Web UI automatically, and displays it in a secured Electron window.

## V0 scope

- macOS arm64
- unsigned internal-test DMG
- pinned `@deepseek-ai/dsh` runtime
- pinned official Node.js runtime bundled inside the app
- isolated user data under `~/Library/Application Support/Mareo`

The current version intentionally excludes signing, notarization, automatic updates, Windows builds, tray behavior, deep DSH UI customization, and IPC transport.

## Development

Install the desktop build dependencies:

```sh
npm install
```

Run Mareo:

```sh
npm start
```

The staging step installs the locked DSH dependency tree and verifies both DSH and the bundled Node executable before Electron starts. The official Node archive is cached under `.cache/node` after its SHA-256 checksum matches the value pinned in `runtime/package.json`.

Useful checks:

```sh
npm run typecheck
npm test
npm run verify:runtime
npm run verify:brand
```

## Package

Create the macOS arm64 application and DMG:

```sh
npm run make
npm run verify:package
```

Artifacts are written to:

```text
out/Mareo-darwin-arm64/Mareo.app
out/make/Mareo-0.1.0-arm64.dmg
```

The V0 DMG is unsigned and is intended only for internal testing.

The desktop brand is `Mareo`, with bundle ID `app.mareo.desktop`. The application and Dock use `assets/app-icon.png`: the original logo on a white rounded plate, with transparent margins and a subtle shadow. The startup page independently uses `assets/logo-white.png`, a white-background composite. Neither asset redraws the original `assets/logo.png`. When the original changes, run `python3 scripts/compose-app-icon.py` and `python3 scripts/flatten-logo.py` (requires Pillow), then commit the original and generated images. Normal development and packaging use the committed images and do not require Python. Forge generates the macOS application icon automatically using `sips` and `iconutil`. The existing `Mareo` user-data directory is retained so branding changes do not reset settings or conversations.

## DSH brand extension

`brand/` owns the `mareo-brand` plugin. Staging packages its browser factory and embedded original logo alongside the unmodified npm dependencies. The launcher writes an app-owned `mareo-brand.patch.json` under DSH home and passes it through the official `--patch` option. The overlay disables `ui-brand-official` and loads our package by its installed file URL, so moving the application does not break package resolution. It never overwrites the user's profile or settings.

The plugin uses only `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, and `shell.overlay`. The sidebar shows `Mareo` and `Built on DeepSeek Harness`; the same attribution appears at the bottom right. The default hero headline and Preview badge are retained. There is no DOM rewriting, global CSS override, source patch, or fork. Attribution follows the [official brand guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md).

Run `npm run verify:brand` after staging, or `node scripts/verify-brand.mjs "out/Mareo-darwin-arm64/Mareo.app/Contents/Resources"` after packaging. This boots an isolated temporary DSH home and checks authenticated loading and brand composition without an API key. Add `--serve` after the resources path to keep the test instance available for visual checks. When upgrading DSH, also verify sidebar folding, both themes, and attribution placement in the UI.

## Runtime boundary

```text
Mareo Electron main process
    -> bundled official Node.js
        -> published @deepseek-ai/dsh CLI
            -> 127.0.0.1 on an OS-assigned port
                -> secured Mareo BrowserWindow
```

The DSH launch token is used only for the local authenticated URL and is redacted from Mareo's runtime log. Mareo never runs `npx` or downloads DSH on an end user's machine.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the primary packaged runtimes.
