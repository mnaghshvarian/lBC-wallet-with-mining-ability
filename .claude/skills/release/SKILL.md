---
name: release
description: Cut a new LBC Wallet version (desktop installers + Android APK) as a DRAFT GitHub release — bump versions everywhere, write release notes, get CI green, run the release workflow and check the draft. Use when asked to release, publish, ship or bump the version of LBC Wallet.
---

# Releasing LBC Wallet

Releases are always **drafts**: the maintainer checks and publishes them by hand. Never publish a
release, delete one, or push a tag without being asked. When the maintainer asks you to publish a
checked draft, use the **Publish release** workflow (section 7), never a force-pushed tag or a
hand-made release edit.

## 1. Bump the version (all of these, same number)

```bash
v=1.3.0
for p in package.json packages/*/package.json apps/*/package.json; do
  node -e "const f='$p',j=require('./'+f);j.version='$v';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
done
npm install --package-lock-only   # updates package-lock.json's workspace versions
grep -rn "\"version\"" package.json packages/*/package.json apps/*/package.json
```

* `packages/miner-wasm/package.json` is included by the glob.
* Android takes its version from `apps/mobile/package.json`: `1.3.0` → versionName `1.3.0`,
  versionCode `10300` (see `apps/mobile/android/app/build.gradle`). Nothing else to change.
* The release workflow refuses a version that differs from `apps/desktop/package.json`.

## 2. Release notes

`docs/release-notes.md` becomes the body of the draft. Replace the "What's new in this version"
section (keep the warning at the top, the file table and "Good to know"). Plain words for
beginners; say what is new, what is risky, what is not audited. Also update, when relevant:
README.md, docs/ROADMAP.md ("Where we are"), docs/manual/README.md, DISCLAIMER.md (then run
`node apps/desktop/scripts/license-text.mjs` — a test compares the installer license page with
it), docs/announcement/.

## 3. Checks before pushing

```bash
npm run typecheck
npm test                                   # unit tests of every package (incl. translations)
LBCD_BIN=… BTCD_BIN=… npm run test:e2e     # see the regtest-tests skill
```

Commit (message ends with the attribution lines the session gives), then
`git push -u origin <branch>`; retry only on network errors (2 s, 4 s, 8 s, 16 s).

## 4. CI must be green

Workflows in `.github/workflows/`: `ci.yml` (checks on 3 OSes, regtest e2e with lbcd + btcd,
desktop UI test, packaged-app tests on installed Windows/macOS, Android build + emulator, wasm),
`mainnet.yml` (real network, read-only; see mainnet-check skill), `release.yml`.
Use the GitHub MCP tools (`mcp__github__actions_list`, `actions_get`, `get_job_logs`) to watch
runs; fix real failures at the root cause — never skip or disable a test.

## 5. Build the draft

Trigger `release.yml` with `workflow_dispatch` and input `version` = the new number (e.g.
`mcp__github__actions_run_trigger` with `inputs: {"version": "1.3.0"}` on the branch that has
the bump). It builds Windows (installer + portable), macOS (arm64 + x64 dmg), Linux (deb, rpm,
AppImage, x64 + arm64) and the Android APK, and attaches them with `SHA256SUMS-*.txt` to a draft
named after the tag.

Check the draft: every asset present (names in the README download table), checksums attached,
notes rendered. If a platform job failed, read its log, fix, and re-run the workflow (it
refreshes the same draft).

## 6. Tell the user

Link the draft, list what is in it, what was tested (and what was not: unsigned builds warn on
Windows/macOS; real-network payment tests need `MAINNET_TEST_PHRASE`), and that publishing is
their click.

## 7. Publishing (only when the maintainer asks)

Trigger `publish-release.yml` with `workflow_dispatch` and input `version` (e.g.
`mcp__github__actions_run_trigger`, `workflow_id: publish-release.yml`, `inputs: {"version":
"1.3.0"}`), or from the Actions tab. It checks that every file the README links to is on the
draft, finds the commit the newest successful Release run built from, creates the tag `vX.Y.Z` on
that commit (GitHub would otherwise create it on the draft's original target, which a rebuilt
draft keeps), publishes, marks the release as latest and checks the `releases/latest/download/…`
links. Changes made with the workflow's own token start no other workflow, so creating the tag
does not rebuild the release. If a tag ended up on the wrong commit, run the workflow again with
`fix_tag` right away, before anyone relies on the tag; never force-push a tag by hand.

Only after publishing do the download links in the README and the manual work; drafts are
invisible to everyone but the maintainer, and `releases/latest` ignores them.
