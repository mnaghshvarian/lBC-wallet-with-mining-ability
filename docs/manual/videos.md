# The video manual

Short narrated videos that show the same things as the [written manual](README.md), recorded
from the real app on a private test network. One video per chapter, so you can watch only the
part you need:

| # | Video | What it shows |
| --- | --- | --- |
| 0 | Installing LBC Wallet | Where to download, checking the checksum, the Windows and Mac warnings, Linux, Android |
| 1 | First start and your first wallet | The disclaimer, creating a wallet, the recovery phrase, the three-word check |
| 2 | Restore a wallet, receive and send | Restoring from a recovery phrase, your address, sending with review and password, Activity |
| 3 | Mining and the built-in node | Pool mining and what to expect, the full node |
| 4 | The Market: buy and sell LBC for Bitcoin | The warning, reading the board, taking an offer, posting your own, the Swap page |
| 5 | Settings and security | General, Network and Security settings, locking the wallet |

The videos are too large for the repository itself: find them on the project's GitHub Releases
page, attached to the release they were made for. Each comes with an `.srt` subtitle file of the
narration (and a `.vtt` one for web pages).

**What the videos are made of.** Everything on screen is the real app, driven by the same
robot that runs the UI test, on a private LBC test network, so the coins, addresses and offers
you see are test data. The narration is the English manual's wording, spoken by a neural
text-to-speech voice. The pointer and the caption bar are drawn by the app's own window for the
recording.

**Making them again** (after UI changes, or for another language):

```bash
npm run build -w lbc-wallet-desktop
npx playwright install ffmpeg          # once: the video encoder the recorder uses
npm run -s videos:captions -w lbc-wallet-desktop > /tmp/videos/captions.json   # the texts
KOKORO_DIR=~/kokoro python3 scripts/manual-video.py tts /tmp/videos           # speak them (kokoro-onnx + model files)
VIDEO_DIR=/tmp/videos LBCD_BIN=… xvfb-run -a npm run videos -w lbc-wallet-desktop
python3 scripts/manual-video.py build /tmp/videos                             # cards, cuts, narration → out/*.mp4
```

`apps/desktop/e2e/manual-videos.ts` holds the script of every chapter and its captions;
`scripts/manual-video.py` holds the installation cards. Without the speech engine the build
still works: the captions stay on screen and the videos are silent.
