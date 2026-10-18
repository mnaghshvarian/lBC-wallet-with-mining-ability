---
name: mainnet-check
description: Check LBC Wallet against the REAL LBC and Bitcoin networks safely — the read-only mainnet workflow (hubs, proof-of-work headers, SPV proofs, pool login, Bitcoin explorers, built-in node sync, the installed Windows app) and the optional real payment with a small test wallet. Use when asked whether the wallet works on mainnet, after hub/explorer changes, or when the weekly mainnet run fails.
---

# Real-network checks

Rules that never change:

* **Nothing is mined** on GitHub Actions or any CI (pool logins only, no hashing) — it breaks the
  providers' terms and pools' rules.
* No recovery phrase in code, logs, screenshots or messages. The only real-funds test uses the
  `MAINNET_TEST_PHRASE` repository secret of a small, dedicated wallet; the app script takes no
  screenshot while a phrase is on screen.
* Never publish to public Nostr relays from tests; read-only queries are fine.

## The workflow

`.github/workflows/mainnet.yml` runs weekly and on demand (`workflow_dispatch`):

* **mainnet** job: `npm run test:mainnet -w @lbcwallet/core` — every default hub answers on the real
  chain (genesis, recent headers with valid proof of work, SPV proofs of real transactions), a
  Stratum login to LBRYPool, the Bitcoin explorers (blockstream.info, mempool.space) agree; and
  the built-in node finds peers and syncs for a few minutes.
* **payment** job (only `workflow_dispatch`, needs the `MAINNET_TEST_PHRASE` secret): restores the
  test wallet and sends 0.01 LBC to itself through the wallet code, waiting for a confirmation
  verified against block headers (`packages/services/mainnet/self-send.ts`).
* **windows-app** job: installs the Windows build and drives it on the real network
  (`apps/desktop/mainnet/app-mainnet.ts`): sync, LBC supply card, server tests, swap fee; with the
  secret, a 0.01 LBC payment through the Send screen.

Trigger it with `mcp__github__actions_run_trigger` (workflow `mainnet.yml`, the branch), then read
job logs with `mcp__github__get_job_logs`. The user adds the secret themselves (Settings →
Secrets and variables → Actions); never ask them to paste a phrase into the chat.

## Locally (when the sandbox can reach the hubs)

```bash
npx vitest run --dir packages/core/mainnet
LBCD_BIN=… npx tsx apps/desktop/mainnet/node-sync.ts 8
npm run build -w lbc-wallet-desktop && xvfb-run -a npx tsx apps/desktop/mainnet/app-mainnet.ts
```

Sandboxed sessions may only reach HTTPS through a proxy; raw TCP to hubs on port 50001 can be
blocked. Say so instead of claiming a mainnet result you could not get.

## When a hub fails

Check it by hand (Settings → Network → Test, or the mainnet test output): wrong chain, far behind
(the wallet skips hubs whose tip is stale), or down. Default hubs are in
`packages/core/src/networks.ts` (`defaultHubs`, with the date they were verified); update the
list and the manual's server table (docs/manual/README.md, "Which servers does the wallet
use?") together.
