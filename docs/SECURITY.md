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
| A malicious or broken hub server | Servers never receive keys. Transaction data is checked against the requested txid, confirmations are verified with merkle proofs against proof-of-work headers (re-checked with fresh data if a reorganisation replaces a block), and transactions are signed locally. A malicious hub can still hide transactions or lie about unconfirmed ones; use several hubs or your own node for maximum assurance. |
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
  or typed, the screen is marked secure: screenshots, screen recordings and the recent-apps
  preview show a black screen. (On Windows and macOS the desktop app likewise hides its window
  from screenshots and screen sharing on those screens.)
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
* **Incoming connections** (off by default) — when you switch this on, the node accepts
  connections on port 9246 and asks your router to open that port (UPnP). Anyone on the internet
  can then see that your IP address runs an LBRY node. Leave it off for privacy.
* **With SOCKS5/Tor on**, the node's outgoing peer connections and its DNS seed lookups also go
  through the proxy (takes effect the next time the node starts). Lookups use Tor's name
  resolution, so with a SOCKS5 proxy that is *not* Tor, add peers by IP address in the node
  settings. Incoming connections, if you switch them on, still reach your computer directly.
* **Storage** — the blockchain folder you choose holds public data only (no keys). Your wallet
  files stay in the app's data folder.

## What the wallet connects to

| Connection | When | What it reveals |
| --- | --- | --- |
| LBRY hubs | While a wallet is open (until your own node is in sync) | Your addresses (as script hashes) and your IP address to the hub operator. LBRY's public hubs use unencrypted connections (as LBRY Desktop does), so your network provider can see them too — use Tor or your own node to avoid that. |
| Your own node (built-in or configured) | While a wallet is open | Nothing outside your computer or network |
| Other LBRY nodes (peer-to-peer) | Only while the built-in node runs | Your IP address, as an LBRY node |
| Price API (CoinPaprika, CoinGecko as fallback) | Only if *Show fiat value* is on | Your IP address |
| Mining pool | Only while mining | Your payout address and IP address |
| Pool balance API (e.g. lbrypool.net) | When the Mining page shows the pool balance | Your payout address |
| Block explorer | Only when you click a link (opens in your browser) | The transaction or address you open |

Nothing else: no telemetry, crash reports, analytics or automatic update checks, and
Chromium's spellchecker (which would download dictionaries from Google) is turned off. An
automated network audit (`npm run test:privacy`, run in CI against the packaged app) fails
if the app makes any HTTP request at startup other than the optional price feed.

**Tor / SOCKS5 (desktop).** With the SOCKS5 option on, hub, pool, price and pool-balance
connections all go through the proxy, and host names are resolved by the proxy, so DNS does not
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
