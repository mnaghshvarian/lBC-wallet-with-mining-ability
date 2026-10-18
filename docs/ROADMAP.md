# Roadmap

Version 1.0 delivers the **desktop wallet with a built-in miner** for Windows, macOS and Linux.
This document covers what comes next and the trade-offs behind each step. Everything here
builds on `@lbcwallet/core`, the platform-independent TypeScript core (keys, LBRY seeds,
transactions, hub client, SPV sync and mining protocol) that the desktop app already uses.

## 1. Mobile wallets: iOS and Android

**Approach.** A React Native (Expo) app that reuses `@lbcwallet/core` unchanged for keys,
addresses, signing, sync and SPV verification. The core has no Node.js or Electron
dependencies and uses audited pure-JavaScript cryptography (`@noble`/`@scure`), so phrases,
addresses and signatures are byte-for-byte the same as on desktop. Platform work:

* keys sealed with the iOS Keychain / Secure Enclave and the Android Keystore, unlocked with
  Face ID / Touch ID / fingerprint;
* TCP/TLS sockets to LBRY hubs (with the same failover list and optional Tor/SOCKS5);
* a native scrypt (the pure-JS one is slow on phones), QR scanning, share sheets and deep links;
* the desktop app's screens re-laid out for touch: overview, send, receive, activity, tips.

**No mining on phones, and that is a store rule, not just battery sense.** Apple's App
Store Review Guidelines say *"Apps may not mine for cryptocurrencies unless the processing is
performed off device"* (3.1.5(ii)) and forbid background mining (2.4.2). Google Play has not
allowed apps that mine on the device since 2018, only apps that *remotely manage* mining. The
mobile apps will therefore offer a **mining monitor** instead: the hashrate, shares and pool
balance of your desktop rigs.

**Publishing.** Apple only accepts wallet apps *"offered by developers enrolled as an
organization"* (3.1.5(i)), so the iOS app needs an Apple Developer account in an
organization's name (with a D-U-N-S number), not a personal one.

## 2. A peer-to-peer exchange for LBC (Bisq / Haveno style)

The goal: let people swap LBC for other coins or fiat without a custodial exchange.

**How Bisq and Haveno work.** Both are Java desktop apps that connect traders over Tor. Trades
are secured by non-custodial multisignature escrow plus security deposits, and a mediator or
arbitrator settles disputes without ever holding the funds. Bisq is built around Bitcoin;
[Haveno](https://github.com/haveno-dex/haveno) is a Monero-based fork (AGPL-3.0) whose wallet
and trade protocol rely on Monero's multisig.

**What "fork Haveno/Bisq for LBC" really means.** LBC has Bitcoin's script system (with
`CHECKLOCKTIMEVERIFY`/`CHECKSEQUENCEVERIFY` active since block 200,000 and segwit since
680,770), so 2-of-2 or 2-of-3 multisig escrow with time locks is straightforward on-chain. The work is in
the software. Haveno's wallet and trade protocol would have to be rewritten from Monero
multisig to Bitcoin-style scripts, and Bisq's bitcoinj base would need a fork that understands
LBC's 112-byte headers and claim scripts. A fork must also stay AGPL. Running a fiat market adds
mediators/arbitrators, payment-method rules and legal review in every country it serves.

**Liquidity decides the order.** LBC currently trades only a few dollars a day on tracked
markets (about $6 in 24 hours on CoinPaprika in October 2026, almost all on one centralized
exchange). An order book needs buyers and sellers on both sides. So the recommended path is:

1. **Atomic swaps in this wallet (LBC ↔ BTC, then LTC/others).** Hash-time-locked contracts
   (HTLC with `OP_CHECKLOCKTIMEVERIFY`) need no arbitrator, no escrow agent and no new
   network. Each side's wallet watches its own chain, and an order can be published over a
   simple relay (for example Nostr). The core already has the needed pieces: script building,
   signing, SPV verification and a hub client.
2. **Measure demand.** If swaps attract makers and takers, add an order book with reputation and
   optional mediation.
3. **Only then a Haveno-style fiat market**, either as a fork with LBC multisig escrow or by
   contributing LBC support to an existing network, whichever the community can operate
   and maintain.

## 3. Mining

* **GPU mining with WebGPU.** The LBRY hash as a WebGPU compute shader inside the app (Electron
  ships WebGPU), so no third-party miner binaries are needed (those trip antivirus software).
  A mid-range GPU should outperform the CPU miner by one to two orders of magnitude. WGSL has
  no 64-bit integers, so SHA-512 is emulated with 32-bit pairs.
* More pool presets as LBC pools appear. Any yiimp/NOMP LBRY pool already works as a custom pool.
* Optional "start mining when the app starts" and a tray icon for dedicated mining computers.

## 4. Wallet

* **Tips and creators**: resolve `lbry://` URLs and channels through the hub and send tips
  (support outputs) to creators. Unlocking tips you received is already built in.
* Hub discovery (`server.peers.subscribe`) on top of the built-in list, so the wallet keeps
  working if well-known hubs disappear. Your own lbcd node is always an option.
* Message signing and verification, coin control, sweeping a private key (WIF) from an old
  `lbrycrd`/`lbcd` wallet.
* Translations, starting with the languages the community asks for.
* In-app update notifications with signature-verified downloads.

## 5. Infrastructure and trust

* Reproducible builds and signed releases (Apple notarization, Windows code signing). The
  release workflow already supports signing once certificates are added as secrets.
* An external security review of the core (key derivation, signing, SPV checks) before
  mobile wallets ship.
