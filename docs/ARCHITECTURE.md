# Architecture

LBC Wallet is a TypeScript monorepo. A platform-agnostic **core** holds the wallet and mining
logic; shared **services** turn it into an application API; one **React UI** draws every screen;
and thin **apps** connect them to Electron (Windows, macOS, Linux) and Android.

```
lbc-wallet/
├── packages/
│   ├── core/                 @lbcwallet/core — no Node/Electron dependencies in the main entry
│   │   ├── src/
│   │   │   ├── networks.ts       LBC mainnet/testnet/regtest parameters (from lbcd chaincfg)
│   │   │   ├── address.ts        base58check (0x55 "b…", 0x7a "r…"), bech32 "lbc1…", WIF
│   │   │   ├── script/           standard scripts + LBRY claim/support/update prefixes
│   │   │   ├── keys/             BIP39, LBRY ("lbryum") seeds, BIP32/BIP44 derivation
│   │   │   ├── tx/               serialization, legacy sighash, signing, coin selection
│   │   │   ├── vault.ts          scrypt + AES-256-GCM sealed boxes
│   │   │   ├── net/              line-JSON-RPC, LBRY hub client, lbcd RPC backend, Esplora (Bitcoin) client
│   │   │   ├── wallet/           sync engine, SPV verification, keystore, restore scan
│   │   │   ├── mining/           Stratum client, solo GBT work, coordinator, WASM scanner, supply
│   │   │   ├── swap/             atomic swap contract (HTLC), protocol rules, swap codes, chain access
│   │   │   ├── ui.ts             key-free formatting entry for user interfaces
│   │   │   └── node/             Node.js TCP/TLS/SOCKS5 and HTTP transports
│   │   ├── test/                 unit tests (LBRY SDK vectors, consensus vectors)
│   │   ├── e2e/                  tests against a real lbcd (regtest) + hub emulator + test pool (+ btcd for swaps)
│   │   └── mainnet/              read-only checks against the real network and the Bitcoin explorers
│   ├── services/             @lbcwallet/services — the application API, shared by all apps
│   │   ├── api.ts                the typed API contract (channels, views, events)
│   │   ├── platform.ts           what services need from the OS: files, sockets, HTTPS, logs
│   │   ├── wallet-service.ts     open/lock wallets, sync, send, contacts, notices
│   │   ├── swap-service.ts       runs atomic swaps: codes, checks, locking, collecting, refunds
│   │   ├── backend.ts            picks hubs, your own lbcd, or the built-in node
│   │   ├── settings.ts           settings with validation of every field
│   │   ├── handlers.ts           validates untrusted arguments of every API call
│   │   ├── client.ts             builds `window.lbc` on top of a transport
│   │   ├── errors.ts             error codes the UI translates
│   │   ├── e2e/                  swaps between two wallets on lbcd + btcd regtest
│   │   └── mainnet/              a real payment from a small test wallet (started by hand in CI)
│   ├── ui/                   @lbcwallet/ui — React screens for desktop and phone
│   │   ├── pages/ components/    every screen; phone layout below 760 px
│   │   └── i18n/                 14 languages, plural rules, right-to-left support
│   └── miner-wasm/           C source of the LBRY proof-of-work scanner → WebAssembly
├── apps/
│   ├── desktop/              Electron app
│   │   ├── src/main/             main process: services, IPC, miner, built-in node, menus
│   │   │   ├── node-service.ts   runs the bundled lbcd (the built-in full node)
│   │   │   ├── miner-service.ts  starts/pauses the miner process, estimates, logs
│   │   │   └── mining/           utility process + worker threads that run the miner
│   │   ├── src/preload/          contextBridge → window.lbc (typed API, no Node access)
│   │   ├── src/renderer/         loads @lbcwallet/ui
│   │   ├── resources/bin/        lbcd binaries per platform (built by scripts/build-lbcd.sh)
│   │   ├── e2e/ui.e2e.ts         Playwright test driving the real app
│   │   └── mainnet/              the built-in node on mainnet; the installed app used on mainnet
│   └── mobile/               Android app (Capacitor)
│       ├── src/                  boots the same services and UI inside the app; phone miner (Web Workers)
│       ├── android/              native project; LbcNativePlugin.java: files, sockets, secure screens
│       └── e2e/                  regtest test of the Android build + emulator test
└── scripts/                  lbcd build, manual images and PDF, Android icons
```

