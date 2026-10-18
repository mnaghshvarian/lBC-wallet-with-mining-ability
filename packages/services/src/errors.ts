import { WrongPasswordError } from '@lbcwallet/core';

/**
 * English texts of every error a user can see. The UI translates by `code`
 * (`error.<code>` in its dictionaries) and falls back to these messages.
 */
export const ERROR_MESSAGES = {
  invalidWalletId: 'Invalid wallet id',
  walletNotFound: 'Wallet file not found',
  passwordTooShort: 'Use a password of at least 8 characters',
  wrongNetwork: 'This wallet belongs to a different network',
  noWalletOpen: 'No wallet is open',
  incorrectPassword: 'Incorrect password',
  watchOnlyCannotSend: 'This is a watch-only wallet. Import the recovery phrase to send.',
  watchOnly: 'This is a watch-only wallet.',
  invalidAddress: 'Invalid address ({detail})',
  amountNotPositive: 'Enter an amount greater than zero',
  invalidAmount: 'Invalid amount',
  insufficientFunds: 'Insufficient funds: you need {needed} LBC including the fee, but only {available} LBC is spendable.',
  draftExpired: 'This transaction is no longer valid; please review it again.',
  networkRejected: 'The network rejected the transaction: {detail}',
  sendFailed: 'Sending failed: {detail}',
  nothingToUnlock: 'There are no confirmed tips or supports to unlock.',
  enterName: 'Enter a name',
  fundsCheckUnreachable: 'Could not reach the LBRY network to check for funds',
  noHubs: 'No hub servers configured. Add one in Settings → Network.',
  nodeCertUnreadable: 'Cannot read the node certificate: {detail}',
  nodeUnsupported: 'Connecting to your own node is not available on this device.',
  nodeNotConfigured: 'Configure your node in Settings → Network first.',
  nodeWrongChain: 'The node is on {chain}, expected {expected}.',
  nodeNeedsIndexes: 'lbcd must be started with --txindex --addrindex',
  fieldNotText: '{field} must be text',
  fieldTooLong: '{field} is too long',
  fieldNotNumber: '{field} must be a number',
  invalidSettings: 'Invalid settings',
  missingSource: 'Missing wallet source',
  unknownWalletType: 'Unknown wallet type',
  onlyHttps: 'Only https links can be opened',
  connectionRefused: 'Connection refused — is the server running?',
  serverNotFound: 'Server not found — check the address and your internet connection',
  serverTimeout: 'The server did not respond in time',
  untrustedSender: 'Untrusted sender',
  minerNeedsWallet: 'Open a wallet (or set a payout address in mining settings) before you start mining.',
  payoutInvalid: 'The payout address is invalid ({detail})',
  soloNeedsNode: 'Solo mining needs a full node: turn on the built-in node (Node page) or configure your own in Settings → Network.',
  soloNodeSyncing: 'Your node is still syncing ({progress}%). Solo mining starts once it has the whole chain.',
  poolUrlInvalid: 'The pool address must look like stratum+tcp://host:port',
  poolPortInvalid: 'Invalid pool port',
  miningUnsupported: 'Mining is not available on this device.',
  soloUnsupported: 'Solo mining needs a full node, which this device does not run. Choose pool mining.',
  minerEngineFailed: 'The miner could not start on this device ({detail}). Updating "Android System WebView" from the Play Store may help.',
  minerCrashed: 'The miner stopped unexpectedly. See the log below for details.',
  nodeBinaryMissing: 'The built-in node is not included in this build.',
  nodeDirNotWritable: 'The folder {path} cannot be written to.',
  nodeLowDisk: 'Not enough free space in {path}: the node needs about {needed} GB, {free} GB is free.',
  nodeStartFailed: 'The node could not start: {detail}',
  nodeAlreadyRunning: 'Another program is already using this node folder.',
  exportUnsupported: 'Exporting files is not available on this device.',
  swapUnsupported: 'Swaps are not available on this device.',
  swapCodeInvalid: '{detail}',
  swapWrongNetwork: 'This swap is on {network}. Switch the network in Settings first.',
  swapUnknown: 'This wallet has no swap with that code. Open the wallet you started or joined the swap with.',
  swapWrongCode: 'This is not the code this swap needs now.',
  swapOwnCode: 'This is your own code: send it to the other person.',
  swapAlreadyJoined: 'You have already joined this swap.',
  swapAlreadyHaveLock: 'This swap already has a lock code from the other person.',
  swapContractMismatch: 'The other side\'s contract does not pay this wallet. Check that you both used the codes of this swap.',
  swapAmountTooSmall: 'Swaps start at {lbc} LBC and {btc} BTC: smaller amounts would mostly go to network fees.',
  swapAmountTooLarge: 'While swaps are new, they are limited to {btc} BTC.',
  swapBtcAddressInvalid: 'Invalid Bitcoin address ({detail})',
  swapNotReady: 'This swap cannot do that now.',
  swapTooLate: 'Too late to lock: the other side\'s coins are locked for less than {hours} more hours. Start a new swap.',
  swapNoExplorer: 'Set a Bitcoin explorer (Esplora) server for swaps in Settings first.',
  swapCannotCancel: 'Your coins are already locked; they come back automatically after the lock time if the swap does not finish.',
  swapStillActive: 'This swap is still running.',
  marketUnsupported: 'The order board is not available on this device.',
  marketTermsNotAccepted: 'Read and accept the order board warning first (Market page).',
  marketOfferGone: 'This offer is no longer on the board.',
  marketOwnOffer: 'This is your own offer.',
  marketOutOfRange: 'Choose between {min} and {max} LBC for this offer.',
  marketNotEnoughLbc: 'This needs {needed} LBC, but {available} LBC is spendable.',
  marketMinTooSmall: 'The smallest part must be worth at least {btc} BTC (about {lbc} LBC at your price), or the network fees would eat it.',
  marketLockExpired: 'The time to lock for this trade has passed; nothing was locked. Take the offer again if it is still there.',
  marketNoRelay: 'No relay could be reached. Check your internet connection, or the relay list in Settings → Network.',
  marketTooMany: 'You already have {count} open offers. Take one down first.',
  marketUnknownTrade: 'This wallet has no such trade.',
  marketTradeRunning: 'This trade is still running.',
  operationFailed: '{detail}',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export type ErrorParams = Record<string, string | number>;

export function formatMessage(template: string, params: ErrorParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** An error whose message is safe to show to users; `code` lets the UI translate it. */
export class UserError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
  ) {
    super(formatMessage(ERROR_MESSAGES[code], params));
    this.name = 'UserError';
  }
}

export interface ErrorInfo {
  message: string;
  code?: ErrorCode;
  params?: ErrorParams;
}

/** Turns any error into something safe and useful to show to users. */
export function describeError(err: unknown): ErrorInfo {
  if (err instanceof UserError) return { message: err.message, code: err.code, params: err.params };
  if (err instanceof WrongPasswordError) return info('incorrectPassword');
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/.test(msg)) return info('connectionRefused');
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return info('serverNotFound');
  if (/timed? ?out/i.test(msg)) return info('serverTimeout');
  return { message: msg };
}

function info(code: ErrorCode, params: ErrorParams = {}): ErrorInfo {
  return { message: formatMessage(ERROR_MESSAGES[code], params), code, params };
}
