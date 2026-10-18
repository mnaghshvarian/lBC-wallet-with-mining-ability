# Security model

LBC Wallet is **non-custodial**: keys are generated and stored only on your own device — your
computer or your phone. Nobody, including the developers or the servers the wallet talks to, can
move your funds.

> [!WARNING]
> **This code has not been independently audited.** This page describes what the wallet is
> *designed* to do; only a review by independent security experts can confirm it does so without
> mistakes. Use small amounts and read the [disclaimer](../DISCLAIMER.md).

## What protects your funds

| Threat | Mitigation |
| --- | --- |
| Someone copies your wallet file | The recovery phrase/key is encrypted with your password using scrypt (N=2¹⁷, r=8, p=1, 128 MB) and AES-256-GCM. Use a long, unique password. |
| Malware on the device | Not fully preventable by any software wallet. Keys are decrypted only for signing (default), the wallet auto-locks, and sensitive clipboard contents are cleared after 30 s. Use a clean, updated system; on Android, install apps only from sources you trust. |
| A malicious or broken hub server | Servers never receive keys, and transactions are signed locally. Transaction data is checked against the requested txid, and every block header a hub announces must carry valid LBRY proof of work. For ordinary payments the confirmation count comes from the hub: the wallet checks the merkle proof and the block's own proof of work (re-checked with fresh data if a reorganisation replaces a block), **not** that the block is part of the real chain — so a hub that lies can show a payment as confirmed that is not, though it can never touch your keys or coins. Before coins move in a swap, the stronger check described under *Swaps* applies. Use your own node for maximum assurance. |
| A compromised UI page (desktop) | The renderer is sandboxed with a strict Content-Security-Policy, cannot navigate or open windows, and can only call a narrow, validated API. It never holds private keys (except the recovery phrase on the backup screen). |
| Tampering with the installed desktop app | Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, the app only loads from its archive, and on Windows and macOS the archive's integrity is validated at startup. Signed builds add OS-level verification. |
| A fake download | Download only from the project's GitHub Releases page and compare the SHA-256 checksum. The bundled node (`lbcd`) is built in CI from LBRY's published source, whose hash is pinned in `scripts/build-lbcd.sh`. |
| Losing your device | Your recovery phrase restores everything. Write it on paper; never store it in a screenshot, cloud note or chat. |

## Android

The Android app runs the same wallet code as the desktop app, inside the app's own sandbox:

* **Storage** — wallet files live in the app's private storage, which other apps cannot read.
  Every write goes to a temporary file that is synced to disk and then renamed, so a crash or a
  flat battery leaves the old or the new file, never a broken one.
* **No cloud copies** — Android backups and device-to-device transfer are switched off for all
  app data (`allowBackup="false"` and data-extraction rules), so wallet files are never uploaded
  to a cloud backup. Your recovery phrase is the backup.
* **Screenshots blocked on secret screens** — while a recovery phrase or private key is shown
  or typed, the screen is marked secure: Android refuses screenshots, and screen recordings and
  the recent-apps preview show a black screen (checked in CI on an Android 14 emulator). On
  Windows and macOS the desktop app likewise hides its window from screenshots and screen
  sharing on those screens.
* **Network** — the WebView that draws the UI may load only the app's bundled files (strict
  Content-Security-Policy, no network access of its own). Hub connections are native sockets
  (for hubs that offer TLS, the certificate *and* the host name are verified); prices and pool
  statistics use native HTTPS only. Plain-text HTTP is disabled and only the system's
  certificate authorities are trusted (certificates added by the user or a device manager are
  not).
* **Clipboard** — copied secrets are marked sensitive (hidden from the clipboard preview on
  Android 13+) and cleared after 30 s while the app is open.
* **Auto-lock** — the wallet locks after the inactivity time also when you come back to the app
  after it was in the background.
* **Process model** — unlike on the desktop, the wallet services and the screens run in the same
  app process (Android isolates the app as a whole). The UI contains no remote content.