### One API, two transports

The UI only ever talks to `window.lbc`, a typed API defined in `packages/services/src/api.ts`
and built by `createApi()` on top of a transport:

```
             desktop                                         Android
 ┌───────────────────────────┐                   ┌───────────────────────────────┐
 │ renderer (sandboxed)      │                   │ WebView                        │
 │  @lbcwallet/ui            │                   │  @lbcwallet/ui                 │
 │  window.lbc ─ preload ────┼── Electron IPC ─┐ │  window.lbc ─ in-app transport │
 └───────────────────────────┘                 │ │        │ (copies args/results) │
 ┌───────────────────────────┐                 │ │        ▼                       │
 │ main process              │◀────────────────┘ │  @lbcwallet/services          │
 │  @lbcwallet/services      │                   │        │                       │
 │  + miner, built-in node   │                   │  LbcNativePlugin (Java):       │
 │  + Node.js sockets, files │                   │  sockets, files, secure screen │
 └───────────────────────────┘                   └───────────────────────────────┘
```

* On the **desktop**, the services run in Electron's main process and the UI in a sandboxed
  renderer; every call crosses IPC, where the sender frame and every argument are checked.
* On **Android**, the services run inside the app next to the UI. The in-app transport copies
  arguments and results (`structuredClone`) like IPC does, so the UI can never change service
  state directly, and each call waits until its changes are written to disk. Sockets, durable
  files, the clipboard and screenshot blocking are native code (`LbcNativePlugin.java`).
* Everything that differs between platforms sits behind the `Platform` interface
  (`packages/services/src/platform.ts`): JSON file storage, line-based sockets, HTTPS, logging.
  The services and UI tests run the same code with in-memory files.

## Wallet core

### Keys and derivation

Two derivation schemes are supported and detected automatically on restore:

| Scheme | Seed | Account key | Addresses |
| --- | --- | --- | --- |
| **Standard (BIP44)** | BIP39 (`"mnemonic"` + passphrase salt) | `m/44'/140'/0'` (SLIP-44 coin type 140) | `/0/i` receive, `/1/i` change |
| **LBRY Desktop / Odysee** | PBKDF2-HMAC-SHA512(phrase, `"lbryum"`, 2048) — no checksum | master key itself | `m/0/i` receive, `m/1/i` change |

The LBRY scheme reproduces `lbry-sdk` exactly; the unit tests use the SDK's own vectors
(seed → `xprv9s21ZrQH143K42ov…`, first address `bCqJrLHdoiRqEZ1whFZ3WHNb33bP34SuGx`, and a
byte-identical deterministic signature).

### Transactions

Version-1 transactions, `SIGHASH_ALL`, RFC 6979 deterministic low-S signatures. Every
signature is verified again before broadcast. LBRY claim/support/update outputs are
recognised by parsing their prefix exactly like lbcd's `ExtractClaimScript`. Spending a
**support** output (an LBRY tip) signs over the *full* claim script as `scriptCode`, matching
both lbry-sdk and lbcd's script engine — validated end-to-end against lbcd.

Balances are split into: available, incoming (unconfirmed), maturing mining rewards
(coinbase needs 100 confirmations), tips & supports (unlockable), and claims (content
deposits, never spent by this wallet).

### Sync engine

The engine follows the Electrum model on top of LBRY hubs:

1. Subscribe to every derived address (`blockchain.address.subscribe`, batches of 100).
2. Refetch history only where the server's status hash changed.
3. Extend each chain until `gap` consecutive unused addresses exist (20 receive; 10/20 change).
4. Fetch missing transactions with `blockchain.transaction.get_batch` and check that each
   one hashes to the txid that was asked for.
5. For confirmed transactions, verify the merkle proof against the block header and check the
   header's LBRY proof of work (and that recent headers carry a plausible difficulty). Cached
   headers near the tip are dropped on every new block, and a failed check is retried with a
   fresh proof and header (up to three times per height), so a reorganisation that replaces
   a block cannot leave a transaction stuck as unverified.

Compatibility notes for both hub implementations (Python `lbryio/hub` and `herald.go`) are
in `packages/core/src/net/hub.ts`. A full-node backend (`LbcdBackend`) offers the same
interface on top of the user's own lbcd (`--txindex --addrindex`).

### Storage

