[English](en.md) · [Todos os idiomas](../README.md)

# LBC Wallet — guia de início rápido

O LBC Wallet é um app gratuito para guardar, enviar, receber e minerar **LBRY Credits (LBC)** no
Windows, no Mac, no Linux e no Android. O manual completo com imagens (em inglês) está aqui:
[docs/manual](../README.md).

> **Atenção:** o LBC Wallet é experimental e **não foi auditado**. Ele pode conter erros que façam
> você perder dinheiro. **Você usa o app por sua conta e risco**; os autores não se responsabilizam
> por nenhuma perda. Comece com um valor pequeno. Texto completo (em inglês):
> [DISCLAIMER](../../../DISCLAIMER.md).

## 1. Baixar

Baixe o app somente pela página oficial:
**<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest>**
(role a página para baixo até a seção **Assets**).

| Dispositivo | Arquivo |
| --- | --- |
| Windows | `LBC-Wallet-Setup-x64.exe` |
| Mac com chip Apple (M1, M2…) | `LBC-Wallet-mac-arm64.dmg` |
| Mac com chip Intel | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu, Debian, Mint | `lbc-wallet_amd64.deb` |
| Fedora, openSUSE | `lbc-wallet.x86_64.rpm` |
| Outras distribuições Linux | `LBC-Wallet-linux-x86_64.AppImage` |
| Android 7 ou mais recente | `LBC-Wallet-android.apk` |

## 2. Instalar

* **Windows:** clique duas vezes no arquivo. Se aparecer “O Windows protegeu o computador”
  (Windows protected your PC), clique em **Mais informações → Executar assim mesmo**. Aceite a
  licença e clique em **Instalar**.
* **Mac:** abra o arquivo `.dmg`, clique em **Agree** (Concordo) e arraste o **LBC Wallet** para a
  pasta **Applications** (Aplicativos). Na primeira vez, o macOS bloqueia o app: abra
  **Ajustes do Sistema → Privacidade e Segurança**, role para baixo e clique em
  **Abrir Mesmo Assim**.
* **Linux:** clique duas vezes no arquivo `.deb` ou `.rpm` para instalá-lo pela central de
  programas do sistema. Se preferir, torne o AppImage executável (clique com o botão direito →
  Propriedades → Permissões → *Permitir execução do arquivo como um programa*) e clique duas
  vezes nele.
* **Android:** abra o link do APK no celular, toque em **Baixar mesmo assim** e depois em
  **Abrir**. Quando o celular pedir, permita **“Instalar apps desconhecidos”** para o seu navegador
  e toque em **Instalar**. Se o Play Protect mostrar um aviso, toque em
  **Mais detalhes → Instalar mesmo assim** (More details → Install anyway).

## 3. Primeiro uso

Leia o aviso legal, marque as três caixas e clique em **Concordo — continuar**. Escolha o seu
idioma no botão do globo.

## 4. Criar ou restaurar uma carteira

* **Carteira nova:** clique em **Criar uma nova carteira**, escolha um nome e uma senha e depois
  **anote em papel as 12 palavras de recuperação**, na ordem. Em seguida, o app confere três delas.
* **Já tem uma frase de recuperação** (deste app, do LBRY Desktop, da Odysee ou de outra carteira
  BIP39): clique em **Restaurar com uma frase de recuperação** e digite as suas palavras.

**Suas palavras de recuperação são o seu dinheiro.** Qualquer pessoa que tenha essas palavras pode
levar os seus LBC. Nunca as compartilhe, nunca as digite em um site e nunca as guarde em foto.
Ninguém do projeto jamais vai pedi-las a você.

## 5. Receber

Clique em **Receber**. Copie o seu endereço (ele começa com `b`) ou mostre o código QR para quem
vai fazer o pagamento.

## 6. Enviar

Clique em **Enviar**, cole o endereço, informe o valor, clique em **Revisar**, confira tudo, digite
a sua senha e clique em **Enviar**. Os pagamentos não podem ser desfeitos.

## 7. Minerar (só em computadores)

Clique em **Mineração** → **Iniciar mineração**. O pool padrão é o LBRYPool, que paga
automaticamente para a sua carteira assim que você tiver ganhado 10 LBC nele. Um computador comum
rende muito pouco e gasta energia elétrica; se quiser, ative **Pausar quando estiver na bateria** e
**Apenas com o computador ocioso**.

## 8. Executar o seu próprio nó (opcional, só em computadores)

Clique em **Nó**, escolha uma pasta com cerca de **150 GB** de espaço livre (**Alterar…**) e
clique em **Iniciar nó**. O primeiro download leva de um a três dias. Quando chegar a 100%, a
carteira passa a usar o seu próprio nó, e você pode minerar no modo **Solo**.

## Ajuda

Teve algum problema? Veja a seção “Problems and solutions” (problemas e soluções) do
[manual](../README.md#19-problems-and-solutions) ou relate o problema em
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues> (nunca compartilhe as
suas palavras de recuperação nem a sua senha).
