# LBC Wallet — quick start

LBC Wallet is a free app to keep, send, receive and mine **LBRY Credits (LBC)** on Windows, Mac,
Linux and Android. The complete manual with pictures (in English) is here:
[docs/manual](../README.md).

> **Warning:** LBC Wallet is experimental and **not audited**. It may contain mistakes that lose
> money. **You use it at your own risk**; the authors are not responsible for any loss. Start
> with a small amount. Full text: [DISCLAIMER](../../../DISCLAIMER.md).

## 1. Download

Download only from the official page:
**<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest>**
(scroll down to **Assets**).

| Device | File |
| --- | --- |
| Windows | `LBC-Wallet-Setup-x64.exe` |
| Mac with Apple chip (M1, M2…) | `LBC-Wallet-mac-arm64.dmg` |
| Mac with Intel chip | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu, Debian, Mint | `lbc-wallet_amd64.deb` |
| Fedora, openSUSE | `lbc-wallet.x86_64.rpm` |
| Other Linux | `LBC-Wallet-linux-x86_64.AppImage` |
| Android 7 or newer | `LBC-Wallet-android.apk` |

## 2. Install

* **Windows:** double-click the file. If you see "Windows protected your PC", click
  **More info → Run anyway**. Accept the license and click **Install**.
* **Mac:** open the `.dmg`, click **Agree**, drag **LBC Wallet** into **Applications**. The first
  time, macOS blocks it: open **System Settings → Privacy & Security**, scroll down and click
  **Open Anyway**.
* **Linux:** double-click the `.deb` or `.rpm` to install it with your software center. Or make
  the AppImage executable (right-click → Properties → Permissions → *Allow executing*) and
  double-click it.
* **Android:** open the APK link on your phone, tap **Download anyway**, then **Open**. Allow
  **"Install unknown apps"** for your browser when asked, then tap **Install**. If Play Protect
  warns you, tap **More details → Install anyway**.

## 3. First start

Read the disclaimer, tick the three boxes and click **I agree — continue**. Choose your language
with the globe button.

## 4. Create or restore a wallet

* **New:** click **Create a new wallet**, choose a name and a password, then **write the 12
  recovery words on paper**, in order. The app checks three of them.
* **Already have a phrase** (from this app, LBRY Desktop, Odysee or another BIP39 wallet): click
  **Restore from a recovery phrase** and type your words.

**Your recovery words are your money.** Anyone who has them can take your LBC. Never share them,
never type them on a website, never store them as a photo. Nobody from the project will ever ask
for them.

## 5. Receive

Click **Receive**. Copy your address (it starts with `b`) or show the QR code to the sender.

## 6. Send

Click **Send**, paste the address, type the amount, click **Review**, check everything, enter
your password and click **Send**. Payments cannot be reversed.

## 7. Mine (computers only)

Click **Mining** → **Start mining**. The default is the LBRYPool pool, which pays automatically
to your wallet once you have earned 10 LBC there. A normal computer earns very little and uses
electricity; use **Pause on battery** and **Only when idle** if you like.

## 8. Run your own node (optional, computers only)

Click **Node**, choose a folder with about **150 GB** free space (**Change…**), and click
**Start node**. The first download takes one to three days. When it reaches 100 %, the wallet uses
your own node, and you can mine **Solo**.

## Help

Problems: see "Problems and solutions" in the [manual](../README.md#19-problems-and-solutions),
or report them at <https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues>
(never share your recovery words or password).
