# Telegram announcement (draft)

Copy the text between the lines into the LBRY / LBC Telegram group. It is plain text, under
Telegram's 4,096-character limit, and the links work without formatting. Publish the GitHub
release first, so the download links work.

---

🚀 LBC Wallet — a free wallet for LBRY Credits with a built-in miner and full node (like the Monero GUI)

Hi everyone! I've been working on a community wallet for LBC and would love your help testing it.

What it does:
💰 Keep, send and receive LBC — non-custodial: your keys never leave your device
🔑 Restore your LBRY Desktop / Odysee recovery phrase (or any BIP39 phrase); unlock tips & supports you received
⛏️ Mine LBC from the app, on your computer or Android phone, through LBRYPool or solo, with pause-on-battery and mine-only-when-idle
🔄 NEW: swap LBC ↔ Bitcoin directly with another person, with no exchange and no middleman (atomic swaps: either both get paid or both get their coins back)
📊 NEW: how much LBC is left to mine (≈119.8 million of 1,083,202,000), the reward now (135 LBC) and when it drops
🖥️ Run your own LBRY full node from the app (official lbcd, bundled): pick where the blockchain is stored, and the wallet + solo mining use your own node
📱 Android app (APK): a complete wallet on its own, and it mines while charging
🌍 14 languages: English, فارسی, العربية, اردو, Français, Deutsch, Español, Português, Nederlands, Русский, 中文, 日本語, 한국어, ไทย
🔍 Every confirmation is checked against proof-of-work headers (SPV), no telemetry, optional Tor

Windows · Mac · Linux (deb, rpm, AppImage, ARM64) · Android

📥 Download: https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest
📖 Beginner's manual with pictures (no GitHub knowledge needed): https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/docs/manual/README.md

⚠️ IMPORTANT — please read:
• This is experimental, open-source software made by volunteers. It has NOT been audited yet and may contain bugs that lose money.
• You use it entirely at your own risk; the authors take no responsibility for any loss. Full disclaimer: https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/DISCLAIMER.md
• Test with small amounts. Write your recovery phrase on paper. Nobody from the project will EVER ask for it — anyone who does is a scammer.
• Download only from the GitHub link above.
• Be realistic about mining: a normal computer earns very little LBC, and a phone even less (the network is mostly specialized hardware). Mine to support the network, not for profit.
• Swaps are brand new: use small amounts, keep the app open until the swap says Completed, and only swap with people you can reach.

How you can help 🙏
1. Try it with a small amount and follow the test checklist: https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/docs/TESTING-MAINNET.md
2. Report bugs or ideas: https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues
3. Run a node if you can: LBRY's own seed nodes are offline and very few public nodes are left. In the app, Node → Start node with "Accept incoming connections" on helps new users join the network.
4. Developers and security people: reviews and an audit are very welcome — the code is MIT-licensed.
5. Translators: help improve the 14 translations.

What's next 🗺️
1️⃣ A decentralized mining pool inside the wallet (P2Pool style — no operator, no pool fee, rewards paid straight from the block)
2️⃣ More swaps: LBC ↔ BTC works now. Litecoin/Dogecoin and an offer board come next, then a Bisq/Haveno-style market
Roadmap: https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/docs/ROADMAP.md

Not affiliated with LBRY Inc. or Odysee — just a community project to keep LBC useful. Feedback welcome! 💚

---
