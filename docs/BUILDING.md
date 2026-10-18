# Building and testing

## Layout

| Folder | What it is |
| --- | --- |
| `packages/core` | Platform-independent wallet core: keys, LBRY seeds, transactions, hub client, SPV checks, mining protocol, WASM miner |
| `packages/services` | Wallet, price and mining-info services and the API contract shared by both apps |
| `packages/ui` | The React UI (all screens and the 14 translations), shared by both apps |
| `packages/miner-wasm` | C source of the LBRY proof-of-work scanner (compiled to WebAssembly) |
| `apps/desktop` | Electron app: main process (services, miner process, built-in node), preload, packaging |
| `apps/mobile` | Android app: Capacitor shell, native plugin (`android/app/src/main/java/...`), in-app API |
| `scripts/build-lbcd.sh` | Builds the bundled full node (`lbcd`) from its verified release source |

## Requirements

* **Node.js 22 or newer** (with npm 10+): runs, tests and packages the desktop app.
* **Go 1.24+**: builds `lbcd` for the built-in node and the end-to-end tests
  (`bash scripts/build-lbcd.sh` → `apps/desktop/resources/bin/<os>-<arch>/lbcd`).
* Android app: **JDK 21** and the **Android SDK** (platform 36, build-tools 36; set
  `ANDROID_HOME`). Gradle is fetched by the wrapper.
* Optional, to rebuild the miner from C: **clang 15+ with the wasm32 target and lld**.
* Headless Linux needs `xvfb` for the UI tests.

## Everyday commands

```sh
npm ci                    # install exactly what package-lock.json pins
npm run dev               # run the desktop app with hot reload
npm run typecheck         # TypeScript for every package and app
npm test                  # unit tests: core, services, ui (incl. translation checks), desktop, mobile
npm run build             # production build of the desktop app into apps/desktop/out
bash scripts/build-lbcd.sh                      # lbcd for this computer
bash scripts/build-lbcd.sh linux-x64 win-x64   # or for other targets (cross-compiles)
```

| Command | What it does |
| --- | --- |
| `LBCD_BIN=… npm run test:e2e` | Wallet, hub-protocol and mining tests against a throw-away lbcd on regtest |
| `LBCD_BIN=… xvfb-run -a npm run test:ui -w lbc-wallet-desktop` | Drives the built app through the disclaimer, restore, create, send, confirm, pool mining, the built-in node (sync + solo mining), settings, Persian and phone layouts; screenshots in `apps/desktop/e2e/screenshots` |
| `APP_EXECUTABLE=… npm run test:ui -w lbc-wallet-desktop` | The same flow against a packaged build (`apps/desktop/release/<version>/linux-unpacked/lbc-wallet`) |
| `xvfb-run -a npm run test:privacy -w lbc-wallet-desktop` | Network audit: no requests except the optional price feed |
| `LBCD_BIN=… npm run test:e2e -w lbc-wallet-mobile` | The Android app's JavaScript stack against regtest |
| `LBCD_BIN=… npm run test:device -w lbc-wallet-mobile` | The real Android app on a connected device/emulator against regtest (needs the debug APK) |
| `npm run test:mainnet -w @lbcwallet/core` | Read-only mainnet check: hubs, PoW headers, SPV proofs, LBRYPool login |
| `LBCD_BIN=… npx tsx apps/desktop/mainnet/node-sync.ts 8` | The built-in node finds peers and syncs mainnet for 8 minutes |
| `npm run build:wasm` | Recompiles the miner from C and regenerates the embedded module |
| `python3 scripts/manual-images.py <screenshot dir>` | Rebuilds the manual's pictures and animations from UI-test screenshots |
| `node apps/desktop/scripts/license-text.mjs` | Regenerates the installer license page from `DISCLAIMER.md` + `LICENSE` (a test checks it) |

## A local network to play with

`LBCD_BIN=… npm run regtest` starts lbcd on regtest, an LBRY hub emulator and a Stratum test pool,
and prints their ports as JSON (hub `127.0.0.1:50101`, pool `stratum+tcp://127.0.0.1:33340`, lbcd
P2P port). The funded wallet is the BIP39 phrase `abandon abandon abandon abandon abandon abandon
abandon abandon abandon abandon abandon about`. Type `mine 10` and Enter to mine ten blocks.

