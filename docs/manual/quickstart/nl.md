[English](en.md) · [Alle talen](../README.md)

# LBC Wallet – snel aan de slag

LBC Wallet is een gratis app om **LBRY Credits (LBC)** te bewaren, te verzenden, te ontvangen en te
minen op Windows, Mac, Linux en Android. De volledige handleiding met afbeeldingen (in het Engels)
vind je hier: [docs/manual](../README.md).

> **Waarschuwing:** LBC Wallet is experimentele software en is **niet geaudit**. De app kan fouten
> bevatten waardoor je geld verliest. **Je gebruikt de app op eigen risico**; de auteurs zijn niet
> verantwoordelijk voor enig verlies. Begin met een klein bedrag. Volledige tekst (in het Engels):
> [DISCLAIMER](../../../DISCLAIMER.md).

## 1. Downloaden

Download de app alleen via de officiële pagina:
**<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest>**
(scrol omlaag naar het onderdeel **Assets**).

| Apparaat | Bestand |
| --- | --- |
| Windows | `LBC-Wallet-Setup-x64.exe` |
| Mac met Apple-chip (M1, M2…) | `LBC-Wallet-mac-arm64.dmg` |
| Mac met Intel-chip | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu, Debian, Mint | `lbc-wallet_amd64.deb` |
| Fedora, openSUSE | `lbc-wallet.x86_64.rpm` |
| Andere Linux-distributies | `LBC-Wallet-linux-x86_64.AppImage` |
| Android 7 of nieuwer | `LBC-Wallet-android.apk` |

## 2. Installeren

* **Windows:** dubbelklik op het bestand. Zie je “Windows heeft uw pc beschermd”, klik dan op
  **Meer informatie → Toch uitvoeren**. Accepteer de licentie en klik op **Installeren**.
* **Mac:** open het `.dmg`-bestand, klik op **Agree** (Akkoord) en sleep **LBC Wallet** naar
  **Applications**. De eerste keer blokkeert macOS de app: open
  **Systeeminstellingen → Privacy en beveiliging**, scrol omlaag en klik op **Open toch**.
* **Linux:** dubbelklik op het `.deb`- of `.rpm`-bestand om het met je softwarecentrum te
  installeren. Je kunt ook het AppImage-bestand uitvoerbaar maken (rechtsklik → Eigenschappen →
  Rechten → *Uitvoeren van bestand toestaan*) en erop dubbelklikken.
* **Android:** open de link naar de APK op je telefoon, tik op **Toch downloaden** en daarna op
  **Openen**. Sta **“Onbekende apps installeren”** toe voor je browser als je telefoon daarom
  vraagt en tik op **Installeren**. Als Play Protect je waarschuwt, tik je op
  **Meer details → Toch installeren** (More details → Install anyway).

## 3. De eerste keer starten

Lees de disclaimer, vink de drie vakjes aan en klik op **Akkoord – doorgaan**. Kies je taal via de
knop met de wereldbol.

## 4. Een wallet aanmaken of herstellen

* **Nieuwe wallet:** klik op **Nieuwe wallet aanmaken**, kies een naam en een wachtwoord en
  **schrijf daarna de 12 herstelwoorden in de juiste volgorde op papier**. Vervolgens controleert
  de app drie van die woorden.
* **Heb je al een herstelzin** (uit deze app, LBRY Desktop, Odysee of een andere BIP39-wallet)?
  Klik dan op **Herstellen met een herstelzin** en typ je woorden.

**Je herstelwoorden zijn je geld.** Iedereen die ze heeft, kan je LBC stelen. Deel ze nooit, typ
ze nooit in op een website en bewaar ze nooit als foto. Niemand van het project zal er ooit om
vragen.

## 5. Ontvangen

Klik op **Ontvangen**. Kopieer je adres (het begint met `b`) of laat de QR-code aan de afzender
zien.

## 6. Verzenden

Klik op **Verzenden**, plak het adres, vul het bedrag in, klik op **Controleren**, kijk alles goed
na, voer je wachtwoord in en klik op **Verzenden**. Betalingen kunnen niet worden teruggedraaid.

## 7. Minen

Klik op **Mining** → **Minen starten** (op Android: **Meer → Mining**). Standaard wordt de pool
LBRYPool gebruikt. Die betaalt automatisch uit naar je wallet zodra je daar 10 LBC hebt verdiend.
Een gewone computer levert heel weinig op en verbruikt stroom; zet als je wilt
**Pauzeren op batterij** en **Alleen bij inactiviteit** aan. Een telefoon levert nog minder op: het
minen draait daar alleen zolang LBC Wallet open op het scherm staat en de telefoon aan het opladen
is, en het pauzeert als de batterij warm wordt.

## 8. Je eigen node draaien (optioneel, alleen op computers)

Je hoeft de blockchain **niet** te downloaden: zonder node gebruikt de wallet openbare LBRY-servers
en controleert hij elke betaling aan de hand van de proof-of-work van de blokken. Telefoons werken
altijd zo. Wil je toch je eigen node draaien? Klik dan op **Node**, kies een map met ongeveer
**150 GB** vrije ruimte (**Wijzigen…**; de blockchain is ongeveer 100 GB, niet 2 TB) en klik op
**Node starten**. De eerste download duurt één tot drie dagen. Zodra die op 100% staat, gebruikt de
wallet je eigen node en kun je **Solo** minen.

## 9. LBC en Bitcoin ruilen (optioneel)

Met **Swap** ruil je LBC tegen Bitcoin rechtstreeks met iemand anders, zonder handelsplatform
ertussen: óf jullie worden allebei betaald, óf jullie krijgen allebei je munten terug. Een van
jullie klikt op **Swap starten** en stuurt de uitnodigingscode; de ander klikt op
**Deelnemen met een code**. Houd de app open tot de swap op **Voltooid** staat. Swaps zijn nieuw:
begin met een klein bedrag. Meer informatie:
[handleiding, onderdeel 21](../README.md#21-buy-sell-or-swap-lbc).

## 10. LBC kopen of verkopen op de Markt (optioneel)

**Markt** toont aanbiedingen van andere gebruikers van LBC Wallet om LBC te kopen of te verkopen
tegen Bitcoin, met de prijs op handelsplatformen ernaast ter vergelijking. Lees eerst de
waarschuwing op de pagina. Klik bij een aanbod op **Kopen** of **Verkopen**, kies het bedrag en je
Bitcoin-adres en bevestig: de andere wallet antwoordt binnen een paar seconden, en de trade verloopt
als een swap (jij vergrendelt eerst; beide wallets halen de munten vanzelf op). Of klik op
**Aanbod plaatsen** om zelf je prijs te kiezen; je aanbod blijft op de markt staan zolang je wallet
open is. Op deze manier kun je alleen LBC en Bitcoin verhandelen: wil je met USDT of Monero betalen,
wissel die dan eerst om naar Bitcoin (bijvoorbeeld in Cake Wallet of Trust Wallet). Meer informatie:
[handleiding, onderdeel 22](../README.md#22-trade-on-the-market).

## Hulp

Problemen? Bekijk het onderdeel “Problems and solutions” (problemen en oplossingen) in de
[handleiding](../README.md#19-problems-and-solutions), of meld ze op
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues> (deel nooit je
herstelwoorden of je wachtwoord).
