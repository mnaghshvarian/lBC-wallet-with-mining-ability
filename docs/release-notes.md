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

### What's new in this version (1.2.0)

* **Swap LBC ↔ Bitcoin with another person** — no exchange, no middleman. Atomic swaps with
  hash-time-locked contracts: either both of you get paid, or both get your coins back after the
  lock time.
  * The wallet checks the other side's contract before it locks anything or reveals the secret.
    LBC payments are verified with SPV proofs, and Bitcoin payments are cross-checked by
    blockstream.info and mempool.space.
  * You can use your own Bitcoin explorer in *Settings → Network*.
  * From 20,000 sats up to 0.05 BTC while swaps are new.
* **Mine on your Android phone.** The phone app is now a complete wallet on its own, and it
  can mine through a pool. It mines only while the app is on the screen and the phone is
  charging (you can allow battery mining down to 30 %). It pauses when the battery reaches
  40 °C, when Android reports overheating, and in battery saver.
* **How much LBC is left to mine.** A new *LBC supply* card on the Mining page shows how much
  LBC is left, the reward now, the next reward drop and the last reward (around 2035). It is
  computed from the chain's own reward rule.
* **Tested like a real user:** every change now installs the Windows and macOS apps, runs the
  full UI test on the installed app and uninstalls it. A weekly check opens the installed
  Windows app on the real LBC network.
* Tiny mining estimates read as normal numbers (0.0098 LBC/day, not 9.80e-3).
* The phone shows up at the pool as worker `phone` instead of `desktop`.

### Good to know

* **Unsigned builds:** Windows shows "Windows protected your PC" (click *More info → Run
  anyway*); macOS asks you to allow the app in *System Settings → Privacy & Security → Open
  Anyway*. Details in the manual.
* **Mining income is tiny on a normal computer, and even smaller on a phone** (LBC is mined
  mostly by specialized hardware). Mine to support the network, not for profit.
* **Swaps are new and not audited.** Start with the smallest amount. Keep the app open, with the
  wallet unlocked, until the swap shows *Completed*. Finish a swap on the device where you
  started it: its keys are not in your recovery phrase.
* **Ubuntu 24.04+:** prefer the `.deb` over the AppImage.
* **Android:** Android only installs an update signed with the same key as the installed app.
  If a note below says this APK uses a temporary signing key, a later version may need the old
  app uninstalled first (have your recovery phrase ready).

Report problems at https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues — never
include your recovery phrase, password or keys.

*MIT license. Not affiliated with LBRY Inc., Odysee, the LBRY Foundation, or any exchange or pool.*
