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

### What's new in this version

* **Built-in full node** — runs LBRY's official `lbcd` (bundled, unmodified, built from its
  verified release source). Choose where the blockchain is stored; once synced, the wallet uses
  your own node and solo mining runs through it.
* **Android app** — the same wallet and screens on your phone; screenshots blocked on secret
  screens; pool-balance monitor instead of mining.
* **14 languages** — English, Persian, Arabic, Urdu, French, German, Spanish, Portuguese, Dutch,
  Russian, Chinese, Japanese, Korean, Thai (right-to-left layouts included).
* **Disclaimer** to accept on first start, in every language; license page in the installers.
* Linux **.rpm** packages and **ARM64** builds; download names without version numbers.
* Fix: solo mining on fast test networks could overload the miner.

### Good to know

* **Unsigned builds:** Windows shows "Windows protected your PC" (click *More info → Run
  anyway*); macOS asks you to allow the app in *System Settings → Privacy & Security → Open
  Anyway*. Details in the manual.
* **Mining income is tiny on a normal computer** (LBC is mined mostly by specialized hardware).
  Mine to support the network, not for profit.
* **Ubuntu 24.04+:** prefer the `.deb` over the AppImage.
* **Android:** if the APK name ends in `-test-key`, it was signed with a temporary key; a later
  version signed with the permanent key will need the old app uninstalled first (have your
  recovery phrase ready).

Report problems at https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues — never
include your recovery phrase, password or keys.

*MIT license. Not affiliated with LBRY Inc., Odysee, the LBRY Foundation, or any exchange or pool.*