* **Mining** runs in the app itself: the WebAssembly miner works in background threads of the
  WebView (Web Workers), and the pool connection uses the same native sockets as the hubs. It
  runs only while the app is on the screen. It pauses when the phone is not charging (unless you
  allow battery mining, and then still below 30 %), at a battery temperature of 40 °C (until it
  is below 37 °C), when Android reports thermal throttling, and in battery saver.
* **SOCKS5/Tor** is not available on Android yet.
* **Updates** — Android only installs an update signed with the same key as the installed app.
  Builds named `…-test-key.apk` are signed with a temporary key; see the
  [release notes](release-notes.md).

## Built-in node

The desktop app can run **lbcd**, LBRY's official full node, the way the Monero GUI runs
`monerod`:

* **Unmodified** — `lbcd` v0.22.119 is built from LBRY's published release source; the build
  stops if the source hash differs from the pinned value.
* **Private control channel** — the node's RPC interface listens only on `127.0.0.1` (this
  computer) with a random user name and password created on every start, so other computers on
  your network cannot control it.
* **Peer-to-peer** — the node downloads the whole blockchain from other LBRY nodes. That reveals
  your IP address to those peers as someone running an LBRY node, but **not** which addresses
  are yours: once the node is in sync, the wallet asks only your own node, so public hub servers
  no longer learn your addresses.
* **Finding the first peers** — LBRY's DNS seeds currently point at nodes that no longer
  answer. If the node has no peer 45 seconds after starting, it asks LBRYPool's public node
  (`lbrypool.net:9246`) once, which tells it about other nodes. That node sees your IP address,
  like any peer.
* **Incoming connections** (off by default) — when you switch this on, the node accepts
  connections on port 9246 and asks your router to open that port (UPnP). Anyone on the internet
  can then see that your IP address runs an LBRY node. Leave it off for privacy.
* **With SOCKS5/Tor on**, the node's outgoing peer connections and its DNS seed lookups also go
  through the proxy (takes effect the next time the node starts). Lookups use Tor's name
  resolution, so with a SOCKS5 proxy that is *not* Tor, add peers by IP address in the node
  settings. Incoming connections, if you switch them on, still reach your computer directly.
* **Storage** — the blockchain folder you choose holds public data only (no keys). Your wallet
  files stay in the app's data folder.

## Swaps (LBC ↔ Bitcoin)

Swaps are **atomic swaps** with hash-time-locked contracts. Neither person, and no third party,
can take the other's coins:

* **The contract** is the one from Decred's
  [atomicswap](https://github.com/decred/atomicswap) tool, used as a P2SH script on both chains.
  The coins can go to the other person with the secret that matches a SHA-256 hash, or back to
  their owner after a lock time. The person who joins makes the 32-byte secret, locks first and
  for longer (48 hours). The person who started locks second, for 24 hours, and their lock ends at
  least 12 hours before the joiner's.
* **Nothing is trusted blindly.** Before the wallet locks coins or reveals the secret, it rebuilds
  the other side's contract byte by byte and checks it. It must pay to this wallet's key, use the
  same secret hash and have a lock time in the agreed window. The payment into it must be large
  enough and confirmed.
  * **LBC** needs 12 confirmations. When the wallet uses public hubs, the payment must come with
    a merkle proof, and the hub must send every block header from the payment's block to the
    current tip: each with valid proof of work, each linking to the one before, and each with
    exactly the difficulty LBRY's rule requires (`core/src/wallet/headers.ts`, ported from lbcd).
    A second hub on another host must then report the same blocks — the payment's and the twelve
    that confirm it. If the hubs disagree, or the headers do not hold together, the swap stops
    with a visible problem and nothing of yours moves. With a single hub configured (your own
    choice, typically your own hub) that hub's word is taken and a warning is logged; with your
    own node, the node checks everything itself.
  * **Bitcoin** needs 2 confirmations. Every explorer (blockstream.info and mempool.space, run
    by different companies) must report the payment the same way.
* **Servers can lie, so the wallet checks.** A server could hide a transaction, or report one
  that doesn't exist. Only two transactions can ever spend a swap contract: the owner's refund
  after the lock time, or the claim that carries the secret. The wallet ignores any other
  reported spend, so a lying server cannot block a refund or a claim. Every reported spend is
  examined, so a false one listed first cannot hide the real claim behind it. On Bitcoin every
  explorer is asked, so one that hides the other person's claim is outvoted, and one that is down
  or rate-limited does not stop a claim or refund: the tip and the fee come from whichever
  explorers answer (the median fee), and the fee rate is bounded (at most 1,000 sat/vB and a
  quarter of the amount), so a wrong or hostile estimate cannot burn the amount. On LBC the
  wallet reads one server at a time. For large swaps, use the built-in node or your own node.
* **One payment per contract.** The wallet tracks the first payment into a contract. If a
  payment was too small, do not "top it up" with a second one: the app refunds only the first;
  wait for the refund and start again. The wallet writes a contract to disk before paying into
  it, so a crash right after paying cannot lose its lock time.
* **The inactivity auto-lock waits** while a swap is running, so the wallet can collect or
  refund by itself; locking it yourself, closing the app, sleep and the screen lock still stop
  it.
* **Timing margins.** The person who joined reveals the secret only while the other contract
  still has at least 4 hours left. Refunds wait until each chain's own clock has passed the lock
  time. That clock lags real time by up to about 20 minutes on LBC and 90 minutes on Bitcoin.
* **Keys and secret** are random for every swap. They are kept in the wallet's encrypted state,
  like your contacts and notes. They are not derived from your recovery phrase, so **a swap can
  only be finished or refunded on the device where it was made.** Don't uninstall the app,
  delete the wallet or restore it on another device while a swap is active.
* **The wallet must be open.** It collects and refunds by itself, but only while LBC Wallet runs
  with that wallet unlocked. The person who started is most at risk: once the other person
  collects, the wallet has to collect its own side before the other contract's lock time ends.
  Keep the app open until the swap shows *Completed*.
* **LBC's hashrate is small and concentrated.** On 18 October 2026, LBRYPool's statistics showed
  538 blocks found by that one pool in 24 hours, out of about 576 for the whole network. Whoever
  controls most of the hashrate could rewrite recent LBC blocks and so undo an LBC payment
  into a swap. This is why the wallet waits for 12 LBC confirmations, why swaps on mainnet are
  limited to 0.05 BTC, and why you should swap only amounts you can afford to lose.
* **Swap codes** (invites and lock codes) contain only public data: amounts, public key hashes,
  contracts and transaction ids. Anyone can read them, but nobody can use them to take coins.
* **Not audited**, like the rest of the wallet. The tests run full swaps between a real `lbcd`
  and a real Bitcoin node (`btcd`) on private test networks, including refunds and a dishonest
  contract. The Bitcoin explorers are checked against the real Bitcoin network every week.

## The Market (order board)

The Market lists offers to swap LBC and Bitcoin and turns a taken offer into an atomic swap, so
everything in the section above applies to its trades. On top of that:

* **Nobody holds coins and nobody is trusted.** There is no server of ours. Offers are signed
  Nostr events on public relays; the take, the answer and the swap codes are encrypted messages
  (NIP-44 version 2: secp256k1 key agreement, ChaCha20, HMAC-SHA256) between the two wallets.
  Every event is checked (id = hash of its content, BIP-340 signature) before it is used, and
  only events that match what was asked for are accepted, so a relay can withhold or delay
  messages but cannot forge or change them.
* **The swap checks do not change.** An invite from the other wallet must state exactly the
  amounts that were taken, and the joining wallet then checks the contracts on both chains as in
  any swap. A lock code that does not pay this wallet is refused, and a trade's messages are
  accepted only from that trade's other key and only for that trade's own swap.
* **Fresh keys.** Each offer has its own Nostr key, and each take another, kept in the wallet's
  encrypted state. Relays see that two keys exchange a few messages, and when, but not what they
  say or which wallets they belong to.
* **Spam and griefing.** Anyone can post offers (each needs a small proof of work) or take
  offers (a larger proof of work) and then walk away. The consequences are bounded: a take that
  is never followed by a lock blocks at most the taken part of an offer, for 40 minutes; an offer
  whose maker never locks keeps the taker's coins until their refund after 48 hours. Offers
  cannot yet prove that their maker holds the coins (planned: proof of funds). The app shows its
  own warning about this before the Market can be used.
* **Patience when offline.** A maker gives up on a taker who has not locked only once the relays
  have delivered everything they hold, so after sleep or an outage a lock code that is still on
  its way is not thrown away; a wallet that was locked meanwhile asks the relays again on unlock.
* **Stale or replayed messages** are ignored: takes older than 7 minutes, answers to takes that
  gave up, and any message for a trade in another state.
* **Your IP address** is visible to the relays you connect to (route the app through Tor with the
  SOCKS5 option on desktop to hide it).

## What the wallet connects to

| Connection | When | What it reveals |
| --- | --- | --- |
| LBRY hubs | While a wallet is open (until your own node is in sync) | Your addresses (as script hashes) and your IP address to the hub operator. LBRY's public hubs use unencrypted connections (as LBRY Desktop does), so your network provider can see them too — use Tor or your own node to avoid that. |
| Your own node (built-in or configured) | While a wallet is open | Nothing outside your computer or network |
| Other LBRY nodes (peer-to-peer), including LBRYPool's node to find the first peers | Only while the built-in node runs | Your IP address, as an LBRY node |
| Price API (CoinPaprika; MEXC's LBC/USDT market as a fallback for US dollars) | Only if *Show fiat value* is on | Your IP address |
| Nostr relays (five public relays by default, or those in *Settings → Network*) | While the Market page is open, and while you have open offers or running trades | Your IP address; the offers you post (public by design); encrypted trade messages between one-time keys |
| Market price (MEXC, CoinPaprika as fallback) | While the Market page is open | Your IP address |
| Mining pool | Only while mining | Your payout address and IP address |
| Bitcoin explorers (blockstream.info and mempool.space, or your own Esplora server) | While a swap is active, and when the swap form shows the Bitcoin fee | The contract addresses and transactions of your swaps, and your IP address (not your wallet's addresses) |
| Pool balance API (e.g. lbrypool.net) | When the Mining page shows the pool balance | Your payout address |
| Block explorer | Only when you click a link (opens in your browser) | The transaction or address you open |

Nothing else: no telemetry, crash reports, analytics or automatic update checks, and
Chromium's spellchecker (which would download dictionaries from Google) is turned off. An
automated network audit (`npm run test:privacy`, run in CI against the packaged app) fails
if the app makes any HTTP request at startup other than the optional price feed.

**Tor / SOCKS5 (desktop).** With the SOCKS5 option on, hub, pool, price, pool-balance,
Bitcoin explorer and Nostr relay connections all go through the proxy, and host names are resolved by the proxy, so DNS does not
leak either. The built-in node uses the proxy for its peer connections, as described above. The
connection to an lbcd node you configured yourself under *Settings → Network* is made directly
(it is normally on your computer or local network).

## What the wallet never does

* Send your recovery phrase or keys anywhere.
* Auto-update or download code at runtime.
* Spend claim outputs (channels/content). Only *supports/tips* can be unlocked, and only when
  you confirm it.
* Mine without you pressing *Start mining*, or start the node without you pressing *Start
  node*.

## Reporting a vulnerability

Please report security problems privately: open a **private security advisory** on the GitHub
repository (*Security → Report a vulnerability*) rather than a public issue, and never include
anyone's recovery phrase, password or keys.
