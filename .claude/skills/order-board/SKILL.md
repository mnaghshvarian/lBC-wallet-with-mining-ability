---
name: order-board
description: Work on LBC Wallet's Market (the Nostr order board for LBC ↔ Bitcoin settled by atomic swaps) — protocol, relay pool, WebSocket client, market service, timings, the test relay, and safe read-only checks against public relays. Use when changing or debugging offers, takes, trade messages, relays, prices or the Market page.
---

# The Market (order board)

## Where things are

| Part | File |
| --- | --- |
| WebSocket client (RFC 6455 over the app's own sockets) | `packages/core/src/net/websocket.ts` |
| Nostr events, signatures, proof of work (NIP-01, NIP-13) | `packages/core/src/nostr/event.ts` |
| NIP-44 v2 encryption (official vectors in `test/vectors/`) | `packages/core/src/nostr/nip44.ts` |
| Relay pool (publish to all, verify everything received) | `packages/core/src/nostr/relays.ts` |
| Offer and message formats, filters | `packages/core/src/market/protocol.ts` |
| Prices (shared with the UI) | `packages/core/src/market/price.ts` |
| Service: publishing, answering takes, passing lock codes | `packages/services/src/market-service.ts` |
| Reference price (MEXC, CoinPaprika) | `packages/services/src/market-price.ts` |
| Page | `packages/ui/src/pages/Market.tsx` (reuses `SwapDetail` from `Swap.tsx` in automatic mode) |
| Android raw sockets | `apps/mobile/src/sockets.ts` (`byteTransport`) + `LbcNativePlugin.java` (`raw: true`) |
| Test relay | `packages/core/e2e/nostr-relay.ts` (also in `dev-regtest.ts`, port 7447) |

## Protocol in one screen

* Offers: kind 30078 (NIP-78), `d` = `lbc-wallet:offer:<16 hex>`, `t` = `lbc-wallet-offer` and
  `lbc-wallet-offer:<network>`, `expiration` (NIP-40) one hour, renewed every 20 minutes, 12 bits
  of proof of work. Content `{v:1, network, give, lbc, btc, min, left, status}` (dewies/sats as
  decimal strings). Price = btc/lbc of the whole offer; a part's Bitcoin is rounded in the maker's
  favour.
* Messages: kind 30078, `d` = `lbc-wallet:msg:<trade>`, `t` = `lbc-wallet-msg`, `p` = recipient,
  expiration 3 days, NIP-44 encrypted `{v:1, type, trade, …}`: take (16 bits of proof of work),
  invite | decline, lock, lock. Each offer has its own key; each take another.
* Roles: maker = swap starter (locks second, within 12 h); taker = joiner (locks first, for 48 h).
* Timings (`MARKET_TIMING`): answer within 10 min; taker locks within 20 min (swap `lockBy`);
  maker gives up after 40 min; takes older than 10 min are ignored.
* Changing the wire format is a protocol change: bump `v`, keep reading the old one for a while,
  and update the tests and docs/ARCHITECTURE.md ("Market").

## Tests

```bash
npx vitest run packages/core/test/nostr.test.ts packages/core/test/market.test.ts packages/core/test/relays.test.ts
LBCD_BIN=… BTCD_BIN=… npx vitest run packages/services/e2e/market.e2e.test.ts   # (in packages/services)
```

The e2e test runs a whole trade (post → take → invite → both locks → both collect) and the
failure paths on lbcd + btcd through the test relay, with timings shortened.

## Talking to public relays

Default relays: `DEFAULT_RELAYS` in `packages/services/src/api.ts`. During development only READ
from public relays (REQ/EOSE) — never publish test offers to them; use the local test relay.
A read-only check through a sandbox HTTPS proxy needs a CONNECT tunnel transport for
`createWebSocket` (the app itself connects directly or through SOCKS5).

## Safety rules for changes

* Every incoming event must pass `verifyEvent` and match the subscription's filters (the pool
  does this); never trust relay-provided data beyond that.
* The taker joins only an invite with exactly the amounts it took; all coin movements stay in
  the swap engine, which checks the contracts on chain.
* Posting and taking require the Market warning accepted (`MARKET_TERMS_VERSION`); bump it when
  the warning's substance changes.
