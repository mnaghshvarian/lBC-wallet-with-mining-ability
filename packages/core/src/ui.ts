/**
 * Lightweight, key-free helpers for user interfaces (formatting and network
 * constants). UIs import this entry instead of the full core so no wallet or
 * key-handling code is bundled into the renderer.
 */
export { formatLbc, parseLbc, lbcNumberToDewies, dewiesToNumber } from './util/amount.js';
export { formatHashrate } from './mining/economics.js';
export { MAINNET, TESTNET, REGTEST, NETWORKS, DEWIES_PER_LBC, DEFAULT_FEE_PER_BYTE, type NetworkName, type NetworkParams, type HubServer } from './networks.js';
