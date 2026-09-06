# Mareo

Mareo is a thin macOS desktop host for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It packages the published DSH runtime without forking or patching it, starts the local Web UI automatically, and displays it in a secured Electron window.

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

The desktop brand is `Mareo`, with bundle ID `app.mareo.desktop`. The application icon, Dock icon, and startup page use `assets/logo-white.png`, an exact white-background composite of the original `assets/logo.png`. When the original changes, run `python3 scripts/flatten-logo.py` (requires Pillow) and commit both images. Normal development and packaging use the committed image and do not require Python. Forge generates the macOS application icon automatically using `sips` and `iconutil`. The existing `Mareo` user-data directory is retained so branding changes do not reset settings or conversations. DSH's own UI and published dependency remain unmodified.

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
