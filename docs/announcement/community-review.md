# Telegram post: the code review (version 1.3.0)

For the LBRY / LBC Telegram group. No links or web addresses (the group prefers names): say
"GitHub, repository mnaghshvarian / lBC-wallet-with-mining-ability" and "the Releases page".
Plain text, under Telegram's 4,096-character limit. Post it once the 1.3.0 release is published.

---

🔍 LBC Wallet 1.3.0: reviewed, fixed, and honest about what it is

Before publishing 1.3.0 I had the whole code of LBC Wallet reviewed a second time. The wallet was
written with one AI model; a second, different AI model then read every part of it line by line
(swaps, the Market, keys and transactions, the desktop and Android apps, mining) and I re-checked
its findings against the code before anything changed.

What it found, in plain words:
• One serious problem: the wallet trusted a hub server's word about which LBC payments were
"confirmed" more than it should have, and a swap relied on that before coins moved. Fixed: in a
swap, the other side's LBC payment now has to be backed by a chain of block headers that obeys
LBRY's own rules and confirmed by a second, independent hub before anything of yours moves.
• Typing an amount with a decimal comma (12,5) could send ten times too much. Fixed, together
with Persian, Arabic and Hindi digits.
• A few cases where an honest person's coins could get stuck for a day or two (a trade partner
who went offline, a wallet that auto-locked mid-swap, a Bitcoin explorer that lied). Fixed.
• Smaller things in the miner, unlock screen and fee handling. Fixed.

What it did NOT find: problems in the cryptography, the key derivation, transaction signing, the
swap contract, the encryption of wallet files, or the app hardening. All of those matched their
references.

What this is not: an audit. A second AI model reading the code is a useful check, and it caught
real bugs, but it is not an independent security audit by human experts, which this project still
needs before anyone trusts it with meaningful amounts. The full list of findings, what was fixed
and what is still open is in the repository (docs, file REVIEW-2026-10), so you can judge for
yourself.

Rules that have not changed:
• Experimental software, no warranty, use at your own risk. Small amounts only.
• Write your recovery phrase on paper. Nobody from the project will ever ask for it.
• Download only from the project's GitHub Releases page and check the SHA-256 checksum.
• Keep the app open until a swap or trade says Done. Pay into a swap contract once, never twice.

Where: GitHub, repository mnaghshvarian / lBC-wallet-with-mining-ability, Releases page.
Windows, Mac, Linux and Android, in 15 languages. New with this version: a video manual, six
short narrated videos (installing, your first wallet, restore and send, mining and the node, the
Market, settings), next to the written manual on the Releases page.

If you can read code, the best help now is to read it and report what you find (privately, through
a security advisory on the repository, for anything that could cost someone money). If you run a
hub, consider offering it for the wallet's default list: two independent hubs are what the new
checks rely on.
