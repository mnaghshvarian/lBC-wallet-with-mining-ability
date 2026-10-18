# LBC Wallet — the complete beginner's manual

This manual explains everything step by step, in plain words. You do **not** need to know
anything about GitHub, programming or the command line. If a word is new to you, look it up in
the [glossary](#glossary) at the end.

**Other languages:** short quick-start guides are available in
[فارسی](quickstart/fa.md) · [العربية](quickstart/ar.md) · [اردو](quickstart/ur.md) ·
[Français](quickstart/fr.md) · [Deutsch](quickstart/de.md) · [Español](quickstart/es.md) ·
[Português](quickstart/pt.md) · [Nederlands](quickstart/nl.md) · [Русский](quickstart/ru.md) ·
[简体中文](quickstart/zh-CN.md) · [日本語](quickstart/ja.md) · [한국어](quickstart/ko.md) ·
[ไทย](quickstart/th.md) · [English](quickstart/en.md). The app itself is available in all of
these languages.

> [!WARNING]
> **Please read this first.** LBC Wallet is free, experimental software made by volunteers.
> **It has not been audited** by independent security experts, and it may contain mistakes
> that lose money. **You use it at your own risk** — the authors are not responsible for any
> loss. Start with a small amount you can afford to lose. Read the full
> [disclaimer](../../DISCLAIMER.md).

---

## Contents

1. [What is LBC Wallet?](#1-what-is-lbc-wallet)
2. [Five safety rules](#2-five-safety-rules)
3. [Download the right file](#3-download-the-right-file)
4. [Install on Windows](#4-install-on-windows)
5. [Install on a Mac](#5-install-on-a-mac)
6. [Install on Linux](#6-install-on-linux)
7. [Install on Android](#7-install-on-android)
8. [First start: the disclaimer and choosing your language](#8-first-start)
9. [Create a new wallet](#9-create-a-new-wallet)
10. [Restore a wallet you already have](#10-restore-a-wallet-you-already-have)
11. [Receive LBC](#11-receive-lbc)
12. [Send LBC](#12-send-lbc)
13. [Your activity (transaction history)](#13-your-activity)
14. [Mine LBC](#14-mine-lbc)
15. [Run your own node](#15-run-your-own-node)
16. [Settings](#16-settings)
17. [Backups, new computers and new phones](#17-backups-new-computers-and-new-phones)
18. [Updating the app](#18-updating-the-app)
19. [Problems and solutions](#19-problems-and-solutions)
20. [Check that your download is genuine (optional)](#20-check-that-your-download-is-genuine-optional)
21. [Glossary](#glossary)

---

## 1. What is LBC Wallet?

**LBC** (LBRY Credits) is the cryptocurrency of the LBRY network, the technology behind
[Odysee](https://odysee.com). LBC Wallet is an app where you can:

* **keep** your LBC safely on your own computer or phone;
* **receive** LBC from other people, exchanges and mining pools;
* **send** LBC to anyone;
* **mine** LBC with your computer, like in the Monero GUI wallet;
* **run your own LBRY node** (a full copy of the LBC blockchain), so you don't depend on anyone
  else's servers;
* see and **unlock tips and supports** you received on LBRY / Odysee.

It works on **Windows, Mac, Linux** and **Android** phones, in **14 languages**.

**"Non-custodial"** means *you* hold your money, not a company. That is good: nobody can freeze
or take your coins. It also means **nobody can help you if you lose your recovery phrase**
(see the safety rules below).

---

## 2. Five safety rules

1. **Your recovery phrase is your money.** When you create a wallet, the app shows 12 (or 24)
   words. Anyone who has these words can take your LBC. **Write them on paper**, in order, and
   keep the paper somewhere safe. Never photograph them, never type them into a website or a
   chat, never store them in email or cloud notes.
2. **Nobody legitimate will ever ask for your recovery phrase** — not the developers, not
   "support", not an exchange. Anyone who asks is trying to steal from you.
3. **Download the app only from the official page:**
   <https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases>.
   Copies from other places may be changed to steal coins.
4. **Check the address before you send.** Payments cannot be reversed. Compare at least the
   first and last 6 characters.
5. **Start small.** This software is new and unaudited. Try it with a small amount first.

---

## 3. Download the right file

All downloads are on the **[Releases page](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest)**.
Open it, scroll down to the section called **Assets**, and click the file for your device.
Or use these direct links (they always give you the newest version):

| Your device | File to download |
| --- | --- |
| **Windows** 10 or 11 (almost every Windows PC) | [LBC-Wallet-Setup-x64.exe](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-Setup-x64.exe) (installer) |
| Windows, without installing (USB stick) | [LBC-Wallet-Portable-x64.exe](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-Portable-x64.exe) |
| **Mac with Apple chip** (M1, M2, M3, M4…) | [LBC-Wallet-mac-arm64.dmg](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-mac-arm64.dmg) |
| **Mac with Intel chip** (older Macs) | [LBC-Wallet-mac-x64.dmg](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-mac-x64.dmg) |
| **Ubuntu, Debian, Linux Mint, Pop!_OS, Zorin, elementary** | [lbc-wallet_amd64.deb](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet_amd64.deb) |
| **Fedora, openSUSE, RHEL, Rocky, AlmaLinux** | [lbc-wallet.x86_64.rpm](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet.x86_64.rpm) |
| **Any other Linux** (Arch, Manjaro, Gentoo, Void…) | [LBC-Wallet-linux-x86_64.AppImage](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-linux-x86_64.AppImage) |
| Linux on ARM (Raspberry Pi 4/5 with 64-bit OS) | [lbc-wallet_arm64.deb](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet_arm64.deb), [lbc-wallet.aarch64.rpm](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/lbc-wallet.aarch64.rpm) or [LBC-Wallet-linux-arm64.AppImage](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-linux-arm64.AppImage) |
| **Android** phone or tablet (Android 7 or newer) | [LBC-Wallet-android.apk](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-android.apk) |

**Not sure which Mac you have?** Click the Apple menu  (top-left corner) → **About This Mac**.
If it says **Chip: Apple M…**, take the *Apple chip* file. If it says **Processor: Intel**, take
the *Intel* file.

**Not sure which Linux you have?** If your system has an "Ubuntu Software" or "Software Manager"
app with an orange or green icon, it is probably Ubuntu/Mint: take the `.deb`. If it is Fedora,
take the `.rpm`. When in doubt, the `.AppImage` works almost everywhere.

> [!NOTE]
> The download is free. If any website asks you to pay for LBC Wallet, it is a scam.

---

## 4. Install on Windows

1. **Download** `LBC-Wallet-Setup-x64.exe` (see the table above). Your browser saves it in the
   **Downloads** folder.
2. **Double-click** the file to start it.
3. Windows may show a blue window: **"Windows protected your PC"**. This appears because the app
   is new and not signed with a paid Microsoft certificate — not because something is wrong.
   If you downloaded it from the official page, click **More info**, then **Run anyway**.
4. The installer shows the **disclaimer and license**. Read it, then click **I Agree**.
5. Choose **Only for me** (recommended) and click **Next**.
6. Keep the suggested folder and click **Install**. Wait a few seconds.
7. Click **Finish**. LBC Wallet starts. Next time, open it from the **Start menu** or the
   **LBC Wallet** icon on your desktop.

**Portable version:** `LBC-Wallet-Portable-x64.exe` runs without installing — double-click it.
Your wallets are still stored in your user folder (see [section 17](#17-backups-new-computers-and-new-phones)).

**Antivirus warning?** Some antivirus programs warn about *any* program that can mine
cryptocurrency, because criminals hide miners in other software. LBC Wallet mines only when *you*
press **Start mining**. If you are worried, compare the file's fingerprint with the official one
([section 20](#20-check-that-your-download-is-genuine-optional)).

**To uninstall:** Windows Settings → Apps → LBC Wallet → Uninstall. Your wallet files are kept;
delete them yourself only if you have your recovery phrase.

---

## 5. Install on a Mac

1. **Download** the right `.dmg` file (Apple chip or Intel — see [section 3](#3-download-the-right-file)).
2. **Double-click** the downloaded `.dmg` file. A window with the **disclaimer and license**
   appears: read it and click **Agree**.
3. A window opens showing the **LBC Wallet** icon and the **Applications** folder. **Drag the
   LBC Wallet icon onto the Applications folder.**
4. Open your **Applications** folder (Finder → Applications) and **double-click LBC Wallet**.
5. The first time, macOS says the app **"Not Opened"** or **"cannot be opened because Apple
   cannot check it for malicious software"**. This is because the app is not notarized by Apple
   (that needs a paid Apple account). Click **Done** (not "Move to Trash"), then:
   1. Open **System Settings** (Apple menu  → System Settings).
   2. Click **Privacy & Security** on the left.
   3. Scroll down. You will see *"LBC Wallet" was blocked to protect your Mac.* Click
      **Open Anyway**.
   4. Enter your Mac password (or use Touch ID) and click **Open**.
6. From now on, LBC Wallet opens normally. You can eject the disk image (the drive icon called
   "LBC Wallet") in Finder.

**To uninstall:** drag **LBC Wallet** from Applications to the Trash.

---

## 6. Install on Linux

### Ubuntu, Debian, Linux Mint and similar (`.deb`)

**The easy way:** double-click `lbc-wallet_amd64.deb` in your Downloads folder. Your software
center opens. Click **Install** and enter your password.

**With the terminal** (open it with **Ctrl + Alt + T**):

```bash
cd ~/Downloads
sudo apt install ./lbc-wallet_amd64.deb
```

Then open **LBC Wallet** from your applications menu.

### Fedora, openSUSE, RHEL and similar (`.rpm`)

Double-click the `.rpm` file to open it in **Software**, then click **Install**. Or in the terminal:

```bash
cd ~/Downloads
sudo dnf install ./lbc-wallet.x86_64.rpm      # Fedora, RHEL, Rocky, AlmaLinux
sudo zypper install ./lbc-wallet.x86_64.rpm   # openSUSE
```

### Any Linux: the AppImage

An AppImage is one file that runs without installing.

1. Right-click `LBC-Wallet-linux-x86_64.AppImage` → **Properties** → **Permissions** → tick
   **Allow executing file as program** (or in the terminal:
   `chmod +x ~/Downloads/LBC-Wallet-linux-x86_64.AppImage`).
2. Double-click it.

If it does not start, your system may need the **FUSE** library:

```bash
sudo apt install libfuse2t64      # Ubuntu 24.04 and newer (libfuse2 on older versions)
sudo dnf install fuse fuse-libs   # Fedora
sudo pacman -S fuse2              # Arch, Manjaro
```

> [!TIP]
> On **Ubuntu 24.04 and newer**, please use the `.deb` instead of the AppImage. Ubuntu limits a
> security feature (the "sandbox") that the AppImage needs, while the `.deb` sets it up for you.

### Raspberry Pi and other ARM computers

Use the `arm64` files (`lbc-wallet_arm64.deb`, `lbc-wallet.aarch64.rpm` or
`LBC-Wallet-linux-arm64.AppImage`). You need a **64-bit** operating system. Mining on a Raspberry
Pi earns almost nothing, but the wallet and the node work.

**To uninstall:** `sudo apt remove lbc-wallet` (deb), `sudo dnf remove lbc-wallet` (rpm), or
delete the AppImage file.

---

## 7. Install on Android

The Android app is not in the Google Play Store (Google does not allow apps like this one to be
published easily, and we want to keep it free and independent). You install the **APK file**
directly — this is called *sideloading* and is safe when the file comes from the official page.

1. On your phone, open this page in **Chrome** (or your usual browser) and tap the link:
   **[LBC-Wallet-android.apk](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest/download/LBC-Wallet-android.apk)**.
2. Chrome may warn *"This type of file can harm your device"*. Tap **Download anyway**.
3. When the download finishes, tap **Open** (or open the **Downloads** app / **Files** app and
   tap `LBC-Wallet-android.apk`).
4. Android says *"For your security, your phone is not allowed to install unknown apps from
   this source"*. Tap **Settings**, switch on **Allow from this source**, then go **back**.
5. Tap **Install**.
6. **Google Play Protect** may say the app is from an *unknown developer* or *not scanned*. Tap
   **More details** → **Install anyway**. (If it offers to *scan the app*, you can let it.)
7. Tap **Open**. The app icon (a blue-green hexagon with an "L") is now in your app list.

After installing, you can switch **Allow from this source** off again for your browser
(Settings → Apps → Chrome → Install unknown apps).

**What the phone app can do:** everything except mining and running a node — phones would
overheat and drain their battery. The **Mining** page on the phone shows your **pool balance**,
so you can follow what your computer earns.

> [!IMPORTANT]
> **Updating the Android app:** install the newer APK the same way; Android keeps your wallets.
> If Android says *"App not installed as package conflicts with an existing package"*, the new
> file was signed with a different key (this can happen with test versions). Then you must
> uninstall the old app first — **which deletes the wallets on the phone**, so make sure you have
> your recovery phrase written down before doing that.

---

## 8. First start

### The disclaimer

The very first time you open LBC Wallet, it shows **"Read this before you start"**. It explains
the risks in plain words. Read it, tick the **three boxes** to confirm you understand, and click
**I agree — continue**. If you do not agree, click **Quit**.

![The disclaimer on first start](images/disclaimer.png)

### Choosing your language

The app starts in your computer's language if it is one of the 14 supported languages.
To change it, use the **globe** menu at the top right of the first screens, or later
**Settings → General → Language**.

![Switching between English and Persian](images/languages.gif)

---

## 9. Create a new wallet

Use this if you are **new to LBC** or want a separate wallet.

![Creating a wallet: phrase and backup check](images/create.gif)

1. On the welcome screen, click **Create a new wallet**.
2. **Name** your wallet (for example "My savings") and choose a **password**.
   * The password protects the wallet *on this device* — it is needed to open the wallet and to
     send money.
   * Use at least 8 characters; a long sentence that you can remember is best.
   * If you forget the password, you can still restore the wallet with your recovery phrase.
3. Click **Continue**. Click **Reveal recovery phrase**. Take a **pen and paper** and write the
   words **in order**, with their numbers. Check every word twice.

   ![Your recovery phrase](images/create-phrase.png)

4. Tick **"I have written down my recovery phrase…"** and click **Continue**.
5. The app asks for **three of your words** (for example word #3, #7 and #11) to make sure your
   paper is correct. Type them and click **Create wallet**.

   ![Checking the backup](images/create-verify.png)

6. Done! You see the **Overview** with a balance of 0 LBC.

**Advanced options** (you can ignore them): a 24-word phrase instead of 12, and
"LBRY Desktop compatible" addresses if you also want to use this phrase in the old LBRY Desktop
app.

---

## 10. Restore a wallet you already have

Use this if you already have a recovery phrase — from this app, from **LBRY Desktop**, from
**Odysee**, or from any wallet that uses standard 12/24-word (BIP39) phrases.

![Restoring a wallet](images/restore.gif)

1. On the welcome screen, click **Restore from a recovery phrase**.
2. Type your words, separated by spaces (or paste them). The app checks the words as you type:
   it tells you if a word is misspelled.

   ![Typing the recovery phrase](images/restore-phrase.png)

3. Click **Continue**. The app looks on the LBRY network for your money with each method LBRY
   wallets have used, and picks the right one automatically (**"Found your wallet"**).

   ![The wallet was found](images/restore-found.png)

4. Click **Continue**, give the wallet a name and a password, and click **Restore wallet**.
5. Your balance and history appear after a few seconds to a minute.

**Importing a key instead:** if you only have an **xprv** key from LBRY Desktop's `wallet.json`,
choose **Import an extended key** on the welcome screen. An **xpub** key creates a *watch-only*
wallet: it shows the balance (handy for a mining computer) but cannot send.

---

## 11. Receive LBC

1. Click **Receive** (on a phone: the **Receive** button at the bottom).
2. You see **your receiving address** (a long code starting with `b`) and a **QR code**.
3. Give the address to the person, exchange or pool that sends you LBC:
   * click **Copy address** and paste it into their website or message; or
   * let them scan the QR code with their phone.
4. When the payment arrives, a message pops up and it appears on the **Overview** and in
   **Activity**. It is *pending* at first and *confirmed* after the next block (about 2.5 minutes).

![The Receive page](images/receive.png)

**New address:** for more privacy you can click **New address** to use a fresh address for
each payment. All your addresses keep working forever.

> The screenshots in this manual come from the app's automatic tests, which run on a private
> test network. That is why the addresses in the pictures start with `m` or `n`, and the
> amounts are test money. **Real LBC addresses start with `b`.**

---

## 12. Send LBC

![Sending LBC, step by step](images/send.gif)

1. Click **Send**.
2. **Recipient address:** paste the address you want to pay (the clipboard button pastes it for
   you), or pick a saved contact with the address-book button. A green check mark appears when
   the address is valid.
3. **Amount:** type how many LBC to send. **Max** sends everything (minus the fee).
4. **Note** (optional): a private note for yourself, for example "Rent".
5. Check the **network fee** shown under the amount. The normal fee is tiny (a fraction of a cent).
6. Click **Review**. Check the address and the amount **very carefully**.

   ![Reviewing a payment before sending](images/send-review.png)

7. Enter your **wallet password** and click **Send**.
8. **"Transaction sent"** — done. It confirms within a few minutes. Click **View in explorer**
   if you want to see it on the public LBRY block explorer.

> [!CAUTION]
> Payments are **final**. If you send to a wrong address, nobody can get the money back.

**Contacts:** on the **Contacts** page you can save addresses you pay often.

---

## 13. Your activity

**Activity** lists every payment. Use the filters (**Received**, **Sent**, **Mining**, **Tips &
claims**) and the search box. Click a payment to see its details: date, status, fee, block and
transaction ID.

![Activity](images/activity.png)

* **Pending** — waiting for its first confirmation.
* **Matures in N blocks** — a mining reward. Rewards can be spent after 100 confirmations
  (about 4 hours).
* **Verified** — the wallet checked mathematically that the payment is really in the blockchain
  (it does not just trust the server).

**Export CSV** saves your history as a spreadsheet file (for your records or taxes).

---

## 14. Mine LBC

Mining means using your computer's processor to help secure the LBC network. In return you can
earn a little LBC.

> [!IMPORTANT]
> **Be realistic.** LBC is mined mostly by specialised machines, so a normal computer earns a
> **very small** amount — often less than the electricity costs. Mining makes your computer hot
> and loud. Mine for fun and to support the network, not to get rich. Never mine on a computer
> that is not yours (work, school, cloud servers).

### Mining with a pool (recommended)

A **pool** combines the power of many miners and pays everyone small amounts regularly.

![The miner at work](images/mining.gif)

1. Open a wallet, then click **Mining**.
2. The **Mining mode** is **Pool (recommended)** and the pool is **LBRYPool** (lbrypool.net).
   You don't need an account: the pool pays to your wallet's address automatically.
3. Choose how many **CPU threads** to use (leave one or two free so your computer stays fast).
4. Click **Start mining**. After a few seconds you see your **hashrate** (speed) and
   **accepted shares** (your work counted by the pool).
5. The pool pays you automatically once your balance there passes its minimum (10 LBC at
   LBRYPool). The **Pool balance** box shows what the pool owes you.
6. Click **Stop mining** whenever you want.

**Useful options:**

* **Low priority** — mining gives way to anything else you do (on by default).
* **Pause on battery** — stops mining when a laptop is unplugged (on by default).
* **Only when idle** — mines only when you haven't touched the keyboard or mouse for a few
  minutes, and stops the moment you come back.

![Only when idle](images/mining-idle.png)

* **Payout address** — by default your wallet's address. You can enter another one, for
  example your phone wallet's address.

### Solo mining (with your own node)

**Solo** means you mine alone. If you find a block, you get the **whole block reward** — but with
a normal computer that may take years. Solo mining needs a full node:

1. Start the built-in node ([section 15](#15-run-your-own-node)) and wait until it is ready
   (100 %).
2. On the **Mining** page choose **Solo (full node)**. You see *"Using the built-in node — ready."*
3. Click **Start mining**.

![Solo mining through the built-in node](images/solo-mining.png)

### Following your mining on your phone

On the Android app, open **More → Mining**. Enter the same **payout address** your computer
mines to, and you see the **pool balance**.

---

## 15. Run your own node

A **node** is a program that keeps a full copy of the LBC blockchain, checks every block itself
and shares the blocks with other nodes. Running one is like Monero GUI's *local node*:

* your wallet no longer depends on public servers (more privacy and independence);
* you help keep the LBRY network healthy;
* you can **solo mine**.

LBC Wallet includes **lbcd**, LBRY's official node software, unchanged.

**What you need:**

* about **150 GB** of free disk space (an external disk works);
* **8 GB** of memory (RAM) is recommended;
* time: the first download takes **one to three days**, depending on your internet and disk.
  You can keep using the wallet meanwhile — it uses public servers until the node is ready.

![The Node page](images/node.gif)

**Start it:**

1. Click **Node** in the menu.
2. **Choose where to store the blockchain:** under *Blockchain storage folder*, click
   **Change…** and pick a folder on a drive with enough space. (You can keep the default if
   your main drive is big enough.)
3. *Accept incoming connections* (optional): lets other nodes download from you, which helps the
   network. Leave it off if you are on a limited or mobile data plan.
4. Click **Start node**. The progress bar shows how much of the blockchain has been downloaded
   and checked, the number of **peers** (other nodes you are connected to) and the time left.
5. When it reaches **100 %**, the page says **"Your node is ready"** and the wallet
   automatically reads the blockchain from your own node.

![The node is downloading the blockchain](images/node-running.png)

**Good to know:**

* The node runs while LBC Wallet is open. If you close the app, it pauses and continues where
  it stopped next time. If it was running when you closed the app, it starts again automatically.
* **Stop node** stops it (and it won't start automatically anymore).
* To **move** the blockchain to another disk: stop the node, move the folder with your file
  manager, then choose the new location with **Change…**.
* The node can also connect to specific nodes you trust: open *Show advanced options* on the
  Node page and enter their addresses (`host:port`).
* Advanced: you can also connect the wallet to an lbcd node you run yourself elsewhere
  (**Settings → Network → My own node**).

---

## 16. Settings

![Settings](images/settings-general.png)

* **General:** language, theme (light/dark), fiat prices (USD, EUR…), hide balances (useful when
  sharing your screen), block explorer link.
* **Network:** how the wallet reads the blockchain — **Public servers** (the default, fast and
  light), **Built-in node**, or **My own node**. You can add your own LBRY servers and route
  everything through **Tor** (SOCKS5 proxy) for more privacy.
* **Security:**
  * **Auto-lock** — the wallet locks itself after some minutes without use (15 by default) and
    when the computer sleeps.
  * **Ask for the password on every send** — strongly recommended (on by default).
  * **Change password**, **Show recovery phrase** (make sure nobody is watching!) and
    **Extended public key** (for watch-only wallets).
* **Wallet:** rename, default fee, **Rescan** (if a balance looks wrong), delete the wallet from
  this device.
* **About:** version, a **Not audited** reminder, the full disclaimer, links to the source code,
  updates and this manual.

---

## 17. Backups, new computers and new phones

**Your recovery phrase on paper is your backup.** With it you can always restore your wallet on
any device, even if your computer breaks or is stolen. Keep two copies in different safe places.

**Moving to a new computer or phone:** install LBC Wallet there, choose **Restore from a
recovery phrase** and type your words. Your money is on the blockchain, not in the device, so it
appears again.

**Where are my wallet files?** (encrypted with your password; you normally don't need them)

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\LBC Wallet` |
| Mac | `~/Library/Application Support/LBC Wallet` |
| Linux | `~/.config/LBC Wallet` |
| Android | inside the app (removed when the app is uninstalled) |

The exact folder is shown in **Settings → About → Data folder**.

---

## 18. Updating the app

When a new version is published, download it from the same
[Releases page](https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest)
and install it over the old one, exactly like the first time. Your wallets and settings are kept.
**Settings → About → Check for updates** opens the page for you.

---

## 19. Problems and solutions

**"Disconnected" / "Connecting…" at the bottom left.** Check your internet connection. The
wallet tries several LBRY servers automatically. In **Settings → Network**, click **Test** next
to the servers to see which ones answer.

**My balance looks wrong.** Wait a minute for the wallet to sync. If it is still wrong:
**Settings → Wallet → Rescan**.

**I forgot my password.** Use **Restore from a recovery phrase** (on the unlock screen:
*"Forgot password? Restore from phrase"*) and choose a new password.

**I lost my recovery phrase but can still open the wallet.** Immediately go to
**Settings → Security → Show recovery phrase** and write it down.

**I lost both the phrase and the password.** Sadly, nobody can recover the wallet. This is how
non-custodial wallets work.

**Mining shows 0 H/s or an error.** Make sure a wallet is open. Check the **Log** box on the
Mining page for the reason (for example no internet, or the pool is down). Try again later or
choose another pool.

**"Paused (on battery)".** Plug in your laptop, or switch off *Pause on battery*.

**The node finds no peers.** Check that your firewall allows LBC Wallet to connect to the
internet. On restrictive networks (some offices, some countries) the LBRY network may be blocked.

**The node says there is not enough disk space.** Choose a folder on a bigger drive with
**Change…** on the Node page.

**Windows/Mac says the app is from an unknown developer.** See the steps in
[section 4](#4-install-on-windows) and [section 5](#5-install-on-a-mac).

**Something else?** Report it (you need a free GitHub account) at
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues>. Describe what you did
and what happened. **Never include your recovery phrase, password or private keys.**

---

## 20. Check that your download is genuine (optional)

Every release lists a **SHA-256 fingerprint** for each file (in the files called
`SHA256SUMS-…txt` on the Releases page). If the fingerprint of your download matches, the file
is exactly the official one.

* **Windows** (PowerShell): `Get-FileHash $HOME\Downloads\LBC-Wallet-Setup-x64.exe`
* **Mac** (Terminal): `shasum -a 256 ~/Downloads/LBC-Wallet-mac-arm64.dmg`
* **Linux**: `sha256sum ~/Downloads/lbc-wallet_amd64.deb`

Compare the long code it prints with the one in the `SHA256SUMS` file.

Everything is built automatically by GitHub from the public source code, so anyone can check
how the files were made.

---

## Glossary

* **Address** — like an account number for receiving LBC. Real LBC addresses start with `b`.
* **Block** — a batch of transactions added to the blockchain about every 2.5 minutes.
* **Blockchain** — the public record of all LBC transactions, kept by thousands of computers.
* **Confirmation** — each new block after the one containing your payment. More confirmations
  mean more certainty.
* **Fee** — a tiny amount paid to miners to include your payment in a block.
* **Hashrate** — how fast your computer mines (hashes per second, H/s).
* **Hub / server** — a public LBRY server that helps light wallets read the blockchain. It never
  sees your keys.
* **LBC / dewies** — LBRY Credits; 1 LBC = 100,000,000 dewies.
* **Mining** — using computing power to create new blocks; miners earn new LBC and fees.
* **Node (full node)** — a program that keeps and checks the whole blockchain.
* **Non-custodial** — you hold your own keys; no company can freeze or move your coins.
* **Pool** — a group of miners who share their rewards.
* **Recovery phrase (seed)** — the 12 or 24 words that can restore your wallet. Keep them secret.
* **Share** — a piece of mining work counted by the pool.
* **Solo mining** — mining alone; rare but full rewards.
* **Tips and supports** — LBC sent to creators on LBRY/Odysee, or put behind content to boost it.
* **Watch-only wallet** — a wallet that shows a balance but cannot send (no private keys).
* **xprv / xpub** — an extended private / public key: a technical form of a wallet's keys.

---

*LBC Wallet is open-source software under the MIT license, provided "as is", without warranty
of any kind. It is not affiliated with LBRY Inc., Odysee, the LBRY Foundation, or any exchange or
pool. See the [disclaimer](../../DISCLAIMER.md).*
