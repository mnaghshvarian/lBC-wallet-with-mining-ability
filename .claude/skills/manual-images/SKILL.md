---
name: manual-images
description: Refresh the beginner's manual's screenshots, animated GIFs and PDF from the robot-driven UI test (desktop) and the Android emulator test. Use after UI changes, new pages or new languages, or when the manual's pictures look outdated.
---

# Manual pictures and PDF

1. Take fresh screenshots (see the regtest-tests skill):

   ```bash
   npm run build -w lbc-wallet-desktop
   SCREENSHOT_DIR=/tmp/shots LBCD_BIN=… xvfb-run -a npm run test:ui -w lbc-wallet-desktop
   ```

   Android pictures come from the emulator test (`SCREENSHOT_DIR=… npm run test:device -w
   lbc-wallet-mobile`).

2. Turn them into the manual's images (needs Pillow; quantised PNGs and GIFs):

   ```bash
   python3 scripts/manual-images.py /tmp/shots
   ```

   `PICTURES`, `ANDROID` and `ANIMATIONS` in the script map screenshot names (e.g.
   `14c-market-board`) to manual images (`market-board.png`). Add new pages there and reference
   the image in `docs/manual/README.md`.

3. Look at every changed picture before committing: no recovery phrase or real address of
   anyone on screen, no toast covering content, the expected language, nothing cut off.
   The swap pictures (`swap-*.png`) were made from sample data, not from the UI test.

4. Regenerate the PDF:

   ```bash
   npm run docs:pdf        # node scripts/manual-pdf.mjs [chromium path]
   ```

   It uses playwright-core with the installed Chromium (`PLAYWRIGHT_BROWSERS_PATH`); check a few
   pages (table of contents links, images, tables).

5. Quick-start guides in other languages link to the English manual's section anchors
   (`#22-trade-on-the-market` …): when sections are renumbered, update every
   `docs/manual/quickstart/*.md`.
