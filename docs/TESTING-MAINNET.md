# Testing on the real LBC network (mainnet)

Most tests run on a private test network (see the README). This page covers the tests on the
**real** network: what GitHub runs by itself, the real payment you can switch on once, and the
checklist for a person with a few LBC. **Use small amounts only.** Please report results, good or
bad, at <https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/issues>. Never post your
recovery phrase, password or keys.

## What GitHub checks by itself

These run on every push and every Monday (*Actions → Mainnet check*). They don't need any coins.

| Check | What it proves |
| --- | --- |
| Public LBRY servers (hubs) | They answer and agree on the newest block, and the wallet skips one that is stuck behind. |
| Proof of work | Block headers from the servers link up and carry valid LBRY proof of work. |
| A real payment's proof | A real transaction's merkle proof checks out against its block header, the same check the wallet runs for every confirmation. |
| LBRYPool | The pool accepts a login and sends work for the current block. No hashing. |
| Bitcoin explorers for swaps | blockstream.info and mempool.space answer and agree. The cross-check that guards a swap accepts a real Bitcoin payment and rejects one that doesn't match. |
| The Market's Nostr relays | Most of the five default relays accept the wallet's own WebSocket client and answer the order board's query; every event they send passes the signature check. Read-only: nothing is published. |
| Built-in node | The bundled `lbcd` finds peers and downloads and verifies mainnet blocks. |
| **The installed Windows app** | The installer is built and installed silently. A robot then uses the app like a person: it accepts the disclaimer and creates a wallet. It waits until the wallet has synced with the public servers, checks the LBC supply figures, tests the servers in Settings and reads the Bitcoin fee on the Swap page. |

**Nothing is mined on GitHub.** GitHub's terms forbid mining on their servers, so the pool check
only logs in.

## Switch on the real payment test (once, about 10 minutes)

When you start the check by hand, GitHub can also send real LBC. The test wallet sends 0.01 LBC
to its own next address twice. One payment goes straight through the wallet code (Linux). The
other goes through the **Send screen of the installed Windows app**. Both wait until the payment
is confirmed and checked against the block header. Each run costs two network fees, far less than
0.001 LBC together, and the 0.01 LBC stays in the test wallet.

1. In LBC Wallet, **create a new wallet just for this** (for example "GitHub test") and write
   down its recovery phrase. Don't use your main wallet, because the phrase will be stored on
   GitHub.
2. Send that wallet **about 1 LBC**.
3. On GitHub, open the repository, then **Settings → Secrets and variables → Actions → New
   repository secret**.
   * **Name:** `MAINNET_TEST_PHRASE`
   * **Secret:** the recovery phrase, with single spaces between the words.

   Click **Add secret**.
4. Open **Actions → Mainnet check → Run workflow**, choose the branch, and click **Run
   workflow**.
5. After 30 to 60 minutes these two jobs should be green:
   * ✅ **A real LBC payment (test wallet sends to itself)**
   * ✅ **Installed Windows app on the real network**

   The Windows app's screenshots are under **Artifacts** at the bottom of the run page
   (`screenshots-windows-mainnet`): the synced wallet, its verified history, the payment review
   and the confirmed payment.

**Safety:**

* GitHub stores secrets encrypted and hides them in logs.
* GitHub doesn't give secrets to pull requests from other people's copies (forks).
* Anyone you give *write* access to this repository could still read the secret through a
  workflow, so keep only a few LBC in that wallet.
* The robot never takes a screenshot while the recovery phrase is on screen.
* To stop, delete the secret.

## By hand (about an hour, with a few LBC)

### Before you start

