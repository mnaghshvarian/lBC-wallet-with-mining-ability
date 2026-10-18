[English](en.md) · [Alle Sprachen](../README.md)

# LBC Wallet – Schnellstart

LBC Wallet ist eine kostenlose App für Windows, Mac, Linux und Android, mit der Sie
**LBRY Credits (LBC)** aufbewahren, senden, empfangen und minen können. Das vollständige Handbuch
mit Bildern (auf Englisch) finden Sie hier: [docs/manual](../README.md).

> **Warnung:** LBC Wallet ist experimentell und **nicht auditiert**. Die App kann Fehler enthalten,
> durch die Sie Geld verlieren. **Sie nutzen die App auf eigenes Risiko**; die Autoren sind für
> keinerlei Verluste verantwortlich. Beginnen Sie mit einem kleinen Betrag. Vollständiger Text
> (auf Englisch): [DISCLAIMER](../../../DISCLAIMER.md).

## 1. Herunterladen

Laden Sie die App nur von der offiziellen Seite herunter:
**<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest>**
(scrollen Sie nach unten zum Abschnitt **Assets**).

| Gerät | Datei |
| --- | --- |
| Windows | `LBC-Wallet-Setup-x64.exe` |
| Mac mit Apple-Chip (M1, M2 …) | `LBC-Wallet-mac-arm64.dmg` |
| Mac mit Intel-Prozessor | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu, Debian, Mint | `lbc-wallet_amd64.deb` |
| Fedora, openSUSE | `lbc-wallet.x86_64.rpm` |
| Andere Linux-Systeme | `LBC-Wallet-linux-x86_64.AppImage` |
| Android 7 oder neuer | `LBC-Wallet-android.apk` |

## 2. Installieren

* **Windows:** Doppelklicken Sie auf die Datei. Wenn die Meldung „Der Computer wurde durch Windows
  geschützt“ erscheint, klicken Sie auf **Weitere Informationen → Trotzdem ausführen**. Nehmen Sie
  die Lizenz an und klicken Sie auf **Installieren**.
* **Mac:** Öffnen Sie die `.dmg`-Datei, klicken Sie im englischsprachigen Lizenzfenster auf
  **Agree** und ziehen Sie **LBC Wallet** auf den Ordner **Applications** („Programme“). Beim
  ersten Start blockiert macOS die App: Öffnen Sie
  **Systemeinstellungen → Datenschutz & Sicherheit**, scrollen Sie nach unten und klicken Sie auf
  **Dennoch öffnen**.
* **Linux:** Doppelklicken Sie auf die `.deb`- oder `.rpm`-Datei, um sie mit Ihrer
  Softwareverwaltung zu installieren. Oder machen Sie das AppImage ausführbar (Rechtsklick →
  Eigenschaften → Zugriffsrechte → *Datei als Programm ausführen*) und doppelklicken Sie darauf.
* **Android:** Öffnen Sie den APK-Link auf Ihrem Smartphone, tippen Sie auf
  **Trotzdem herunterladen** und dann auf **Öffnen**. Erlauben Sie Ihrem Browser auf Nachfrage das
  **„Installieren unbekannter Apps“** und tippen Sie anschließend auf **Installieren**. Falls
  Play Protect Sie warnt, tippen Sie auf **Weitere Details → Trotzdem installieren**.

## 3. Erster Start

Lesen Sie den Haftungsausschluss, setzen Sie die drei Häkchen und klicken Sie auf
**Zustimmen & weiter**. Ihre Sprache wählen Sie über das Globus-Symbol.

## 4. Wallet erstellen oder wiederherstellen

* **Neu:** Klicken Sie auf **Neue Wallet erstellen**, wählen Sie einen Namen und ein Passwort und
  **schreiben Sie dann die 12 Wiederherstellungswörter der Reihe nach auf Papier**. Die App fragt
  zur Kontrolle drei davon ab.
* **Sie haben schon eine Phrase** (aus dieser App, LBRY Desktop, Odysee oder einer anderen
  BIP39-Wallet): Klicken Sie auf **Mit Wiederherstellungsphrase wiederherstellen** und geben Sie
  Ihre Wörter ein.

**Ihre Wiederherstellungswörter sind Ihr Geld.** Wer sie kennt, kann Ihre LBC stehlen. Geben Sie
sie niemals weiter, tippen Sie sie nie auf einer Website ein und speichern Sie sie nie als Foto.
Niemand vom Projekt wird Sie jemals danach fragen.

## 5. Empfangen

