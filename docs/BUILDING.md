# Building and testing

## Requirements

* **Node.js 22 or newer** (with npm 10+). That is all you need to run, test and package the app.
* Optional, for the end-to-end tests: **Go 1.24+** to build [lbcd](https://github.com/lbryio/lbcd)
  (`go install github.com/lbryio/lbcd@v0.22.119`, which puts it in `$(go env GOPATH)/bin`).
* Optional, to rebuild the miner from C: **clang 15+ with the wasm32 target and lld**
  (`apt install clang lld` on Debian/Ubuntu; on macOS Xcode's clang has no `wasm-ld`, so
  install Homebrew's `llvm` and `lld` and set `CLANG=$(brew --prefix llvm)/bin/clang`).
* Headless Linux needs `xvfb` for the UI tests.

## Everyday commands

```sh
npm ci                    # install exactly what package-lock.json pins
npm run dev               # run the desktop app with hot reload
npm run typecheck         # TypeScript for the core and the app (main, preload, renderer, tests)
npm test                  # unit tests (core + desktop main process)
npm run build             # production build of the app into apps/desktop/out
```

| Command | What it does |
| --- | --- |
| `LBCD_BIN=… npm run test:e2e` | Wallet, hub-protocol and mining tests against a throw-away lbcd on regtest |
| `LBCD_BIN=… xvfb-run -a npm run test:ui -w lbc-wallet-desktop` | Drives the built app through restore → create → send → confirm → mine → settings and saves screenshots to `apps/desktop/e2e/screenshots` (`THEME=light` for the light theme) |
| `APP_EXECUTABLE=… npm run test:ui -w lbc-wallet-desktop` | The same flow against a packaged build, e.g. `apps/desktop/release/1.0.0/linux-unpacked/lbc-wallet` |
| `xvfb-run -a npm run test:privacy -w lbc-wallet-desktop` | Network audit: the app must make no HTTP requests at startup except the optional price feed |
| `npm run build:wasm` | Recompiles `packages/miner-wasm/src/lbry_scan.c` (scalar and SIMD builds) and regenerates the embedded module |
| `LBCD_BIN=… npm run regtest` | Local development network, see below |

## A local network to play with

`npm run regtest` starts lbcd on regtest, an LBRY hub emulator and a Stratum test pool, and
prints their ports as JSON:

* hub: `127.0.0.1:50101` (`HUB_PORT`), pool: `stratum+tcp://127.0.0.1:33340` (`POOL_PORT`)
* a funded wallet: the BIP39 phrase `abandon abandon abandon abandon abandon abandon abandon
  abandon abandon abandon abandon about`
* type `mine 10` and Enter to mine ten blocks, or set `AUTOMINE=30` to mine one every 30 s.

In the app: **Settings → About → Developer mode**, switch the network to **Regtest**, then
in **Settings → Network** turn off the default hubs and add `127.0.0.1:50101`. Restore the
phrase above, and on the Mining page choose *Custom pool…* with `stratum+tcp://127.0.0.1:33340`.
Wallets are kept separately per network, so this never touches your mainnet wallets.

## Packaging

```sh
npm run dist:linux -w lbc-wallet-desktop   # AppImage, .deb and .tar.gz
npm run dist:win -w lbc-wallet-desktop     # NSIS installer and portable .exe (run on Windows)
npm run dist:mac -w lbc-wallet-desktop     # .dmg and .zip for x64 and arm64 (run on macOS)
```

Output goes to `apps/desktop/release/<version>/`. Packaging uses
[electron-builder](https://www.electron.build) with the settings in
`apps/desktop/electron-builder.yml`:

* everything is bundled by electron-vite, so no `node_modules` are shipped;
* the main-process bundle is unpacked from the asar archive because the miner's utility
  process and worker threads load their scripts from disk;
* [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) turn off
  `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, and enforce asar integrity.

`npx electron-builder --config electron-builder.yml --linux dir` (in `apps/desktop`) builds
just the unpacked app, which is the quickest way to test a production build.

## Releases

Push a tag such as `v1.0.1` (after bumping `version` in `apps/desktop/package.json`). The
[release workflow](../.github/workflows/release.yml) runs the tests, builds on Linux, Windows
and macOS, writes SHA-256 checksums and attaches everything to a **draft** GitHub release for
you to review and publish.

Builds are unsigned unless these repository secrets exist:

| Platform | Secrets |
| --- | --- |
| macOS (sign + notarize) | `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

## Continuous integration

[`ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request:

1. typecheck, unit tests and a production build on Linux, Windows and macOS;
2. the regtest end-to-end suite, the UI test against both the development build and the
   packaged, fused binary (with Chromium's sandbox on), and the network privacy audit;
3. a rebuild of the WebAssembly miner from C, which must match the committed module byte for
   byte.
