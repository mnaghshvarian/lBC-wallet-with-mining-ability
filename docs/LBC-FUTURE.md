# Fork, rename, privacy or RandomX? Questions about LBC's future

*October 2026. Written for the LBC community by the LBC Wallet project. This is not legal or
financial advice; it is our reading of public facts, with the sources at the end.*

People in the LBC community regularly ask whether LBC should be **forked or upgraded** (for
example with privacy features, or with Monero's RandomX mining), **bridged** to a new coin, or
**renamed** (as Polygon renamed MATIC to POL, or as Telegram's Gram became Toncoin) to leave the
SEC case behind and get listed on more exchanges.

**Short answer: no fork and no rename. The regulatory picture has changed in LBC's favour, and a
new coin would throw that away.**

## 1. The SEC question is largely answered — for LBC itself

* **2021–2023, SEC v. LBRY Inc.** The court found that LBRY Inc.'s own sales of LBC were
  unregistered securities offerings. The final judgment (July 2023) ordered a civil penalty of
  $111,614 instead of the $22 million the SEC had asked for, and the judge stated that he took
  *no position on whether the registration requirement applies to secondary market offerings of
  LBC*. The appeal was dismissed by agreement in October 2023, and LBRY Inc. wound down.
* **July 21, 2025.** Members of the LBRY token community met the SEC's Crypto Task Force and asked
  for clarity for people who bought LBC on the open market.
* **March 17, 2026.** The SEC, joined by the CFTC, published an interpretation of how securities
  laws apply to crypto assets (Release No. 33-11412). It sorts crypto assets into categories, and
  treats *digital commodities* — assets whose value comes from the working of a functional crypto
  network and from supply and demand, not from someone's managerial efforts — as not securities.
  It names **"Algorand (ALGO) and LBRY Credits (LBC)"** as examples: "based on their
  characteristics, terms, and functions as of the date of this release, … are digital
  commodities". The same release says that mining on proof-of-work networks, as it describes it,
  does not involve the offer and sale of a security.

What this means:

* The main reason exchanges gave for avoiding LBC — that it might be a security in the United
  States — is now answered by the SEC itself, **for LBC as it is today**.
* A **renamed or forked coin would be a new asset.** It would not be named in that release, and
  whoever launched it (and any sale or airdrop that came with it) would raise exactly the kind of
  questions LBC has just left behind.
* Other countries have their own rules (for example the EU's MiCA). An exchange still decides for
  itself what it lists, based on volume, demand, costs and its own legal advice.

**What the community can do:** when asking an exchange to list LBC, cite SEC Release No.
33-11412 of 17 March 2026, which names LBRY Credits (LBC) as a digital commodity.

## 2. Renaming: what MATIC → POL and Gram → Toncoin really were

* **MATIC → POL (September 2024)** was a technical upgrade by the Polygon team (Polygon 2.0): a
  new token with new functions and a migration contract run by the company, which exchanges
  supported. It was not a way to escape a regulator.
* **Telegram's Gram** never launched as planned: in June 2020 Telegram settled with the SEC,
  returned $1.2 billion to investors and paid an $18.5 million penalty, and abandoned the project.
  Independent developers continued the open-source network, which later became **Toncoin**.
  The name changed because the original company left, not because a rename removes legal
  history.

A rename does not change what a coin is, how it was sold or who holds it. Exchanges and
regulators look at substance, not names.

## 3. Adding privacy (Monero-style)

Privacy coins are being **removed** from exchanges, not added: OKX delisted several in January
2024, Binance delisted Monero in February 2024, Kraken removed it for customers in the European
Economic Area in 2024, and from July 2027 the EU's anti-money-laundering regulation forbids
regulated crypto services from handling "anonymity-enhancing" coins. Adding privacy to LBC would
make listings **harder**, the opposite of the goal. (Users who want privacy can already run their
own node and connect through Tor in LBC Wallet.)

## 4. Switching mining to RandomX

RandomX is Monero's mining algorithm, designed for ordinary processors (CPUs). It sounds
attractive — more people could mine LBC on their computers — but:

* It needs a **hard fork**: every node, pool, hub, exchange and wallet must upgrade at the same
  time, or the chain splits into two coins.
* A small coin on the same algorithm as a big one is **cheap to attack**: anyone can rent or
  redirect Monero mining power. In August 2025 the Qubic project gathered a majority of Monero's
  own hashrate and caused a reorganisation of about six blocks. LBC, with a tiny fraction of
  Monero's value, would be far easier to take over.
* Today almost all LBC hashrate is on one pool (LBRYPool, about 15.7 TH/s, finding about 93 % of
  blocks in our check of 18 October 2026). A change of algorithm only makes sense with that pool,
  the hub operators and the remaining exchanges on board.

LBC Wallet already lets anyone mine LBC on a computer or phone with the current algorithm.

## 5. Bridging to a new coin

A bridge needs someone (or a smart contract) to hold the original coins while the new ones
circulate. LBC has no smart contracts, so it would be a custodian — and bridges are the most
frequently hacked part of crypto. It would also create the new-asset problem of section 1.

## 6. A decentralized mining pool — no fork needed

A pool where miners share rewards **without** a pool operator holding them (like P2Pool for
Bitcoin and Monero) can be built for LBC's current proof of work: the miners keep a side chain of
shares, and each block's reward pays them directly. It needs no change to LBC itself. It is on
LBC Wallet's [roadmap](ROADMAP.md).

## 7. What helps LBC now

1. **Listings:** ask exchanges, citing SEC Release No. 33-11412.
2. **Decentralized trading:** use and test the **Market** in LBC Wallet (LBC ↔ Bitcoin offers,
   settled by atomic swaps, no exchange in between); LBC is also in the Komodo DEX coin list.
3. **Infrastructure:** run a public LBRY hub or a full node; more independent servers make every
   light wallet safer.
4. **Mining:** more independent miners and pools spread the hashrate.
5. **Use:** publish and tip on LBRY/Odysee — LBC's value comes from the network being used.

## Sources

* SEC, *Application of the Federal Securities Laws to Certain Types of Crypto Assets and Certain
  Transactions Involving Crypto Assets*, Release No. 33-11412, 17 March 2026 (91 FR 13714):
  <https://www.sec.gov/files/rules/interp/2026/33-11412.pdf>
* Chapman and Cutler, *SEC and CFTC Issue Landmark Interpretation on Crypto Assets*, 18 March
  2026: <https://www.chapman.com/publication-sec-and-cftc-clarify-crypto-asset-taxonomy-and-the-application-of-federal-securities-laws>
* SEC Crypto Task Force, *Meeting with Members of the LBRY Token Community*, 21 July 2025:
  <https://www.sec.gov/files/ctf-memo-adam-tomas-brad-tonkin-072125.pdf>
* SEC v. LBRY, Inc., U.S. District Court for the District of New Hampshire (final judgment July
  2023); appeal No. 23-1743 (1st Cir.), dismissed by stipulation in October 2023.
* SEC press release 2020-146, *Telegram to Return $1.2 Billion to Investors and Pay $18.5 Million
  Penalty* (June 26, 2020).
* Polygon, MATIC to POL migration (September 4, 2024).
* Exchange notices on privacy coins: OKX (January 2024), Binance (February 2024), Kraken (EEA,
  2024); EU Regulation (EU) 2024/1624 (AMLR), Article 79.
* LBRYPool statistics (pool hashrate and blocks found), read 18 October 2026.
