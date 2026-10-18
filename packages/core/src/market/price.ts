/**
 * Prices on the order board, shared by the services and the user interface
 * (no keys or network code here). An offer's price is the ratio of its two
 * amounts, so every part of it is priced exactly the same way.
 */
import type { SwapCoin } from '../swap/protocol.js';

/**
 * The Bitcoin for `lbc` dewies of an offer, at the offer's price, rounded in
 * the maker's favour (the maker set the price).
 */
export function btcForLbc(offer: { lbc: bigint; btc: bigint; give: SwapCoin }, lbc: bigint): bigint {
  const product = lbc * offer.btc;
  if (offer.give === 'BTC') return product / offer.lbc;
  return (product + offer.lbc - 1n) / offer.lbc;
}

/** Satoshis per LBC (for display and sorting; not used for amounts). */
export function satsPerLbc(offer: { lbc: bigint; btc: bigint }): number {
  return (Number(offer.btc) / Number(offer.lbc)) * 1e8;
}
