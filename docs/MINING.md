# Mining LBC with LBC Wallet

The wallet has a built-in CPU miner for LBRY Credits. You choose a pool (or your own node),
choose how many CPU threads to use and press **Start mining**. Rewards are paid to your
wallet's mining address.

## What to expect

LBC uses its own proof-of-work (the *LBRY* algorithm: SHA-256d → SHA-512 → two RIPEMD-160 →
SHA-256d over a 112-byte header). The network is secured mostly by GPUs and specialised
hardware, so **a CPU earns very little**:

* The built-in miner hashes about **1–2.5 MH/s per thread** on current desktop CPUs (1.2 MH/s per
  thread measured on a 2.1 GHz server core). A typical 8-core desktop reaches roughly 10–25 MH/s.
* The whole network runs at several **TH/s** (one million times more). In October 2026 it was
  about 17 TH/s, most of it on [LBRYPool](https://lbrypool.net). Live figures:
  [miningpoolstats.stream/lbry](https://miningpoolstats.stream/lbry).
* A block is found every 150 seconds (576 per day). The block reward was about 135 LBC in October
  2026 and drops by 1 LBC roughly every three weeks.

Your expected share is `your hashrate ÷ network hashrate × 576 blocks × block reward` per day.
For 20 MH/s against 17 TH/s that is about **0.09 LBC per day**, worth a fraction of a US cent
at current prices. The Mining page computes this from the live difficulty once you have mined
for a minute (estimates are shown on mainnet only).

So mine because you want to support the network, learn how mining works or use hardware that
would be idle anyway. Not to make a profit: on most electricity tariffs a CPU costs more to run
than it earns. The *only when idle* and *pause on battery* options help keep the cost down.

## Pool mining (recommended)

A pool combines many miners' work and pays each one a share of every block, so you see steady
small payouts instead of waiting years for a block of your own.

1. Open **Mining**, keep **Pool** selected and choose **LBRYPool** (the largest LBC pool,
   0.5 % fee, automatic payouts from 10 LBC at the time of writing), or choose *Custom pool…*
   and enter its Stratum address.
2. Choose the number of threads. Leaving one or two cores free keeps the computer responsive.
3. Press **Start mining**.

Details:

* **Pool address**: `stratum+tcp://host:port`, or `stratum+ssl://host:port` for TLS. The pool must
  support the LBRY algorithm (yiimp- and NOMP-based LBRY pools are supported, including their
  256× LBRY share-difficulty convention).
* **Login**: the wallet logs in as `<payout address>.<worker name>` with password `x` (both
  editable). LBRYPool needs no account: your address is your login.
* **Payout address**: by default the wallet's own mining address. You can enter any LBC
  address instead, for example to mine into a different wallet.
* **Pool balance**: for yiimp-compatible pools (LBRYPool) the page shows your unpaid balance and
  recent payouts from the pool's public API.
* Mining keeps running while the wallet is locked. It only needs your address, never your keys.

## Solo mining with your own node

Solo mining sends every block you find to your own `lbcd` node, and you keep the whole reward.
With a CPU, though, you should expect to wait many years for a block. It is mainly useful on test
networks or with much more hashrate.

1. Run [lbcd](https://github.com/lbryio/lbcd), fully synced and connected to peers, with RPC enabled, e.g.
   `lbcd --rpcuser=me --rpcpass=secret` (mainnet RPC port 9245, TLS with the certificate in
   lbcd's data folder).
2. In **Settings → Network → Full node**, enter the RPC URL, user, password and certificate path.
3. On the Mining page choose **Solo (own node)** and start mining.

The wallet requests work with `getblocktemplate`, builds its own coinbase (BIP34 height, your
payout address, witness commitment when needed), includes the node's mempool transactions,
and submits solved blocks with `submitblock`. This path is tested end-to-end against lbcd on
regtest.

## Power and comfort options

* **Low priority** (on by default): the mining threads run at the lowest OS priority, so the
  wallet and everything else you do stay responsive.
* **Pause on battery** (on by default): mining stops when a laptop is unplugged and resumes
  on AC power.
* **Only when idle**: mining starts after 1–30 minutes without keyboard or mouse input and pauses
  the moment you use the computer again, like the Monero GUI's background mining. (Idle
  detection uses the system idle timer. Some Linux Wayland desktops don't expose it, and then
  the miner keeps waiting.)

  ![Waiting for the computer to become idle](screenshots/mining-idle.png)
* Hashing runs in a separate process with one worker thread per selected thread. Quitting the
  app stops it cleanly.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| "Connecting to pool…" never finishes | The pool address and port, your firewall, and the SOCKS5 proxy settings if enabled (pools must be reachable through the proxy). |
| Many rejected shares | Usually stale shares after a new block. A few percent is normal. Persistent rejects mean the pool expects a different algorithm or login format. |
| Lower hashrate than expected | Other programs competing for CPU (low priority yields to them), power-saving modes, or fewer threads than cores. |
| Solo mining logs `getblocktemplate failed` | lbcd must be fully synced and connected to peers before it hands out block templates. Check the RPC URL, credentials and certificate in Settings → Network. |
| An antivirus warns about a "coin miner" | Some products flag any mining software. LBC Wallet only mines when you press *Start mining*. |

Rewards from blocks you mine solo, and coinbase payouts in general, can be spent after
**100 confirmations** (about four hours). The wallet shows them as *Maturing mining rewards*
until then.
