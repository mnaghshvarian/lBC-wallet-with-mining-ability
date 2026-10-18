# LBC community update — October 2026

*For the LBRY / LBC Telegram group. Plain text with no links or web addresses, as requested:
every place is named so you can search for it. The first part is a short post (under Telegram's 4,096-character
limit); the second part is the full update.*

---

## Short post (copy between the lines)

---

📣 LBC community update — October 2026

1️⃣ Big news most of us missed: on 17 March 2026 the US SEC, joined by the CFTC, published an official interpretation of how securities law applies to crypto (SEC Release No. 33-11412). It names LBRY Credits (LBC), together with Algorand, as a "digital commodity" — not a security — "based on their characteristics, terms, and functions as of the date of this release". It also says proof-of-work mining is not a securities activity.
👉 This is the answer to exchanges that avoided LBC because of the old SEC v. LBRY case. When you ask an exchange to list LBC, cite "SEC Release No. 33-11412, 17 March 2026". (Not legal advice; other countries have their own rules.)

2️⃣ So: no fork, no rename, no privacy coin, no RandomX switch. A renamed or forked coin would be a NEW asset and lose exactly this recognition. Privacy coins are being delisted, and a small coin on Monero's algorithm would be cheap to attack.

3️⃣ LBC Wallet 1.3 (free, open source, non-custodial) — Windows, Mac, Linux, Android:
💰 keep, send, receive LBC; restore LBRY Desktop / Odysee phrases
⛏️ mine on your computer or phone (pool or solo)
🖥️ built-in full node (official lbcd) — but you do NOT need to download the blockchain: without a node the wallet uses public LBRY servers and checks everything against proof of work. (The chain is about 100 GB, not 2 TB.)
🔄 atomic swaps LBC ↔ Bitcoin
🆕 MARKET: an order board inside the wallet. See offers to buy or sell LBC for Bitcoin, priced against MEXC; take one or post your own. No exchange, no account, no fee: a taken offer settles as an atomic swap between the two wallets. Paying with USDT or Monero: change them to Bitcoin first (e.g. Trust Wallet, Cake Wallet).
🌍 15 languages, now with Hindi

Get it only from GitHub: repository "mnaghshvarian / lBC-wallet-with-mining-ability", Releases page. Check the SHA-256 checksums. The beginner's manual is in the same repository (docs → manual).

⚠️ Experimental and NOT audited — use at your own risk, start small, write your recovery phrase on paper. Nobody from the project will ever ask for it.

🙏 How you can help now: post offers on the Market (both buy and sell) so there is liquidity · ask exchanges to list LBC citing Release 33-11412 · run a public LBRY hub or a node · mine independently · test, translate, review the code.

---

## Full update

### 1. LBC is a "digital commodity" in the SEC's own words

* **2021–2023 — SEC v. LBRY Inc.** The court found that LBRY Inc.'s own sales of LBC were
  unregistered securities offerings, ordered a penalty of about 111,000 US dollars (instead of the
  22 million the SEC had asked for), and took *no position* on secondary-market sales of LBC. The
  appeal was dismissed in October 2023 and LBRY Inc. wound down. Exchanges delisted LBC.
* **21 July 2025.** Members of the LBRY token community met the SEC's Crypto Task Force and asked
  for clarity for everyone who bought LBC on the open market (published in the Task Force's
  meeting log: "Meeting with Members of the LBRY Token Community").
* **17 March 2026.** The SEC, joined by the CFTC, published *"Application of the Federal Securities
  Laws to Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets"*
  (Release No. 33-11412). It defines categories of crypto assets and treats *digital
  commodities* — assets whose value comes from the working of a functional crypto network and
  supply and demand, not from someone's managerial efforts — as not securities. It names
  **Algorand (ALGO) and LBRY Credits (LBC)** as examples. It also says mining on proof-of-work
  networks, as it describes it, is not an offer or sale of securities.

