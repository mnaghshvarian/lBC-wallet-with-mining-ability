[English](en.md) · [Todos los idiomas](../README.md)

# LBC Wallet: guía de inicio rápido

LBC Wallet es una app gratuita para guardar, enviar, recibir y minar **LBRY Credits (LBC)** en
Windows, Mac, Linux y Android. El manual completo con imágenes (en inglés) está aquí:
[docs/manual](../README.md).

> **Advertencia:** LBC Wallet es un software experimental y **no ha sido auditado**. Puede contener
> errores que te hagan perder dinero. **Lo usas por tu cuenta y riesgo**; los autores no son
> responsables de ninguna pérdida. Empieza con una cantidad pequeña. Texto completo (en inglés):
> [DISCLAIMER](../../../DISCLAIMER.md).

## 1. Descargar

Descarga LBC Wallet solo desde la página oficial:
**<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases/latest>**
(desplázate hacia abajo hasta la sección **Assets**).

| Dispositivo | Archivo |
| --- | --- |
| Windows | `LBC-Wallet-Setup-x64.exe` |
| Mac con chip de Apple (M1, M2…) | `LBC-Wallet-mac-arm64.dmg` |
| Mac con chip Intel | `LBC-Wallet-mac-x64.dmg` |
| Ubuntu, Debian, Mint | `lbc-wallet_amd64.deb` |
| Fedora, openSUSE | `lbc-wallet.x86_64.rpm` |
| Otras distribuciones de Linux | `LBC-Wallet-linux-x86_64.AppImage` |
| Android 7 o posterior | `LBC-Wallet-android.apk` |

## 2. Instalar

* **Windows:** haz doble clic en el archivo. Si ves “Windows protegió su PC”, haz clic en
  **Más información → Ejecutar de todas formas**. Acepta la licencia y haz clic en **Instalar**.
* **Mac:** abre el archivo `.dmg`, haz clic en **Agree** (Acepto) y arrastra **LBC Wallet** a la
  carpeta **Applications** (Aplicaciones). La primera vez, macOS bloquea la app: abre
  **Configuración del Sistema → Privacidad y seguridad**, desplázate hacia abajo y haz clic en
  **Abrir de todos modos**. (En España, macOS muestra **Ajustes del Sistema** y **Abrir igualmente**.)
* **Linux:** haz doble clic en el archivo `.deb` o `.rpm` para instalarlo con tu centro de software.
  O bien, dale permiso de ejecución al archivo AppImage (clic derecho → Propiedades → Permisos →
  *Permitir ejecutar el archivo como un programa*) y ábrelo con doble clic.
* **Android:** abre el enlace del APK en tu teléfono, toca **Descargar de todos modos** y luego
  **Abrir**. Cuando el teléfono te lo pida, permite **“Instalar apps desconocidas”** para tu
  navegador y después toca **Instalar**. Si Play Protect te muestra una advertencia, toca
  **Más detalles → Instalar de todas formas** (More details → Install anyway).

## 3. Primer inicio

Lee el aviso legal, marca las tres casillas y haz clic en **Acepto, continuar**. Elige tu idioma
con el botón del globo terráqueo.

## 4. Crear o restaurar una billetera

* **Billetera nueva:** haz clic en **Crear una billetera nueva**, elige un nombre y una contraseña
  y luego **escribe en papel las 12 palabras de recuperación**, en orden. Después, la app comprueba
  tres de ellas.
* **Si ya tienes una frase de recuperación** (de esta app, de LBRY Desktop, de Odysee o de otra
  billetera BIP39): haz clic en **Restaurar desde una frase de recuperación** y escribe tus
  palabras.

**Tus palabras de recuperación son tu dinero.** Cualquiera que las tenga puede llevarse tus LBC.
Nunca las compartas, nunca las escribas en un sitio web y nunca las guardes en una foto. Nadie del
proyecto te las pedirá jamás.

## 5. Recibir

Haz clic en **Recibir**. Copia tu dirección (comienza con `b`) o muestra el código QR a quien te
va a enviar el pago.

## 6. Enviar

Haz clic en **Enviar**, pega la dirección, indica la cantidad, haz clic en **Revisar**, comprueba
todo, escribe tu contraseña y haz clic en **Enviar**. Los pagos no se pueden deshacer.

## 7. Minar (solo en computadoras)

Haz clic en **Minería** → **Iniciar minería**. De forma predeterminada se usa el pool LBRYPool,
que paga automáticamente a tu billetera cuando hayas ganado 10 LBC en él. Una computadora normal
gana muy poco y consume electricidad; si quieres, activa **Pausar con batería** y
**Solo con la computadora inactiva**.

## 8. Ejecutar tu propio nodo (opcional, solo en computadoras)

Haz clic en **Nodo**, elige una carpeta con unos **150 GB** de espacio libre (**Cambiar…**) y haz
clic en **Iniciar nodo**. La primera descarga tarda entre uno y tres días. Cuando llegue al 100 %,
la billetera usará tu propio nodo y podrás minar en modo **En solitario**.

## Ayuda

¿Tienes algún problema? Consulta la sección “Problems and solutions” (problemas y soluciones) del
[manual](../README.md#19-problems-and-solutions) o cuéntanoslo en
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues> (nunca compartas tus
palabras de recuperación ni tu contraseña).
