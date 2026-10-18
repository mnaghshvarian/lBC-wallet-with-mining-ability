# Security model

LBC Wallet is **non-custodial**: keys are generated and stored only on your computer. Nobody,
including the developers or the servers the wallet talks to, can move your funds.

## What protects your funds

| Threat | Mitigation |
| --- | --- |
| Someone copies your wallet file | The recovery phrase/key is encrypted with your password using scrypt (N=2¹⁷, r=8, p=1, 128 MB) and AES-256-GCM. Use a long, unique password. |
| Malware on the computer | Not fully preventable by any software wallet. Keys are decrypted only for signing (default), the wallet auto-locks, and sensitive clipboard contents are cleared after 30 s. Use a clean OS and keep it updated. |
| A malicious or broken hub server | Servers never receive keys. Transaction data is checked against the requested txid, confirmations are verified with merkle proofs against proof-of-work headers (re-checked with fresh data if a reorganisation replaces a block), and transactions are signed locally. A malicious hub can still hide transactions or lie about unconfirmed ones; use several hubs or your own lbcd node for maximum assurance. |
| A compromised UI page | The renderer is sandboxed with a strict Content-Security-Policy, cannot navigate or open windows, and can only call a narrow, validated API. It never holds private keys (except the recovery phrase on the backup screen). |
| Tampering with the installed app | Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, the app only loads from its archive, and on Windows and macOS the archive's integrity is validated at startup. Signed builds add OS-level verification. |
| Losing your computer | Your recovery phrase restores everything. Write it on paper; never store it in a screenshot or cloud note. |

## What the wallet connects to

| Connection | When | What it reveals |
| --- | --- | --- |
| LBRY hubs (or your lbcd node) | While a wallet is open | Your addresses (as script hashes) and your IP address to the hub operator |
| Price API (CoinPaprika, CoinGecko as fallback) | Only if *Show fiat value* is on | Your IP address |
| Mining pool | Only while mining | Your payout address and IP address |
| Pool balance API (e.g. lbrypool.net) | When the Mining page shows the pool balance | Your payout address |
| Block explorer | Only when you click a link (opens in your browser) | The transaction or address you open |

Nothing else: no telemetry, crash reports, analytics or automatic update checks, and
Chromium's spellchecker (which would download dictionaries from Google) is turned off. An
automated network audit (`npm run test:privacy`, run in CI against the packaged app) fails
if the app makes any HTTP request at startup other than the optional price feed.

**Tor / SOCKS5.** With the SOCKS5 option on, hub, pool, price and pool-balance connections all
go through the proxy, and host names are resolved by the proxy, so DNS does not leak either. The
connection to your own lbcd node is made directly (it is normally on your computer or local
network).

## What the wallet never does

* Send your recovery phrase or keys anywhere.
* Auto-update or download code at runtime.
* Spend claim outputs (channels/content). Only *supports/tips* can be unlocked, and only when
  you confirm it.
* Mine without you pressing *Start mining*.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
