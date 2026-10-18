---
name: code-review-pass
description: Run a second-model code review of LBC Wallet the way the October 2026 review was done — six focused read-only passes (swap engine, Market/Nostr transport, wallet core/SPV, desktop+Android platform, services+UI, mining), lead re-verification of every high finding with proof-of-concept scripts, a ranked report with verification labels, and the fix/commit/document cycle. Use before a release, after large changes, or when asked to "audit", "review" or "double-check" the code.
---

# A review pass over LBC Wallet

Say what it is in every write-up: a second-model review is **not an independent security audit**.
It finds bugs; it proves nothing about their absence.

## 1. Scope and facts first

Read `docs/ARCHITECTURE.md` and `docs/SECURITY.md`: findings are judged against what the app
*promises*. Check facts against sources, not memory: lbcd's source is in the Go module cache
(`/root/go/pkg/mod/github.com/lbryio/lbcd@<version>` after `scripts/build-lbcd.sh`) —
`blockchain/difficulty.go`, `chain.go` (retarget bounds), `chaincfg/params.go`, `validate.go`
(subsidy); the previous report is `docs/REVIEW-2026-10.md`.

## 2. Six parallel read-only passes

One background agent per area, each told: read callers and callees end to end, never guess from
names; unit tests and `npx tsx -e` experiments allowed; no e2e runs, no real networks, no public
relays, no edits; scratch under the session scratchpad only. Areas and the questions that paid off:

| Area | Files | Ask about |
| --- | --- | --- |
| Swap engine | `core/src/swap/*`, `net/esplora.ts`, `services/src/swap-service.ts` | HTLC bytes, lock-time asymmetry, what is verified before locking/revealing, explorer trust, spend selection, persistence order, fee bounds, clocks |
| Market | `core/src/nostr/*`, `net/websocket.ts`, `core/src/market/*`, `services/src/market-service.ts` | frame limits, event verification vs filters, NIP-44 vs spec, state machine under sleep/offline/locked, replay, price parsing |
| Wallet core | `core/src/{keys,tx,script,wallet,crypto,net}` | derivation vectors, sighash/scriptCode, fees/dust/change, **SPV: is a header tied to the chain at all?**, vault parameters, TLS/SOCKS, RPC parsing |
| Platform | `apps/desktop/src/main/*`, preload, `LbcNativePlugin.java`, manifest, builder config | IPC validation, paths from the renderer, process args, atomic writes, fuses/ASAR, TLS on Android, thread safety |
| Services + UI | `services/src/*`, `ui/src/*` | amount parsing in other locales, re-entrancy on unlock/send, setting changes mid-session, error texts from servers, stale prices |
| Mining | `core/src/mining/*`, `crypto/pow.ts`, `miner-wasm/src/lbry_scan.c` | PoW chain vs lbcd, stratum messages from a hostile pool, solo block validity, subsidy schedule |

Report format per finding: file:line, what the code does, concrete scenario, severity, confidence,
brief fix; plus "checked and found correct" and "not covered".

## 3. Lead verification

Re-read the code path of every high/critical finding yourself and run the reviewer's proof of
concept where one exists (they live in the scratchpad's `audit-*` folders). Label each finding
*confirmed (run)*, *confirmed (read)*, *reviewer-confirmed*, *likely* or *possible*. Also check
what no area covers: `npm audit`, dependency pinning, `scripts/build-*.sh` checksums, workflow
permissions, and which modules no test imports.

## 4. Fix, test, document

Fix in the order of money at risk. Delegate self-contained fixes (parser, clamps, guards) to
agents with strict file lists; keep the money paths (swap chain, engine, Market) with the lead.
Every fix gets a unit test with a fake server/clock; then the regtest suites
(`packages/services/e2e`, `npm run test:ui -w lbc-wallet-desktop`, `npm run test:e2e -w
lbc-wallet-mobile`). New user texts go through the translate skill. Correct `docs/SECURITY.md`
and `ARCHITECTURE.md` to say exactly what is checked; update `docs/REVIEW-<date>.md` with a
status column (fixed / mitigated / open) and the release notes. Model names stay out of the
repository; the review document says "a second AI model".

## 5. Pitfalls met

* The regtest harness runs **one** hub: a check that needs two servers must take a single
  configured hub at its word (with a warning), or the e2e trades never complete.
* `poll()` in the swap service is single-flight: tests must poll twice after changing a fake chain.
* Fake headers in tests must carry real (regtest-cheap) proof of work now that the hub client
  checks it; `FAST_MAINNET` in `hub.test.ts` keeps mainnet rules with regtest cost.
* lbcd's LBRY retarget bounds are `targetTimespan ∓ timespan/8 … + timespan/2` (chain.go), not
  the ×4 the params comment suggests.