Each wallet is one JSON file in the app data folder:

* `secret` — the recovery phrase / extended key **and** a random 256-bit data key, sealed with
  the user's password (scrypt N=2¹⁷, r=8 → AES-256-GCM).
* `state` — addresses, transactions, labels and contacts, sealed with the data key.

Writes are atomic (temp file + fsync + rename) and the previous version is kept as `.bak`.
On Android the files live in the app's private storage; the services read from a cache loaded at
start-up, and writes are queued in order and flushed before an API call returns.

## Mining

```
 ┌──────── main process ────────┐      ┌──────────── utility process (low priority) ─────────────┐
 │ MinerService                 │ IPC  │ MinerCoordinator                                         │
 │  • start/stop, battery pause │◀────▶│  • Stratum client (pool)  or  getblocktemplate (solo)   │
 │  • estimates, pool balance   │      │  • unique extranonce per thread, hit re-verification    │
 └──────────────────────────────┘      │  ┌───────────┐ ┌───────────┐       ┌───────────┐       │
                                       │  │ worker 1  │ │ worker 2  │  …    │ worker N  │       │
                                       │  │ WASM scan │ │ WASM scan │       │ WASM scan │       │
                                       │  └───────────┘ └───────────┘       └───────────┘       │
                                       └──────────────────────────────────────────────────────────┘
```

* **Hash function** — `SHA256d → SHA512 → RIPEMD160(halves) → SHA256d` over the 112-byte
  LBRY header, written in C (`packages/miner-wasm/src/lbry_scan.c`) with a SHA-256 midstate.
  It is compiled twice: a WebAssembly SIMD build that hashes four nonces per pass in 128-bit
  lanes (SHA-512 two at a time in 64-bit lanes), about 3.2× faster, and a portable scalar build
  used where SIMD is unavailable. Both are embedded in the app. CI rebuilds them from C and
  requires a byte-identical result, and the tests check every hit of both against the
  TypeScript reference.
* **Pausing** — the main process stops and restarts the utility process when the laptop
  switches to battery or, with *only when idle*, when the system idle timer shows recent input.
* **Pool mode** — Stratum v1 with the LBRY `mining.notify` variant (claimtrie root after the
  previous-block hash, both word-swapped) and the 256× LBRY share-difficulty convention used by
  yiimp/NOMP pools. The e2e suite checks the header the miner builds against a NOMP-style
  pool-side reconstruction, and that pool-assembled blocks are accepted by lbcd.
* **Solo mode** — `getblocktemplate` from the user's node, our own coinbase (BIP34 height,
  extranonce, optional witness commitment), `submitblock`. Verified against lbcd regtest.
* Every hit is re-hashed with the reference TypeScript implementation before submission.

## Swaps

`SwapService` (`packages/services/src/swap-service.ts`) runs LBC ↔ Bitcoin atomic swaps on top
of the core's swap module:

* **Contract** (`core/src/swap/htlc.ts`): the Decred atomicswap script, as P2SH on both chains.
  `parseHtlc` accepts only that exact template (it re-encodes the script and compares), and
  `extractSecret` reads the secret from any spend of the contract.
* **Protocol rules** (`protocol.ts`): roles, lock times (joiner 48 h, starter 24 h ending at
  least 12 h earlier), the claim margin, chain-clock lag, confirmations (12 LBC, 2 BTC), and
  `checkContract`, which names every problem with the other side's contract.
* **Codes** (`codes.ts`): `lbcswap:` + base64url JSON + a checksum. An invite carries the
  amounts and the starter's key hash; a lock code carries a contract and its funding outpoint.
* **Chains** (`chain.ts`): LBC through the wallet's own backend (hub or node). A funding payment
  from a hub must come with a merkle proof against proof-of-work headers. Bitcoin goes through
  every configured Esplora server (`net/esplora.ts`). Contract transactions are merged from all
  of them, so one server can't hide the other person's claim. Funding counts only when every
  server reports it the same way, and broadcasts go to all of them.
* **Untrusted spends:** a reported spend of our contract counts only if it is our refund or
  carries the secret, and a spend of theirs only if it is our claim or comes after their lock
  time. Nothing else can exist, so a lying server can't stop a refund or a claim.