**What to do with it:** when you contact an exchange (listing forms, support tickets, social
media), cite "SEC Release No. 33-11412 of 17 March 2026, which names LBRY Credits (LBC) as a
digital commodity". Exchanges still decide for themselves, mostly on volume and demand — which is
why trading activity matters (section 4). This is our reading of public documents, not legal
advice; rules differ in other countries (for example the EU's MiCA).

### 2. Fork, rename, privacy, RandomX, bridge? Our answers

* **Rename (like MATIC → POL, or Gram → Toncoin):** no. MATIC → POL was a technical upgrade run by
  the Polygon company; Gram was abandoned by Telegram after its SEC settlement (1.2 billion US
  dollars returned to investors) and continued by others under a new name. A rename does not
  change what a coin is — and a new coin would lose LBC's explicit status in Release 33-11412.
* **Adding privacy (Monero-style):** no. Exchanges are removing privacy coins (OKX in January 2024,
  Binance in February 2024, Kraken in the European Economic Area in 2024), and from July 2027 the
  EU's anti-money-laundering rules forbid regulated crypto services from handling them.
* **Switching mining to Monero's RandomX:** not now. It needs a hard fork with every pool, server,
  wallet and exchange on board, and a small coin on Monero's algorithm can be taken over with
  rented Monero hashrate (in August 2025 one project gathered a majority of Monero's own hashrate
  and rewrote about six blocks).
* **Bridging LBC to a new coin:** no. LBC has no smart contracts, so a bridge would be a custodian
  — and bridges are among the most hacked things in crypto.
* **A decentralized mining pool:** yes, and it needs no fork. A P2Pool-style pool pays every miner
  straight from the block reward, with no operator holding coins. It is next on LBC Wallet's
  roadmap.

The full reasoning, with sources, is in the LBC Wallet repository: document "LBC-FUTURE" in the
docs folder.

### 3. What LBC Wallet does today (version 1.3)

* **Wallet** for Windows, macOS, Linux (also ARM64) and Android — non-custodial: keys are created
  and kept only on your device, encrypted with your password. Restores LBRY Desktop and Odysee
  recovery phrases and any BIP39 phrase. Shows and unlocks tips and supports.
* **Every payment checked** against the blocks' proof of work (SPV). No telemetry. Optional Tor.
* **Mining** through a pool (LBRYPool preset) or solo with your own node; also on Android phones
  while charging. Shows how much LBC is left to mine.
* **Built-in full node** (LBRY's official lbcd, unmodified), with a choice of where the blockchain
  is stored. Optional: the wallet works without it.
* **Atomic swaps LBC ↔ Bitcoin** with someone you know, by exchanging short codes.
* **NEW — the Market**: an order board for LBC ↔ Bitcoin inside the wallet (details in section 4).
* **15 languages**: English, Persian, Arabic, Urdu, Hindi, French, German, Spanish, Portuguese,
  Dutch, Russian, Chinese, Japanese, Korean, Thai.
* **Manual** for beginners with pictures and a PDF, and quick-start guides in all 15 languages.
* **Tested** on every change: unit tests, a private LBC and Bitcoin test network, whole trades
  through a test relay, the real desktop app driven by a robot, the installed Windows and macOS
  apps, the Android app in an emulator, and weekly checks on the real LBC network.

**Where:** GitHub, repository *mnaghshvarian / lBC-wallet-with-mining-ability*, Releases page.
Download only there and check the SHA-256 checksums published with each release.

### 4. The Market — how it works

* Open **Market** in the wallet (on a phone: More → Market) and read its warning.
* **Buy LBC** lists people selling LBC; **Sell LBC** lists people buying it. Prices are in sats
  per LBC, with the difference to the exchange price (MEXC's LBC/USDT market) and a converter to
  US dollars, Bitcoin and Monero.
* **Take an offer:** choose the amount and your Bitcoin address. The other wallet answers within
  seconds; you lock first (Bitcoin from any Bitcoin wallet, or LBC with your password), the other
  side locks second, and both wallets collect by themselves. Either both get paid or both get
  their coins back.
* **Post an offer:** your amount, your price and the smallest part people can take. It stays on
  the board while your wallet is open. When it is taken you are asked to lock your part (within
  12 hours).
* **No exchange:** nobody holds coins, no accounts, no fees. Offers and encrypted messages travel
  through public Nostr relays; each offer and trade uses a new key.
* **USDT or Monero:** change them to Bitcoin first — for example with the built-in exchange of
  Trust Wallet or Cake Wallet — then trade the Bitcoin on the Market. Selling works the other way
  round. The manual has step-by-step examples ("Paying with USDT, Monero or other coins").
* **Why not deposits of USDT, BTC or XMR held for you?** Holding other people's coins makes you a
  custodian: licences, identity checks, audits, and one place that can be hacked or frozen. LBC
  Wallet is built so that nobody ever holds your coins.

### 5. LBC facts (18 October 2026)

* About **963.4 million LBC** issued, about **119.8 million** left to mine (of 1,083,202,000).
* Block reward **135 LBC**, dropping to 134 at block 2,204,153 (in about 10 days); it drops by one
  LBC about every 20 days, and the last reward comes around **2035**.
* **LBRYPool** has about 15.7 TH/s and finds about 93 % of blocks — the network depends heavily on
  one pool. More independent miners and pools make LBC safer.
* **MEXC** LBC/USDT trades around 0.0016 US dollars per LBC (about 2 sats), with only a few hundred
  dollars of volume per day.
* **Public LBRY servers** the wallet uses: the four hubs run by Odysee (a-hub1, b-hub1, c-hub1
  and s-hub1) and three community-run hubs; the wallet tests them and skips any that are down or
  behind. The LBRY Foundation publishes the hub software but, as far as we found, runs no public
  server of its own.
* **The blockchain is about 100 GB** (about 150 GB with indexes), not 2 TB, and you don't need it to
  use the wallet.

### 6. What you can do now

1. **Make the Market useful:** post small offers on both sides, at fair prices, and keep the
   wallet open. Liquidity is what brings exchanges back.
2. **Ask exchanges to list LBC**, citing SEC Release No. 33-11412.
3. **Run a public LBRY hub** (the LBRY Foundation's hub software) and tell the LBC Wallet project,
   so it can be added to the default list. More servers = more resilient light wallets.
4. **Run a full node** with incoming connections (Node page → Start node).
5. **Mine independently** or on smaller pools; help test the decentralized pool when it comes.
6. **Test LBC Wallet** with small amounts, report bugs (GitHub → Issues), translate, and review
   the code — an independent security audit is still needed.
7. **Keep using LBRY / Odysee** and tip creators: LBC's value comes from the network being used.

### 7. Stay safe

* LBC Wallet is experimental and **not audited**. You use it at your own risk; the authors are not
  responsible for any loss. Start with small amounts.
* Write your recovery phrase on paper. **Nobody from the project will ever ask for it** — anyone
  who does, including in private messages, is a scammer.
* Download only from the official GitHub Releases page named above.
* On the Market, the people on the board are strangers: compare prices, start small, and pay
  Bitcoin only to the contract address your own LBC Wallet shows.
* Nothing here is financial or legal advice. Follow the laws and tax rules where you live.