In the app: **Settings → About → Developer mode**, network **Regtest**, then **Settings →
Network**: turn off the default hubs and add `127.0.0.1:50101`. To try the built-in node, add the
regtest node's P2P address under *Show advanced options* on the Node page.

## The bundled full node

`scripts/build-lbcd.sh` downloads `github.com/lbryio/lbcd@v0.22.119` through the Go module proxy,
checks its hash against the pinned value (the same as the public checksum database), and builds
it with `CGO_ENABLED=0 -trimpath` for each requested target into
`apps/desktop/resources/bin/<os>-<arch>/` (`os` = `linux`, `mac`, `win`; `arch` = `x64`,
`arm64`). electron-builder copies the matching binary into the app's `resources/bin`. During
development the app uses `LBC_WALLET_LBCD_BIN` or that folder; packaged apps only use their own
copy.

## Packaging the desktop app

```sh
cd apps/desktop
npx electron-builder --config electron-builder.yml --linux   # AppImage, .deb, .rpm, .tar.gz (x64 + arm64)
npx electron-builder --config electron-builder.yml --win     # installer + portable (on Windows)
npx electron-builder --config electron-builder.yml --mac     # .dmg + .zip, x64 + arm64 (on macOS)
```

`.rpm` needs `rpmbuild` (`apt install rpm`). Output goes to `apps/desktop/release/<version>/`
with version-free names (`LBC-Wallet-Setup-x64.exe`, `lbc-wallet_amd64.deb`, …) so links to
`releases/latest/download/<name>` always work. Everything is bundled by electron-vite (no
`node_modules` shipped), and [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
turn off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` and enforce asar integrity.

## Building the Android app

```sh
npm run build:android:debug -w lbc-wallet-mobile     # apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
LBC_ANDROID_KEYSTORE=… LBC_ANDROID_KEYSTORE_PASSWORD=… LBC_ANDROID_KEY_ALIAS=… LBC_ANDROID_KEY_PASSWORD=… \
  npm run build:android:release -w lbc-wallet-mobile # signed release APK
```

The version comes from `apps/mobile/package.json`. `python3 apps/mobile/scripts/android-icons.py`
regenerates the launcher icons and splash screens from the desktop icon.

### The Android signing key (do this once)

Android only lets an app update itself if every version is signed with **the same key**. Create
one key, keep it safe forever, and give it to the release workflow as secrets:

```sh
keytool -genkeypair -v -keystore lbc-wallet-release.jks -storetype PKCS12 -alias lbcwallet \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 lbc-wallet-release.jks > keystore.b64    # macOS: base64 -i lbc-wallet-release.jks -o keystore.b64
```

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the contents of `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `lbcwallet` |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password with PKCS12) |

Back up `lbc-wallet-release.jks` and its password offline. If it is lost, users must uninstall
the app (losing wallets on the phone that aren't backed up by their recovery phrase) before they
can install a version signed with a new key. Without these secrets the workflow signs the APK
with a throwaway key and names it `LBC-Wallet-android-test-key.apk`.

## Releases

1. Bump `version` in `apps/desktop/package.json` and `apps/mobile/package.json`.
2. Push a tag such as `v1.1.0`. The [release workflow](../.github/workflows/release.yml) creates a
   **draft** release with the notes in [`docs/release-notes.md`](release-notes.md), builds and
   tests on Linux, Windows and macOS (bundling `lbcd` for each), builds the APK, writes SHA-256
   checksums and attaches everything.
3. Review the draft and publish it. Only then do the `releases/latest/download/…` links in the
   manual point at it.

Desktop builds are unsigned unless these secrets exist:

| Platform | Secrets |
| --- | --- |
| macOS (sign + notarize) | `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

## Continuous integration

* [`ci.yml`](../.github/workflows/ci.yml), on every push: typecheck, unit tests and build on
  Linux, Windows and macOS; the regtest suites; the desktop UI test (development and packaged
  builds, sandbox on); the privacy audit; the Android regtest stack test, APK build and the app in
  an Android emulator; and a byte-for-byte check that the WebAssembly miner matches its C source.
* [`mainnet.yml`](../.github/workflows/mainnet.yml), on every push and weekly: the read-only
  mainnet check and the built-in node's mainnet sync. GitHub's terms forbid mining on Actions, so
  nothing is mined there; mining on mainnet is tested by people (see the manual's mining section).