* **The engine** checks the open wallet's active swaps every 30 seconds and moves each one
  forward. It detects payments into both contracts, checks theirs, collects with the secret,
  reads the secret from the other chain, and refunds after the lock time plus the chain's clock
  lag. Swap keys and the secret are random per swap and live in the wallet's sealed state next
  to its transactions and labels.
* **Tests:** unit tests pin the exact contract layout and the protocol rules. They also run the
  engine against fake servers that forge spends or hide transactions. The end-to-end
  tests run four full scenarios between two wallets on a real `lbcd` and a real `btcd`
  (through `core/e2e/esplora-emulator.ts`), with time rules shortened to minutes. One swap
  completes, each side gets a refund once, and a dishonest lock code is refused. The mainnet
  check queries the real Bitcoin explorers.

## Built-in node

`apps/desktop/src/main/node-service.ts` runs **lbcd**, LBRY's official full node written in Go,
the way the Monero GUI runs `monerod`:

* `scripts/build-lbcd.sh` builds lbcd v0.22.119 from the published release source for every
  platform (after checking the source hash) into `resources/bin/<os>-<arch>/`, and
  electron-builder ships it in the installers. No code is changed.
* Before starting, the service checks the chosen folder: writable, and enough free space (about
  150 GB for mainnet). It starts lbcd at below-normal priority with `--txindex --addrindex`
  (needed to look up a wallet's history), RPC on `127.0.0.1` with fresh random credentials,
  outbound-only by default (`--nolisten`), and `--proxy` when SOCKS5 is on.
* Peers come from lbcd's DNS seeds; since those currently point at dead nodes, the service
  asks lbcd (`addnode … onetry`) to try the network's `bootstrapPeers` when it has had no peer
  for 45 seconds. The weekly mainnet check probes the seeds and the bootstrap peers.
* It polls the node for headers, blocks, peers and disk use to show progress and a time
  estimate. When the best block is recent, the node counts as synced and
  `WalletService.localNodeChanged()` swaps the wallet's backend from hubs to an `LbcdBackend`
  on the node (and back if the node stops). Solo mining uses the same node.
* Stopping asks lbcd to shut down cleanly over RPC and waits up to 90 seconds before forcing
  it. Quitting the app stops the node the same way; a node that was running starts again with
  the app next time.

## Android app

`apps/mobile` is a Capacitor app: the shared UI and services are bundled by Vite into the APK
and run in the system WebView, with no remote content.

* `LbcNativePlugin.java` provides what the WebView cannot do safely: raw TCP/TLS sockets for the
  hub protocol (with host-name verification), atomic file writes in private storage, the
  clipboard (sensitive copies are flagged and cleared), sharing, links and `FLAG_SECURE`.
* **Phone mining** (`src/miner-service.ts`, `src/mining/`): the same Stratum client and
  WebAssembly scanner as the desktop, with hashing in Web Workers that the coordinator drives
  in short bursts. The pool connection uses the native sockets. `PhoneMinerService` mines only
  while the app is in the foreground (and keeps the screen on), and pauses on Android's
  battery and thermal signals. It reads them from `LbcNativePlugin.powerState()`: charging,
  level, battery temperature, power saver and thermal status. Pool mode only, with no built-in
  node, since a phone has neither the space nor the battery for it.
* Hardening in the manifest: no cloud backup or device transfer, no plain-text HTTP, only system
  certificate authorities, a single exported activity.
* The release workflow builds and signs the APK; see [BUILDING.md](BUILDING.md) for the signing
  key.

## Desktop security model

* Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`, strict CSP, navigation and
  window creation blocked, all permission requests denied.
* The renderer never sees private keys except the recovery phrase during the backup screen.
  It imports only `@lbcwallet/core/ui` (formatting helpers).
* IPC handlers check the sender frame and validate every argument.
* With "ask for the password on every send" (default), the decrypted account key exists only
  while signing and is wiped afterwards.
* Auto-lock after inactivity, on sleep and on screen lock.
* Electron fuses: `runAsNode`, `NODE_OPTIONS` and inspector arguments disabled; asar
  integrity validation on.
* The spellchecker is disabled for every session (no dictionary downloads), and the app's
  own HTTPS requests follow the SOCKS5 setting. A net-log based audit in CI checks that the
  app makes no unexpected requests.
* Secret screens (recovery phrase, private key) turn on window content protection, which keeps
  the window out of screenshots and screen sharing on Windows and macOS.

See [SECURITY.md](SECURITY.md) for the threat model.