Klicken Sie auf **Empfangen**. Kopieren Sie Ihre Adresse (sie beginnt mit `b`) oder zeigen Sie dem
Absender den QR-Code.

## 6. Senden

Klicken Sie auf **Senden**, fügen Sie die Adresse ein, geben Sie den Betrag ein und klicken Sie auf
**Prüfen**. Kontrollieren Sie alle Angaben, geben Sie Ihr Passwort ein und klicken Sie auf die
Schaltfläche mit Ihrem Betrag, z. B. **5 LBC senden**. Zahlungen können nicht rückgängig gemacht
werden.

## 7. Mining

Klicken Sie auf **Mining** → **Mining starten** (unter Android: **Mehr → Mining**). Voreingestellt
ist der Pool LBRYPool, der automatisch an Ihre Wallet auszahlt, sobald Sie dort 10 LBC verdient
haben. Ein normaler Computer verdient nur sehr wenig und verbraucht Strom; nutzen Sie, wenn Sie
möchten, die Optionen **Im Akkubetrieb pausieren** und **Nur im Leerlauf**. Ein Smartphone verdient
noch weniger: Das Mining läuft dort nur, solange LBC Wallet auf dem Bildschirm geöffnet ist und das
Smartphone lädt, und es pausiert, wenn der Akku warm wird.

## 8. Eigenen Node betreiben (optional, nur auf Computern)

Sie müssen die Blockchain **nicht** herunterladen: Ohne Node nutzt die Wallet öffentliche
LBRY-Server und prüft jede Zahlung anhand des Proof of Work der Blöcke. Auf Smartphones arbeitet die
Wallet immer so. Wenn Sie trotzdem einen eigenen Node betreiben möchten, klicken Sie auf **Node**,
wählen Sie einen Ordner mit etwa **150 GB** freiem Speicherplatz (**Ändern…**; die Blockchain ist
etwa 100 GB groß, nicht 2 TB) und klicken Sie auf **Node starten**. Der erste Download dauert ein
bis drei Tage. Sobald er 100 % erreicht hat, nutzt die Wallet Ihren eigenen Node, und Sie können im
Modus **Solo (Full Node)** minen.

## 9. LBC und Bitcoin tauschen (optional)

Mit **Swap** tauschen Sie LBC gegen Bitcoin direkt mit einer anderen Person, ohne Börse dazwischen:
Entweder werden Sie beide bezahlt, oder Sie erhalten beide Ihre Coins zurück. Einer von Ihnen klickt
auf **Swap starten** und sendet den Einladungscode; der andere klickt auf **Mit Code beitreten**.
Lassen Sie die App geöffnet, bis der Swap **Abgeschlossen** anzeigt. Swaps sind neu: Beginnen Sie
mit einem kleinen Betrag. Mehr dazu: [Handbuch, Abschnitt 21](../README.md#21-buy-sell-or-swap-lbc).

## 10. LBC auf dem Markt kaufen oder verkaufen (optional)

Auf der Seite **Markt** sehen Sie Angebote anderer Nutzer von LBC Wallet, die LBC gegen Bitcoin
kaufen oder verkaufen möchten, und daneben zum Vergleich den Preis an den Börsen. Lesen Sie zuerst
den Warnhinweis auf der Seite. Klicken Sie bei einem Angebot auf **Kaufen** oder **Verkaufen**,
wählen Sie den Betrag und Ihre Bitcoin-Adresse und bestätigen Sie: Die andere Wallet antwortet
innerhalb von Sekunden, und der Trade läuft als Swap ab (Sie sperren zuerst; beide Wallets holen die
Coins selbstständig ab). Oder klicken Sie auf **Angebot einstellen**, um Ihren eigenen Preis
festzulegen; das Angebot bleibt in der Angebotsliste, solange Ihre Wallet geöffnet ist. Nur LBC und
Bitcoin lassen sich auf diese Weise handeln: Um mit USDT oder Monero zu bezahlen, tauschen Sie diese
zuerst in Bitcoin (zum Beispiel in Cake Wallet oder Trust Wallet). Mehr dazu:
[Handbuch, Abschnitt 22](../README.md#22-trade-on-the-market).

## Hilfe

Probleme? Lesen Sie den Abschnitt „Problems and solutions“ (Probleme und Lösungen) im
[Handbuch](../README.md#19-problems-and-solutions) oder melden Sie sie unter
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues>
(geben Sie dabei niemals Ihre Wiederherstellungswörter oder Ihr Passwort weiter).