* A computer (Windows, Mac or Linux) and, if you have one, an Android phone.
* A few LBC to test with, for example 20 LBC from an exchange or a friend.
* Install LBC Wallet as described in the [manual](manual/README.md). The builds are not
  code-signed, so expect a warning the first time. On **Windows**, click *More info → Run
  anyway*. On a **Mac**, use *System Settings → Privacy & Security → Open Anyway*. The warning
  means the app has no paid certificate; it doesn't mean a virus was found. To be sure your file
  is genuine, compare its checksum ([manual, section 20](manual/README.md#20-check-that-your-download-is-genuine-optional)).

### 1. Receive and send (15 minutes)

1. Create a **new** wallet ("Test") and write down its recovery phrase.
2. **Receive:** copy your address (it starts with `b`) and send the test LBC to it.
   * ✅ Within seconds, a notification and a **Pending** entry appear in Activity.
   * ✅ After a few minutes the entry shows **1 conf.**. When you click it, it says *Verified
     against the block header*.
3. On the phone (or as a second wallet on the computer), create wallet "Test 2".
4. **Send** 1 LBC from "Test" to "Test 2" with the note "mainnet test".
   * ✅ The review shows the amount, the fee (a fraction of a cent) and the change.
   * ✅ "Test 2" shows the payment as pending, then confirmed.
   * ✅ Clicking the payment → **View in explorer** shows it on explorer.lbry.com.
5. **Restore check:** on another device (or after deleting "Test 2"), restore "Test 2" from its
   phrase. ✅ The 1 LBC and the history come back.

### 2. Pool mining on a computer (30 minutes to see it working)

1. Open **Mining** with "Test" unlocked. Keep **Pool (recommended)** and **LBRYPool**.
2. Click **Start mining**.
   * ✅ The log shows *connected*, *authorized as b…*, then work arrives.
   * ✅ Within a few minutes, **Shares** shows accepted shares (in green). The hashrate is
     roughly 1 to 2.5 MH/s per thread.
3. Open <https://lbrypool.net> and search for your payout address.
   * ✅ After 10 to 30 minutes the pool lists your worker ("desktop") and an **unpaid
     balance** that slowly grows.
4. Optional: switch on **Only when idle**, wait, then move the mouse.
   * ✅ Mining pauses at once.
   * ✅ It resumes after the idle time.
5. ✅ The **LBC supply** card shows the block reward now (135 LBC in October 2026) and how much
   LBC is left to mine.

**About payouts:** LBRYPool pays automatically once your unpaid balance reaches **10 LBC**. A
typical computer earns roughly **0.05 to 0.1 LBC per day**, so a payout from CPU mining can take
**months**. That is expected: LBC is mined mostly by specialized hardware. The mining works when
shares are accepted and the pool's unpaid balance grows. When a payout arrives, ✅ it appears in
the wallet like any other payment.

### 3. Mining on an Android phone (15 minutes)

1. On the phone, open **More → Mining** with a wallet unlocked.
2. Plug in the charger and tap **Start mining**.
   * ✅ Shares are accepted.
   * ✅ The hashrate is much lower than on a computer.
3. Unplug the charger. ✅ Mining pauses with *Waiting for a charger*. Plug it in again, and ✅
   mining resumes.
4. Switch to another app for a moment and come back. ✅ The page shows that mining paused while
   LBC Wallet was not on the screen, then resumes.
5. ✅ On lbrypool.net, a worker named "phone" appears for your payout address.

### 4. Built-in node and solo mining (needs about 150 GB and 1 to 3 days)

1. **Node** page → choose a folder with enough space → **Start node**.
   * ✅ Within a few minutes there is at least one **peer**. The LBRY network has few public
     nodes right now, so 1 to 3 peers is normal.
   * ✅ Headers and blocks count up, with an estimated time left.
2. Leave it running until it shows **Your node is ready** (100 %).
   * ✅ The status in the corner says **your node**.
   * ✅ Balances and history are the same as before.
3. **Mining → Solo (full node)**:
   * ✅ It says *Using the built-in node — ready*.
   * ✅ **Start mining** shows "mining block N", where N is the current block height.

Finding a block solo with a CPU is extremely unlikely and could take many years. The test is
that mining runs against your own node without errors.

### 5. A small swap with Bitcoin (optional, about 1 to 2 hours)

You need a little Bitcoin (at least 20,000 sats plus the Bitcoin fee) in any Bitcoin wallet. You
also need two LBC Wallets: a second person, or your computer and your phone. Use the smallest
amounts: **10 LBC** is the minimum.

1. **Wallet A** (gives LBC): **Swap → Start a swap**. Choose *LBC, for Bitcoin*, enter 10 LBC
   and the BTC amount you agreed, and your Bitcoin address. Then **Create the invite**.
   * ✅ The Bitcoin network fee is shown before you create the invite.
2. Send the invite code to **wallet B** (gives Bitcoin): **Swap → Join with a code**, paste it,
   enter wallet B's Bitcoin address for a refund, and join.
   * ✅ Wallet B shows a Bitcoin address and the exact amount.
3. Pay exactly that amount from your Bitcoin wallet in a single payment.
   * ✅ Within a minute or two, wallet B notices the payment and shows a **lock code**.
4. Paste the lock code into wallet A.
   * ✅ Wallet A waits for 2 Bitcoin confirmations (about 20 minutes) and checks the payment
     with both explorers.
   * ✅ Then it asks for your password to lock the 10 LBC, and shows its own lock code.
5. Paste wallet A's lock code into wallet B.
   * ✅ After 12 LBC confirmations (about 30 minutes), wallet B collects the LBC by itself.
   * ✅ Wallet A then collects the Bitcoin to its Bitcoin address. Both show **Completed**.

Keep both wallets **open and unlocked** until both say Completed. If anything stops the swap,
each side gets its coins back automatically after its lock time (24 or 48 hours) while the
wallet is open.

### 6. The Market (optional, about 1 to 2 hours)

The same two wallets and a little Bitcoin as in step 5.

1. **Wallet A: Market**, read the warning, tick both boxes, open the board.
   * ✅ "Connected to … relays" shows at least 3 of 5, and the market price card shows MEXC's
     price in US dollars, sats and Monero.
2. **Wallet A: Post an offer** → *Sell LBC*, 20 LBC (or more), your price, your Bitcoin address.
   * ✅ The offer appears under *Your offers* with "On … relays", and on the board marked *Yours*.
3. **Wallet B: Market → Buy LBC**, find wallet A's offer, **Buy**, 10 LBC (or the offer's
   smallest part), wallet B's Bitcoin address for a refund.
   * ✅ Within seconds the trade becomes *Swapping* and shows a Bitcoin address, the exact
     amount and a deadline. Wallet A shows "Your offer was taken".
4. Pay exactly that amount from your Bitcoin wallet in a single payment, before the deadline.
   * ✅ No codes to copy: wallet A gets wallet B's lock code by itself and, after 2 Bitcoin
     confirmations, asks for its password to lock the LBC.
   * ✅ After 12 LBC confirmations wallet B collects the LBC, and wallet A collects the Bitcoin.
     Both trades show **Done**, and wallet A's offer shows the rest left.
5. Wallet A: **Take down** the offer. ✅ It disappears from wallet B's board.

### 7. Report

Please open an issue titled "Mainnet test: <your system>" with:

* system and version (Settings → About),
* which steps worked (✅) and which didn't, with the exact message or a screenshot (hide your
  addresses if you prefer),
* for mining: your hashrate and how many shares were accepted in 30 minutes.

Thank you. This is how the wallet gets safer for everyone.
