# Roadmap

## Where we are (version 1.1)

| | Status |
| --- | --- |
| Desktop wallet for Windows, macOS, Linux (x64 and ARM64) | done |
| Built-in miner (pool and solo), pause on battery, mine only when idle | done |
| **Built-in full node** (LBRY's official `lbcd`, bundled), choose where the blockchain is stored, wallet switches to it once synced, solo mining through it | done |
| **Android app** (APK), same wallet code and screens as desktop; pool-balance monitor instead of mining | done |
| **14 languages**, including right-to-left Persian, Arabic and Urdu | done |
| Disclaimer that must be accepted on first start; beginner manual with pictures | done |
| Independent security audit | **not yet — see below** |

The order of the next steps follows what the community asked for: a **decentralized mining
pool** in the wallet, then a **decentralized exchange** for LBC. Everything builds on the
shared code that both apps already use: `@lbcwallet/core` (keys, LBRY seeds, transactions, hub
client, SPV checks, mining protocol) and `@lbcwallet/services`.

---

## 1. A decentralized mining pool inside the wallet (P2Pool style)

**Why.** Today's choice is between a pool (an operator holds the rewards, sets the fees, can
disappear or censor) and solo mining (no operator, but a normal computer would wait years for a
block). A decentralized pool gives small miners regular payouts **without an operator**.

