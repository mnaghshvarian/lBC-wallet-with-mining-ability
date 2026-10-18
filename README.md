# LBC Wallet

**A free, non-custodial wallet for LBRY Credits (LBC) — with a built-in miner and a built-in
full node, like the Monero GUI.** Keep, send and receive LBC, mine it with your computer, and run
your own LBRY node. For **Windows, Mac, Linux and Android**, in **14 languages**.

> [!CAUTION]
> **Experimental, unaudited software — use it at your own risk.** No independent security audit
> has been done yet. It may contain bugs that lose money. The authors and contributors are **not
> responsible for any loss**. Keep your recovery phrase on paper, start with a small amount, and
> read the [full disclaimer](DISCLAIMER.md) before use. You must accept it when the app first
> starts.

![The wallet](docs/manual/images/overview.png)

## ⬇️ Download

**New to all this? Read the [step-by-step beginner's manual](docs/manual/README.md)** — it
explains, with pictures, how to install, create a wallet, receive, send and mine. No GitHub
knowledge needed ([PDF version](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/raw/HEAD/docs/manual/LBC-Wallet-Manual.pdf)). Short guides: [فارسی](docs/manual/quickstart/fa.md) ·
[العربية](docs/manual/quickstart/ar.md) · [اردو](docs/manual/quickstart/ur.md) ·
[Français](docs/manual/quickstart/fr.md) · [Deutsch](docs/manual/quickstart/de.md) ·
[Español](docs/manual/quickstart/es.md) · [Português](docs/manual/quickstart/pt.md) ·
[Nederlands](docs/manual/quickstart/nl.md) · [Русский](docs/manual/quickstart/ru.md) ·
[简体中文](docs/manual/quickstart/zh-CN.md) · [日本語](docs/manual/quickstart/ja.md) ·
[한국어](docs/manual/quickstart/ko.md) · [ไทย](docs/manual/quickstart/th.md) ·
[English](docs/manual/quickstart/en.md).

| Your device | Download (always the newest version) |
| --- | --- |
| **Windows** 10 / 11 | [**Installer** (LBC-Wallet-Setup-x64.exe)](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-Setup-x64.exe) · [portable .exe](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-Portable-x64.exe) |
| **Mac** with Apple chip (M1–M4) | [LBC-Wallet-mac-arm64.dmg](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-mac-arm64.dmg) |
| **Mac** with Intel chip | [LBC-Wallet-mac-x64.dmg](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-mac-x64.dmg) |
| **Ubuntu, Debian, Mint** | [lbc-wallet_amd64.deb](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet_amd64.deb) |
| **Fedora, openSUSE, RHEL** | [lbc-wallet.x86_64.rpm](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet.x86_64.rpm) |
| **Any Linux** | [LBC-Wallet-linux-x86_64.AppImage](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-linux-x86_64.AppImage) |
| Linux on ARM64 (e.g. Raspberry Pi 4/5) | [.deb](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet_arm64.deb) · [.rpm](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet.aarch64.rpm) · [AppImage](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-linux-arm64.AppImage) |
| **Android** 7+ | [LBC-Wallet-android.apk](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-android.apk) ([how to install an APK](docs/manual/README.md#7-install-on-android)) |

All files and their SHA-256 checksums are on the
[Releases page](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases).
Builds are not code-signed yet, so Windows and macOS show a warning the first time — the
[manual](docs/manual/README.md) shows how to open the app safely.

## What it does

**Wallet** — your keys stay on your device, encrypted with your password (scrypt +
AES-256-GCM).

* Create a wallet with a 12/24-word recovery phrase, or restore one from **LBRY Desktop, Odysee**
  or any BIP39 wallet (the derivation is detected automatically); watch-only wallets from an
  `xpub`.
* Send and receive with QR codes, contacts, notes, a fee preview and a full review step;
  password on every send by default.
* **Tips and supports** received on LBRY are shown separately and can be unlocked in one click.
* Activity with filters, search and CSV export. Every confirmation is **SPV-verified** against
  a proof-of-work-valid block header — the wallet doesn't just trust the server.
* Auto-lock, several wallets, optional fiat prices, optional **Tor/SOCKS5**.

**Miner** (computers)

* Mine through a **pool** (LBRYPool preset, any LBRY Stratum pool) or **solo** with your own
  node. A WebAssembly SIMD implementation of LBRY's proof of work runs in a separate
  low-priority process.
* Pause on battery, mine only when the computer is idle, live hashrate, shares, pool balance and
  earnings estimate.

> **Be realistic:** LBC is mined mostly by specialized hardware, so a normal computer earns very
> little — often less than the electricity costs. See [docs/MINING.md](docs/MINING.md).

**Built-in full node** (computers) — like the Monero GUI's local node.

* Runs **lbcd**, LBRY's official node software, bundled unmodified (built from its verified
  release source).
* Choose **where the blockchain is stored** (about 150 GB; an external disk works), accept
  incoming connections to help the network, see sync progress, peers and disk use.
* When the node is ready, the wallet reads the chain from it instead of public servers, and solo
  mining uses it.

**Android app** — the same wallet and screens, with screenshots blocked on secret screens and no
cloud backups of wallet files. It doesn't mine (phones overheat); it shows your pool balance.

**14 languages** — English, فارسی, العربية, اردو, Français, Deutsch, Español, Português,
Nederlands, Русский, 简体中文, 日本語, 한국어, ไทย (right-to-left layouts included).

| Mining | Built-in node | Persian (right to left) | Android |
| --- | --- | --- | --- |
| ![Mining](docs/manual/images/mining.png) | ![Node](docs/manual/images/node-running.png) | ![Persian](docs/manual/images/overview-fa.png) | ![Android](docs/manual/images/android-overview.png) |

## Documentation

* [Beginner's manual](docs/manual/README.md) — install, create, receive, send, mine, node, FAQ
* [Disclaimer](DISCLAIMER.md) — please read
* [Mining guide](docs/MINING.md) — pools, solo mining, expectations, troubleshooting
* [Security model](docs/SECURITY.md) — what protects your funds and privacy; how to report a vulnerability
* [Architecture](docs/ARCHITECTURE.md) — how the shared core, services, apps and miner fit together
* [Building from source](docs/BUILDING.md) — development, tests, packaging, Android, releases
* [Roadmap](docs/ROADMAP.md) — next: a decentralized (P2Pool-style) mining pool in the wallet,
  then a decentralized exchange for LBC

## How it is tested

Every push runs, on GitHub's servers:

* unit tests with LBRY's own test vectors (seeds, keys, addresses, signatures, proof of work),
  and translation checks for all 14 languages;
* end-to-end tests against a real `lbcd` on a private test network: payments, tips, restore,
  SPV proofs over the hub protocol, blocks mined solo and through a Stratum pool;
* the real desktop app driven by a robot (development build and the packaged, locked-down
  build): disclaimer, restore, create with backup check, send, confirm, pool mining, **starting
  the built-in node, syncing it and solo-mining through it**, settings, Persian and phone layouts;
* the Android app in an Android emulator: restore, receive, send, confirm, screenshot blocking;
* a network audit (no telemetry or unexpected connections);
* a **mainnet check** (also weekly): public LBRY servers, proof-of-work headers, real
  transactions verified against block headers, a login to LBRYPool, and the built-in node
  finding peers and syncing mainnet. Nothing is mined or spent in CI.

## License

[MIT](LICENSE). LBC Wallet is an independent community project and is **not affiliated** with
LBRY Inc., Odysee, the LBRY Foundation, or any exchange or pool. Provided "as is", without
warranty of any kind — see the [disclaimer](DISCLAIMER.md).
