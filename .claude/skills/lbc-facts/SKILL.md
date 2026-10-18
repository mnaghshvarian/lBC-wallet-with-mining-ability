---
name: lbc-facts
description: Gather current, verifiable facts about LBC for docs and community posts — supply left to mine and reward schedule, block height, hub server status, LBRYPool hashrate share, market price and volume (MEXC, CoinPaprika), and the regulatory status (SEC Release No. 33-11412). Use when writing release notes, the manual, Telegram/community updates or answering "how much LBC is left / where does LBC trade / is LBC a security".
---

# Current LBC facts

State the date and the source of every number; never reuse an old number as current.

## Supply and rewards

The wallet computes them from the chain's own reward rule: `supplyFacts(height)` in
`packages/core/src/mining/economics.ts` (also on the Mining page). With the current height:

```bash
npx tsx -e "import {supplyFacts} from './packages/core/src/mining/economics.ts'; console.log(supplyFacts(HEIGHT))"
```

Maximum supply 1,083,202,000 LBC (400 million of it created in the genesis block). The schedule
is `blockSubsidy` in the same file: the reward shrinks by 1 LBC at slowly growing intervals, and
the last reward is at block 4,063,000 (around 2035). Read the code rather than restating the
rule from memory.

## Height and servers

* Height: any default hub (`server.version`, `blockchain.headers.subscribe`) or a block explorer.
* Hub status: `npx vitest run --dir packages/core/mainnet` (each default hub: chain, tip, proofs),
  or Settings → Network → Test. Default list: `packages/core/src/networks.ts`.

## Market data

* MEXC (the market with the most LBC volume):
  `https://api.mexc.com/api/v3/ticker/24hr?symbol=LBCUSDT` (lastPrice, volume, quoteVolume;
  `priceChangePercent` is a fraction). Bitcoin and Monero: `BTCUSDT`, `XMRUSDT`.
* CoinPaprika: `https://api.coinpaprika.com/v1/tickers/lbc-lbry-credits?quotes=USD,BTC`.
* CoinGecko's LBC price has been far off (October 2026: about a third of MEXC's); do not use it.
* Crypto.com does not list LBC (checked October 2026).

## Mining

LBRYPool statistics (pool hashrate, blocks found in 24 h) compared with the network's ~576
blocks per day (one block every 2.5 minutes) give the pool's share. In October 2026 it found
about 93 % of blocks.

## Regulation (United States)

* SEC v. LBRY Inc. (D.N.H.): final judgment July 2023 (penalty $111,614; no position on
  secondary-market sales); appeal 23-1743 (1st Cir.) dismissed by stipulation, October 2023.
* SEC Crypto Task Force meeting with members of the LBRY token community, 21 July 2025.
* **SEC Release No. 33-11412, 17 March 2026** (joined by the CFTC), *Application of the Federal
  Securities Laws to Certain Types of Crypto Assets and Certain Transactions Involving Crypto
  Assets* (91 FR 13714): names "Algorand (ALGO) and LBRY Credits (LBC)" as digital commodities
  "based on their characteristics, terms, and functions as of the date of this release"; PoW
  mining as described is not a securities offering.
  Source: https://www.sec.gov/files/rules/interp/2026/33-11412.pdf

Re-check regulatory statements before repeating them; they are not legal advice, and other
countries have their own rules. The longer reasoning is in `docs/LBC-FUTURE.md`.

## Writing for the community

Community posts in `docs/announcement/`. The Telegram group prefers posts **without links or web
addresses** (bare domains such as "example.com" become links in Telegram): name places instead
("GitHub, repository mnaghshvarian / lBC-wallet-with-mining-ability, Releases page"). Keep a
short post under Telegram's 4,096-character limit.
