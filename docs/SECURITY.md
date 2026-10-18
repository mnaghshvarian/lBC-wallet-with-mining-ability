# Security model

LBC Wallet is **non-custodial**: keys are generated and stored only on your computer. Nobody —
including the developers or the servers the wallet talks to — can move your funds.

## What protects your funds

| Threat | Mitigation |
| --- | --- |
| Someone copies your wallet file | The recovery phrase/key is encrypted with your password using scrypt (N=2¹⁷, r=8, p=1, 128 MB) and AES-256-GCM. Use a long, unique password. |
| Malware on the computer | Not fully preventable by any software wallet. Keys are decrypted only for signing (default), the wallet auto-locks, and sensitive clipboard contents are cleared after 30 s. Use a clean OS and keep it updated. |
| A malicious or broken hub server | Servers never receive keys. Transaction data is checked against the requested txid, confirmations are verified with merkle proofs against proof-of-work headers, and broadcast transactions are signed locally. A malicious hub can still hide transactions or lie about unconfirmed ones; use several hubs or your own lbcd node for maximum assurance. |
| Network observers | Use the SOCKS5 option (e.g. Tor) to hide your IP from hubs, pools and price APIs, or disable fiat prices. |
| A compromised UI page | The renderer is sandboxed with a strict Content-Security-Policy, cannot navigate or open windows, and can only call a narrow, validated API. |
| Losing your computer | Your recovery phrase restores everything. Write it on paper; never store it in a screenshot or cloud note. |

## What the wallet never does

* Send your recovery phrase, keys, addresses or balances anywhere except the hub/node queries
  needed to sync (addresses) and the pool (your payout address).
* Auto-update or download code at runtime.
* Spend claim outputs (channels/content). Only *supports/tips* can be unlocked, and only when
  you confirm it.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
