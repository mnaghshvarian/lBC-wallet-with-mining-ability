# Architecture

LBC Wallet is split into a platform-agnostic **core** and a thin **desktop shell**.
The same core is meant to power the future iOS/Android apps (see [ROADMAP.md](ROADMAP.md)).

```
lbc-wallet/
├── packages/
│   ├── core/                 @lbcwallet/core — TypeScript, no Node/Electron dependencies
│   │   ├── src/
│   │   │   ├── networks.ts       LBC mainnet/testnet/regtest parameters (from lbcd chaincfg)
│   │   │   ├── address.ts        base58check (0x55 "b…", 0x7a "r…"), bech32 "lbc1…", WIF
│   │   │   ├── script/           standard scripts + LBRY claim/support/update prefixes
│   │   │   ├── keys/             BIP39, LBRY ("lbryum") seeds, BIP32/BIP44 derivation
│   │   │   ├── tx/               serialization, legacy sighash, signing, coin selection
│   │   │   ├── vault.ts          scrypt + AES-256-GCM sealed boxes
│   │   │   ├── net/              line-JSON-RPC, LBRY hub client, lbcd RPC backend
│   │   │   ├── wallet/           sync engine, SPV verification, keystore, restore scan
│   │   │   ├── mining/           Stratum client, solo GBT work, coordinator, WASM scanner
│   │   │   ├── ui.ts             key-free formatting entry for user interfaces
│   │   │   └── node/             Node.js TCP/TLS/SOCKS5 and HTTP transports
│   │   ├── test/                 unit tests (LBRY SDK vectors, consensus vectors)
│   │   └── e2e/                  tests against a real lbcd (regtest) + hub emulator + test pool
│   └── miner-wasm/           C source of the LBRY proof-of-work scanner → WebAssembly
└── apps/
    └── desktop/              Electron app
        ├── src/main/             main process: wallet/miner/price services, IPC, storage
        │   └── mining/           utility process + worker threads that run the miner
        ├── src/preload/          contextBridge → window.lbc (typed API, no Node access)
        ├── src/renderer/         React UI
        ├── src/shared/api.ts     the typed IPC contract
        └── e2e/ui.e2e.ts         Playwright test driving the real app
```

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

See [SECURITY.md](SECURITY.md) for the threat model.
