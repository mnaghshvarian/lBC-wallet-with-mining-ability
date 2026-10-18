---
name: regtest-tests
description: Run LBC Wallet's tests locally — unit tests, end-to-end tests on private LBC (lbcd) and Bitcoin (btcd) regtest networks with the hub, Esplora and Nostr relay emulators, the robot-driven desktop UI test with screenshots, the privacy audit and the Android build. Use before pushing, when CI fails, or to reproduce a bug without real funds.
---

# Testing on private networks

Nothing here touches the real LBC or Bitcoin networks, and nothing is mined outside the private
regtest chains. **Never mine real LBC in CI or on shared machines.**

## Binaries

```bash
bash scripts/build-lbcd.sh     # → apps/desktop/resources/bin/<os>-<arch>/lbcd (Go ≥ 1.19)
bash scripts/build-btcd.sh     # → .tools/btcd/btcd (sets GOTOOLCHAIN=go1.25.0+auto itself)
export LBCD_BIN=$PWD/apps/desktop/resources/bin/linux-x64/lbcd
export BTCD_BIN=$PWD/.tools/btcd/btcd
```

Tests that need a binary skip themselves when it is missing (`describe.skipIf`) — a "skipped"
count is not a pass; check that the suite really ran.

## Fast checks (every change)

```bash
npm run typecheck
npm test                          # core, services, ui (translations), desktop, mobile unit tests
```

## End-to-end on regtest

```bash
npm run test:e2e                                   # core + services, files one after another
npx vitest run packages/services/e2e/market.e2e.test.ts   # one file (from packages/services)
LBCD_BIN=… npm run test:e2e -w lbc-wallet-mobile   # Android JavaScript stack
```

What they use (all in `packages/core/e2e/`): `harness.ts` (throw-away lbcd/btcd), `regtest-hub.ts`
(LBRY hub protocol on top of lbcd), `test-pool.ts` (Stratum), `esplora-emulator.ts` (Bitcoin
explorer API on btcd), `nostr-relay.ts` (Nostr relay for the Market). Swap and Market tests
shorten the time rules (`SwapTiming`, `MarketTiming`) to seconds; LBC regtest enforces
CHECKLOCKTIMEVERIFY only from block 1351, so swap tests mine 1400 blocks first.

Long runs: start them in the background and read the log file when the notification arrives
(do not poll with sleep).

## The desktop app driven by a robot

```bash
npm run build -w lbc-wallet-desktop
SCREENSHOT_DIR=/tmp/shots LBCD_BIN=… xvfb-run -a npm run test:ui -w lbc-wallet-desktop
APP_EXECUTABLE=apps/desktop/release/<v>/linux-unpacked/lbc-wallet …   # same flow on a packaged build
xvfb-run -a npm run test:privacy -w lbc-wallet-desktop                  # no unexpected HTTP requests
```

It starts `packages/core/e2e/dev-regtest.ts` (lbcd + hub + pool + relay), then walks through the
disclaimer, restore, create, send, mining, swap, Market, built-in node, settings, Persian and
phone layouts, saving numbered screenshots (the manual-images skill turns them into the
manual's pictures). When you add a page or a nav item, check the hard-coded `.nav-item` indexes
in the test (e.g. the Persian mining screenshot).

## Android

```bash
export ANDROID_HOME=…   # SDK with platform-tools, build-tools, platforms
cd apps/mobile && npx vite build && npx cap sync android && (cd android && ./gradlew --no-daemon assembleDebug)
```

CI also runs the APK in an emulator (`test:device`). Java changes in
`LbcNativePlugin.java` must at least compile here.

## Play with it by hand

`LBCD_BIN=… npm run regtest` prints the ports (hub 50101, pool 33340, relay 7447); the funded
wallet is the BIP39 phrase "abandon ×11 about". Type `mine 10` + Enter to mine. In the app:
Settings → About → Developer mode → Regtest; Settings → Network: hub `127.0.0.1:50101`, relay
`ws://127.0.0.1:7447`. Two app instances with different `LBC_WALLET_DATA_DIR` can trade.