**How it works** (the design used by [P2Pool](https://en.bitcoin.it/wiki/P2Pool) on Bitcoin and,
very successfully, by [P2Pool for Monero](https://github.com/SChernykh/p2pool)):

1. Participants mine on a **share chain**: a side chain of blocks with a much lower difficulty
   (a new share every ~10–30 seconds) that the wallets keep among themselves over a
   peer-to-peer network.
2. Every share is built on a real LBC block template from the participant's **own full node**
   (the built-in node from version 1.1), and its coinbase transaction pays **all recent share
   finders** in proportion to their shares (PPLNS, "pay per last N shares").
3. When a share also meets the LBC network difficulty, it *is* a valid LBC block: it is
   broadcast, and the reward goes **directly from the block's coinbase to every participant's
   address**. Nobody ever holds anyone's coins and there is no pool fee.
4. Each wallet checks every share it receives (proof of work at share difficulty, a valid
   template against its own node, the exact payout list computed from the share chain), so a
   cheater gets nothing but rejected shares.

**LBRY specifics we already handle in the code:** 112-byte headers with the claim-trie root,
block templates from `lbcd` (`getblocktemplate` with the claim-trie root), building our own
coinbase and merkle branch, and submitting blocks — all used by today's solo mining.

**Milestones**

1. Written specification: share format, share-chain difficulty retargeting, PPLNS window, uncle
   shares, minimum payout and dust handling (LBC's dust limit means very small shares are
   carried over, as in Monero's P2Pool), network messages.
2. Share chain and payout calculation in `@lbcwallet/core`, with simulations and regtest
   end-to-end tests (several wallets mining together on a private network).
3. Peer-to-peer layer: bootstrap list, peer exchange, UPnP, optional Tor, ban scores.
4. In the app: **Mining → Mode → Decentralized pool (beta)**, with a share-chain view and
   expected-payout estimates.
5. Public testnet trial, then an external review of the payout rules before real funds.

**Honest limits.** LBC is mostly mined by specialized hardware. A decentralized pool helps
small miners only as much as hashrate joins it; with little hashrate, blocks (and payouts) stay
rare. It also needs each participant to run a full node (about 150 GB), which the wallet now
makes easy.

---

## 2. Android, and later iOS

The Android app shipped in 1.1 (Capacitor, with a small native plugin for files, TCP/TLS
sockets, screenshot blocking, clipboard and sharing). Next:

* QR-code scanning for addresses, biometric unlock (Android Keystore), push-free payment
  notifications while the app is open.
* Distribution beyond the APK: **F-Droid** (needs reproducible builds — the build already
  avoids Google services and embedded dependency metadata) and possibly Google Play. Play
  forbids mining on the device, which the app already respects (it only shows pool balances).
* **iOS** is possible with the same code. Apple's rules require wallet apps to be published by
  an **organization** account (App Store Review Guideline 3.1.5(i)) and forbid on-device mining
  (3.1.5(ii)), so it needs a legal entity first.

---

## 3. A peer-to-peer exchange for LBC (Bisq / Haveno style)

The goal: let people swap LBC for other coins or fiat without a custodial exchange.

**How Bisq and Haveno work.** Both are Java desktop apps that connect traders over Tor. Trades
are secured by non-custodial multisignature escrow plus security deposits, and a mediator or
arbitrator settles disputes without ever holding the funds. Bisq is built around Bitcoin;
[Haveno](https://github.com/haveno-dex/haveno) is a Monero-based fork (AGPL-3.0) whose wallet
and trade protocol rely on Monero's multisig.

**What "fork Haveno/Bisq for LBC" really means.** LBC has Bitcoin's script system (with
`CHECKLOCKTIMEVERIFY`/`CHECKSEQUENCEVERIFY` active since block 200,000 and segwit since
680,770), so 2-of-2 or 2-of-3 multisig escrow with time locks is straightforward on-chain. The
work is in the software. Haveno's wallet and trade protocol would have to be rewritten from
Monero multisig to Bitcoin-style scripts, and Bisq's bitcoinj base would need a fork that
understands LBC's 112-byte headers and claim scripts. A fork must also stay AGPL. Running a fiat
market adds mediators/arbitrators, payment-method rules and legal review in every country it
serves.

**Liquidity decides the order.** LBC trades only small volumes on tracked markets, almost all
on one centralized exchange. An order book needs buyers and sellers on both sides. So the
recommended path is:

1. **Atomic swaps in this wallet (LBC ↔ BTC, then LTC and others).** Hash-time-locked contracts
   (HTLC with `OP_CHECKLOCKTIMEVERIFY`) need no arbitrator, no escrow agent and no new network.
   Each side's wallet watches its own chain, and offers can be published over a simple relay
   (for example Nostr). The core already has the needed pieces: script building, signing, SPV
   verification and a hub client.
2. **Measure demand.** If swaps attract makers and takers, add an order book with reputation
   and optional mediation.
3. **Only then a Haveno-style fiat market**, either as a fork with LBC multisig escrow or by
   contributing LBC support to an existing network — whichever the community can operate and
   maintain.

---

## 4. Mining

* **GPU mining with WebGPU.** The LBRY hash as a WebGPU compute shader inside the app, so no
  third-party miner binaries are needed (those trip antivirus software). A mid-range GPU should
  outperform the CPU miner by one to two orders of magnitude.
* More pool presets as LBC pools appear. Any yiimp/NOMP LBRY pool already works as a custom
  pool.
* Optional "start mining when the app starts" and a tray icon for dedicated mining computers.

## 5. Wallet

* **Tips and creators**: resolve `lbry://` URLs and channels through the hub and send tips
  (support outputs) to creators. Unlocking tips you received is already built in.
* Hub discovery (`server.peers.subscribe`) on top of the built-in list, so the wallet keeps
  working if well-known hubs disappear. The built-in node is always an option.
* Message signing and verification, coin control, sweeping a private key (WIF) from an old
  `lbrycrd`/`lbcd` wallet.
* In-app update notifications with signature-verified downloads.

## 6. Trust: audit, signing, reproducibility

* **An external security audit** of the core (key derivation, encryption, signing, SPV checks),
  the Android plugin and the release pipeline. Until then the app warns everyone, on first
  start and in Settings → About, that it is unaudited.
* Code signing: Apple notarization and Windows code signing (the release workflow already
  supports both once certificates are added as secrets), and a stable Android signing key.
* Reproducible builds: the miner's WebAssembly and the bundled `lbcd` are already built
  reproducibly from pinned, verified sources in CI.
