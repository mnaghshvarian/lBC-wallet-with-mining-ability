[English](en.md) · [Toutes les langues](../README.md)

# LBC Wallet — guide de démarrage rapide

LBC Wallet est une application gratuite pour conserver, envoyer, recevoir et miner des
**LBRY Credits (LBC)** sur Windows, Mac, Linux et Android. Le manuel complet avec des images
(en anglais) se trouve ici : [docs/manual](../README.md).

> **Attention :** LBC Wallet est un logiciel expérimental et **non audité**. Il peut contenir des
> erreurs qui font perdre de l’argent. **Vous l’utilisez à vos risques et périls** ; les auteurs ne
> sont responsables d’aucune perte. Commencez avec une petite somme. Texte complet (en anglais) :
> [DISCLAIMER](../../../DISCLAIMER.md).

## 1. Télécharger

Téléchargez l’application uniquement depuis la page officielle :
**<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest>**
(faites défiler la page jusqu’à la section **Assets**).

| Appareil | Fichier |
| --- | --- |
| Windows | `LBC-Wallet-Setup-x64.exe` |
| Mac avec puce Apple (M1, M2…) | `LBC-Wallet-mac-arm64.dmg` |
| Mac avec puce Intel | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu, Debian, Mint | `lbc-wallet_amd64.deb` |
| Fedora, openSUSE | `lbc-wallet.x86_64.rpm` |
| Autres distributions Linux | `LBC-Wallet-linux-x86_64.AppImage` |
| Android 7 ou plus récent | `LBC-Wallet-android.apk` |

## 2. Installer

* **Windows :** double-cliquez sur le fichier. Si le message « Windows a protégé votre ordinateur »
  s’affiche, cliquez sur **Informations complémentaires → Exécuter quand même**. Acceptez la licence
  et cliquez sur **Installer**.
* **Mac :** ouvrez le fichier `.dmg`, cliquez sur **Agree** (J’accepte), puis faites glisser
  **LBC Wallet** dans **Applications**. La première fois, macOS bloque l’application : ouvrez
  **Réglages Système → Confidentialité et sécurité**, faites défiler vers le bas et cliquez sur
  **Ouvrir quand même**.
* **Linux :** double-cliquez sur le fichier `.deb` ou `.rpm` pour l’installer avec votre
  logithèque. Vous pouvez aussi rendre l’AppImage exécutable (clic droit → Propriétés →
  Permissions → *Autoriser l’exécution du fichier comme un programme*) et double-cliquer dessus.
* **Android :** ouvrez le lien de l’APK sur votre téléphone, appuyez sur **Télécharger quand même**,
  puis sur **Ouvrir**. Quand le téléphone vous le demande, autorisez votre navigateur dans
  **« Installation d’applis inconnues »** et appuyez ensuite sur **Installer**. Si Play
  Protect affiche un avertissement, appuyez sur **Plus de détails → Installer quand même**
  (More details → Install anyway).

## 3. Premier démarrage

Lisez l’avertissement, cochez les trois cases et cliquez sur **J’accepte — continuer**. Choisissez
votre langue avec le bouton en forme de globe.

## 4. Créer ou restaurer un portefeuille

* **Nouveau portefeuille :** cliquez sur **Créer un nouveau portefeuille**, choisissez un nom et un
  mot de passe, puis **notez les 12 mots de récupération sur papier**, dans l’ordre. L’application
  vérifie ensuite trois d’entre eux.
* **Vous avez déjà une phrase de récupération** (de cette application, de LBRY Desktop, d’Odysee ou
  d’un autre portefeuille BIP39) : cliquez sur **Restaurer à partir d’une phrase de récupération**
  et saisissez vos mots.

**Vos mots de récupération, c’est votre argent.** Toute personne qui les possède peut prendre vos
LBC. Ne les partagez jamais, ne les saisissez jamais sur un site web et ne les gardez jamais en
photo. Aucun membre du projet ne vous les demandera jamais.

## 5. Recevoir

Cliquez sur **Recevoir**. Copiez votre adresse (elle commence par `b`) ou montrez le code QR à
l’expéditeur.

## 6. Envoyer

Cliquez sur **Envoyer**, collez l’adresse, saisissez le montant, cliquez sur **Vérifier**, relisez
tout, entrez votre mot de passe et cliquez sur **Envoyer**. Les paiements sont irréversibles.

## 7. Miner

Cliquez sur **Minage** → **Démarrer le minage** (sur Android : **Plus → Minage**). Par défaut,
l’application utilise le pool LBRYPool, qui verse automatiquement vos gains sur votre portefeuille
dès que vous y avez gagné 10 LBC. Un ordinateur ordinaire rapporte très peu et consomme de
l’électricité ; si vous le souhaitez, activez **Mettre en pause sur batterie** et
**Uniquement en cas d’inactivité**. Un téléphone rapporte encore moins : le minage n’y fonctionne
que lorsque LBC Wallet est ouvert à l’écran et que le téléphone est en charge, et il se met en pause
quand la batterie chauffe.

## 8. Faire tourner votre propre nœud (facultatif, ordinateurs uniquement)

Cliquez sur **Nœud**, choisissez un dossier disposant d’environ **150 Go** d’espace libre
(**Modifier…**), puis cliquez sur **Démarrer le nœud**. Le premier téléchargement prend entre un et
trois jours. Quand il atteint 100 %, le portefeuille utilise votre propre nœud et vous pouvez miner
en mode **Solo**.

## 9. Échanger des LBC et des bitcoins (facultatif)

La page **Échanger** vous permet d’échanger des LBC contre des bitcoins directement avec une autre
personne, sans passer par une plateforme d’échange : soit vous êtes payés tous les deux, soit vous
récupérez tous les deux vos fonds. L’un de vous deux clique sur **Démarrer un échange** et envoie le
code d’invitation ; l’autre clique sur **Rejoindre avec un code**. Gardez l’application ouverte
jusqu’à ce que l’échange affiche **Terminé**. La fonction d’échange est nouvelle : commencez avec
une petite somme. Pour en savoir plus : [manuel, section 21](../README.md#21-buy-sell-or-swap-lbc).

## Aide

En cas de problème, consultez la section « Problems and solutions » (problèmes et solutions) du
[manuel](../README.md#19-problems-and-solutions) ou signalez-le sur
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues> (ne communiquez jamais vos
mots de récupération ni votre mot de passe).
