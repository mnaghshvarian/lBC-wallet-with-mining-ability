## LBC Wallet — wallet, miner and full node for LBRY Credits

> **⚠️ Experimental and NOT audited. Use at your own risk.** This software may contain bugs that
> lose money. The authors and contributors are not responsible for any loss. Keep your recovery
> phrase on paper and test with a small amount first. Please read the
> [disclaimer](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/DISCLAIMER.md)
> — the app asks you to accept it on first start.

**New here?** The [beginner's manual](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/docs/manual/README.md)
shows, with pictures, how to install, create a wallet, receive, send and mine.

### Which file do I need?

| Device | File |
| --- | --- |
| Windows 10/11 | `LBC-Wallet-Setup-x64.exe` (installer) or `LBC-Wallet-Portable-x64.exe` |
| Mac with Apple chip (M1–M4) | `LBC-Wallet-mac-arm64.dmg` |
| Mac with Intel chip | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu / Debian / Mint | `lbc-wallet_amd64.deb` (ARM64: `lbc-wallet_arm64.deb`) |
| Fedora / openSUSE / RHEL | `lbc-wallet.x86_64.rpm` (ARM64: `lbc-wallet.aarch64.rpm`) |
| Any Linux | `LBC-Wallet-linux-x86_64.AppImage` (ARM64: `LBC-Wallet-linux-arm64.AppImage`) |
| Android 7+ | `LBC-Wallet-android.apk` |

Check your download against the `SHA256SUMS-*.txt` files below.

### What's new in this version (1.3.0)

* **Reviewed and hardened.** Before this release the whole code was reviewed line by line by a
  second, independent AI model (not a human security audit, which is still needed). What it found
  and what was done is in `docs/REVIEW-2026-10.md`. Among the fixes: the other side's LBC payment
  in a swap is now checked against a chain of block headers *and* a second hub before coins move;
  a Bitcoin explorer that lists a false spend first can no longer hide the other side's claim;
  claims and refunds no longer depend on one explorer, and a wrong fee estimate cannot burn the
  amount; amounts typed with a decimal comma ("12,5") or Persian, Arabic or Hindi digits are read
  correctly; the auto-lock waits while a swap runs; a hidden second unlock can no longer start;
  the miner no longer follows a pool's redirect to another host.
* **Market: buy and sell LBC for Bitcoin with other people, without an exchange.** A new
  *Market* page shows offers from other LBC Wallet users, priced against the exchange price
  (MEXC) in sats, US dollars and Monero. Take an offer, or post your own with your price and the
  smallest part people can take.
  * A taken offer becomes an atomic swap between the two wallets, which pass the swap codes
    along by themselves: no codes to copy, nobody holds anyone's coins, no accounts, no fees.
  * Offers and encrypted trade messages travel through public Nostr relays (five by default;
    change them in *Settings → Network*). Each offer and trade uses a new key.
  * The Market shows its own warning, which you must accept first. Read it: the people on the
    board are strangers, and a trade can keep coins locked for up to 48 hours.
  * Paying with USDT or Monero: change them to Bitcoin first (for example in Trust Wallet or Cake
    Wallet). The manual has a step-by-step guide.
* **Bitcoin amounts you can read.** A new *Settings → General → Bitcoin unit* option: *Automatic*
  shows small amounts in sats and large ones in BTC (so "0.00000205 BTC" becomes "205 sats"
  whatever LBC's price does), or choose always BTC, always sats, or scientific notation.
* **Hindi.** The app and a quick-start guide are now available in Hindi: 15 languages in all.
* **Manual:** new chapters on the Market and on paying with other coins; *Do I need to download
  the blockchain?* (no; it is about 100 GB, not 2 TB) and *Which servers does the wallet use?*
* **Prices:** CoinGecko is no longer used (its LBC price was far from where LBC trades); MEXC's
  LBC/USDT market is the fallback for US dollar prices.
* **Questions about LBC's future** (fork, rename, privacy, RandomX): see the new document
  *docs/LBC-FUTURE.md*, including the SEC and CFTC interpretation of 17 March 2026 that names
  LBRY Credits (LBC) as a digital commodity.

### Good to know

* **Unsigned builds:** Windows shows "Windows protected your PC" (click *More info → Run
  anyway*); macOS asks you to allow the app in *System Settings → Privacy & Security → Open
  Anyway*. Details in the manual.
* **Mining income is tiny on a normal computer, and even smaller on a phone** (LBC is mined
  mostly by specialized hardware). Mine to support the network, not for profit.
* **Swaps and the Market are new and not audited.** Start with the smallest amount. Keep the
  app open, with the wallet unlocked, while you have offers up and until each swap shows
  *Completed*. Finish a swap on the device where you started it: its keys are not in your
  recovery phrase.
* **Ubuntu 24.04+:** prefer the `.deb` over the AppImage.
* **Android:** Android only installs an update signed with the same key as the installed app.
  If a note below says this APK uses a temporary signing key, a later version may need the old
  app uninstalled first (have your recovery phrase ready).

Report problems at https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues — never
include your recovery phrase, password or keys.

*MIT license. Not affiliated with LBRY Inc., Odysee, the LBRY Foundation, or any exchange or pool.*
