# Roadmap

## Where we are (version 1.3)

| | Status |
| --- | --- |
| Desktop wallet for Windows, macOS, Linux (x64 and ARM64) | done |
| Built-in miner (pool and solo), pause on battery, mine only when idle | done |
| **Built-in full node** (LBRY's official `lbcd`, bundled), choose where the blockchain is stored, wallet switches to it once synced, solo mining through it | done |
| **Android app** (APK), a complete wallet on its own, same code and screens as desktop, **pool mining on the phone** while it is charging and cool | done |
| **Atomic swaps LBC ↔ Bitcoin** in the wallet, person to person, no exchange or escrow | done (1.2) |
| **Market**: an order board for LBC ↔ Bitcoin over Nostr relays, offers priced against MEXC, taken offers settled as atomic swaps between the two wallets | done (1.3) |
| LBC supply figures (left to mine, reward now, next drop) | done (1.2) |
| **15 languages**, including right-to-left Persian, Arabic and Urdu, and Hindi (1.3) | done |
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
sockets, screenshot blocking, clipboard and sharing). Since 1.2 it is a complete wallet on its
own and mines through a pool. Next:

* QR-code scanning for addresses, biometric unlock (Android Keystore), push-free payment
  notifications while the app is open.
* Distribution beyond the APK: **F-Droid** (needs reproducible builds; the build already
  avoids Google services and embedded dependency metadata). **Google Play** does not allow apps
  that mine on the device, so a Play version would have to leave phone mining out.
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

1. **Atomic swaps in this wallet — LBC ↔ BTC is done (1.2).** Hash-time-locked contracts
   (the Decred atomicswap contract with `OP_CHECKLOCKTIMEVERIFY`) need no arbitrator, no escrow
   agent and no new network. Each wallet watches both chains. The other side's contract is
   checked byte by byte. LBC payments are checked with SPV proofs, and Bitcoin payments are
   cross-checked between two explorers. Today the two people exchange short codes in any chat.
   Next steps:
   * **Litecoin and Dogecoin** use the same contract. What is missing is a reliable public
     server to read their chains (an Esplora-style API) and tests against their nodes.
   * **An offer board — done in 1.3 (the Market).** Offers are Nostr events (kind 30078,
     with proof of work) on five public relays by default; a take, the answer and the lock codes
     are NIP-44-encrypted messages between per-offer and per-trade keys, and the two wallets run
     the swap between themselves. Next for the Market:
     * **Proof of funds** for offers that sell LBC (a signature from an address holding the
       amount, checked against the chain), so fake offers cannot fill the board.
     * **Optional reputation**: a maker may keep one key across offers and show finished trades,
       at some cost in privacy.
     * **Automatic locking for makers** who choose it (keeping a spending authorisation for the
       offer's amount while it is open), so a taken offer does not wait for its maker.
     * Notifications on the phone when an offer is taken while the app is in the background.
   * **Not possible the same way:** **USDT, Ether and Solana tokens** have no Bitcoin-style
     scripts. Swapping them needs an HTLC smart contract on Ethereum or Solana, plus a wallet
     for that chain inside the app. **Monero** has no scripts at all. LBC ↔ XMR would need
     adaptor signatures (the protocol used for BTC ↔ XMR by COMIT and UnstoppableSwap), a large
     cryptography project that should be audited before anyone uses it.
   * We looked at plugging in an existing multi-coin swap engine: the Komodo DeFi Framework,
     which GLEEC also maintains as a fork. Its coin list does include LBC. But it would add a
     large native program (written in Rust) to every installer and to the phone app, with its own
     peer-to-peer order book. Its LBC side also relies on Electrum servers run by a single
     operator (cipig.net). A small contract inside the wallet, tested on real nodes, is easier
     to review and keeps the wallet independent.
2. **Measure demand.** The Market is the order book; if it attracts makers and takers, add
   reputation and optional mediation.
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
* Swaps, from the October 2026 review (`docs/REVIEW-2026-10.md`): refund a second payment into a
  contract instead of only the first; fee-bump a claim that is stuck under the mempool floor;
  recognise the wallet's own claim or refund by its key when the record of it was lost.

## 5a. A validated header chain

The light client's biggest remaining weakness: for ordinary payments the confirmation count still
comes from the hub, checked only against the block's own proof of work. The plan is a header
chain validated since an embedded checkpoint (LBRY's per-block difficulty rule is already ported
in `core/src/wallet/headers.ts`, and swaps already require a linked run of headers plus a second
hub's agreement): every confirmation would then come from the wallet's own view of the chain,
with checkpoints maintained in the repository and only the headers since the checkpoint
downloaded (about 1 MB a week; a phone can afford it).

## 6. Trust: audit, signing, reproducibility

* **An external security audit** of the core (key derivation, encryption, signing, SPV checks),
  the Android plugin and the release pipeline. Until then the app warns everyone, on first
  start and in Settings → About, that it is unaudited. A line-by-line review by a second AI
  model was done before 1.3.0 (`docs/REVIEW-2026-10.md`); it found and fixed real bugs and is
  the natural starting point for the audit, but it is not one.
* Defence in depth on the desktop, from the same review: serve the interface from an app scheme
  instead of `file://`, keep the main-process code inside the integrity-checked archive, take
  the node's data folder only from the folder dialog, retry a node's stop call before killing it.
* Code signing: Apple notarization and Windows code signing (the release workflow already
  supports both once certificates are added as secrets), and a stable Android signing key.
* Reproducible builds: the miner's WebAssembly and the bundled `lbcd` are already built
  reproducibly from pinned, verified sources in CI.
