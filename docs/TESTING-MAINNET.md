# Testing on the real LBC network (mainnet)

The automated tests cover a lot (see the README), but some things can only be checked by a
person on the real network, with real coins:

* **Mining is not allowed on GitHub's servers** (their terms forbid it), so CI only logs in to
  LBRYPool and checks that the work it sends is for the real chain tip — it never hashes.
* Sending real LBC needs real LBC.

This checklist takes about an hour of your time (plus waiting). **Use small amounts only.** Please
report the result — good or bad — at
<https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues> (never post your recovery
phrase, password or keys).

## Before you start

* A computer (Windows, Mac or Linux) and, optionally, an Android phone.
* A few LBC to test with (for example 20 LBC from an exchange or a friend).
* Install LBC Wallet as described in the [manual](manual/README.md).

## 1. Receive and send (15 minutes)

1. Create a **new** wallet ("Test"). Write down the recovery phrase.
2. **Receive:** copy your address (starts with `b`) and send the test LBC to it from the exchange
   or friend.
   * ✅ Within seconds, a notification and a **Pending** entry appear in Activity.
   * ✅ After a few minutes it shows **1 conf.**, then **Verified** (the proof was checked against
     the block header).
3. On the phone (or as a second wallet on the computer), create wallet "Test 2".
4. **Send** 1 LBC from "Test" to "Test 2" with the note "mainnet test".
   * ✅ The review shows the amount, fee (a fraction of a cent) and change.
   * ✅ "Test 2" shows the payment as pending, then confirmed.
   * ✅ Clicking the payment → **View in explorer** shows it on explorer.lbry.com.
5. **Restore check:** on another device (or after deleting "Test 2"), restore "Test 2" from its
   phrase. ✅ The 1 LBC and the history come back.

## 2. Pool mining (30 minutes to see it working)

1. Open **Mining** with "Test" unlocked. Keep **Pool (recommended)** and **LBRYPool**.
2. Click **Start mining**.
   * ✅ The log shows *connected*, *authorized as b…*, then work arrives.
   * ✅ Within a few minutes, **Shares** shows accepted shares (green), and the hashrate is
     roughly 1–2.5 MH/s per thread.
3. Open <https://lbrypool.net>, search for your payout address.
   * ✅ After 10–30 minutes the pool lists your worker ("desktop") and an **unpaid balance** that
     slowly grows.
4. Optional: switch on **Only when idle**, wait, move the mouse — ✅ mining pauses at once and
   resumes after the idle time.

**About payouts:** LBRYPool pays automatically once your unpaid balance reaches **10 LBC**. A
typical computer earns roughly **0.05–0.1 LBC per day**, so a *payout* from CPU mining can take
**months**. That is expected — LBC is mined mostly by specialized hardware. The mining works when
shares are accepted and the pool's unpaid balance grows. When a payout arrives, ✅ it appears in
the wallet like any other payment and can be sent on.

## 3. Built-in node and solo mining (needs ~150 GB and 1–3 days)

1. **Node** page → choose a folder with enough space → **Start node**.
   * ✅ Within minutes: several **peers**, headers and blocks counting up, an estimated time left.
2. Leave it running until it shows **Your node is ready** (100 %).
   * ✅ The status in the corner says **your node**; balances and history are the same as before.
3. **Mining → Solo (full node)**: ✅ it says *Using the built-in node — ready*, and **Start
   mining** shows "mining block N" with N = the current block height.

Finding a block solo with a CPU is extremely unlikely (it could take many years); the test is that
mining runs against your own node without errors.

## 4. Report

Please open an issue titled "Mainnet test: <your system>" with:

* system and version (Settings → About),
* which steps worked (✅) and which didn't, with the exact message or a screenshot (hide your
  addresses if you prefer),
* for mining: your hashrate and how many shares were accepted in 30 minutes.

Thank you — this is how the wallet gets safer for everyone.
