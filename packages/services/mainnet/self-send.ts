/**
 * A real payment on the LBC network: restores a small, dedicated test wallet
 * from MAINNET_TEST_PHRASE, sends 0.01 LBC from it to its own next address
 * through the public hubs, and waits until the payment is confirmed and
 * checked against proof-of-work headers (SPV). Costs only the network fee
 * (about 0.0002 LBC).
 *
 *   MAINNET_TEST_PHRASE="word1 … word12" npx tsx packages/services/mainnet/self-send.ts
 *
 * Use a wallet that holds only a few LBC: the phrase is a GitHub secret on CI.
 */
import { randomBytes, toHex, formatLbc } from '@lbcwallet/core';
import { nodeLineTransport } from '@lbcwallet/core/node';
import { SettingsStore, WalletService, memoryFiles, type Platform, type WalletOverview } from '../src/index';

const AMOUNT = 1_000_000n; // 0.01 LBC

async function waitFor<T>(label: string, timeoutMs: number, check: () => T | null | undefined | false): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    if (Date.now() - lastLog > 60_000) {
      console.log(`waiting for ${label}…`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

async function main(): Promise<void> {
  const phrase = (process.env.MAINNET_TEST_PHRASE ?? '').trim();
  if (!phrase) throw new Error('set MAINNET_TEST_PHRASE to the recovery phrase of a small test wallet');
  const files = memoryFiles();
  const platform: Platform = {
    kind: 'desktop',
    clientName: 'LBC Wallet mainnet test',
    files,
    log: (level, scope, message) => {
      if (level !== 'info') console.log(`${level} [${scope}] ${message}`);
    },
    lineTransport: (endpoint, options) => nodeLineTransport(endpoint, options),
    fetchJson: async () => null,
    cpuCount: 2,
  };
  const settings = new SettingsStore(files, 2);
  settings.update({ network: 'mainnet', showFiat: false, requirePasswordToSend: true });
  const wallets = new WalletService(platform, settings, { changed: () => undefined, locked: () => undefined, network: () => undefined, notice: () => undefined });
  const password = toHex(randomBytes(16));
  try {
    // LBRY Desktop / Odysee and standard BIP39 wallets derive differently: use the one with history.
    const scans = await wallets.scan(phrase);
    const used = scans.filter((s) => s.usedAddresses > 0);
    const scheme = (used.find((s) => s.scheme === 'bip44') ?? used[0] ?? scans[0])!.scheme;
    console.log(`restoring the test wallet (${scheme}, ${used.map((s) => `${s.scheme}: ${s.usedAddresses} used addresses`).join(', ') || 'no history found'})`);
    await wallets.create({ name: 'Mainnet test', password, source: { type: 'mnemonic', mnemonic: phrase, scheme } });
    const synced = await waitFor('the wallet to sync', 180_000, () => {
      const o = wallets.overview();
      return o && o.sync.state === 'synced' ? o : null;
    });
    const before = BigInt(synced.balance.available);
    const totalBefore = BigInt(synced.balance.total);
    console.log(`synced with ${synced.backend.server} at block ${synced.tipHeight}: ${formatLbc(before)} LBC available`);
    if (before < AMOUNT + 100_000n) throw new Error(`the test wallet needs at least ${formatLbc(AMOUNT + 100_000n)} LBC available; send it a little LBC`);

    const { address } = wallets.newAddress();
    const draft = wallets.prepareSend({ address, amount: AMOUNT.toString() });
    console.log(`sending ${formatLbc(AMOUNT)} LBC to its own address ${address}, fee ${formatLbc(BigInt(draft.fee))} LBC`);
    const { txid } = await wallets.send({ draftId: draft.id, password, label: 'mainnet self-send test' });
    console.log(`broadcast ${txid}`);
    await waitFor('the payment to show as pending', 60_000, () => wallets.transactions().some((t) => t.txid === txid));
    // LBC blocks come every 2.5 minutes on average; allow for slow ones.
    const confirmed = await waitFor('a confirmation checked against proof-of-work headers', 30 * 60_000, () => {
      const t = wallets.transaction(txid);
      return t && t.confirmations >= 1 && t.verified === true ? t : null;
    });
    const after: WalletOverview = wallets.overview()!;
    const spent = totalBefore - BigInt(after.balance.total);
    console.log(`confirmed in block ${confirmed.height} (SPV-verified); the wallet paid ${formatLbc(spent)} LBC in fees`);
    if (spent !== BigInt(draft.fee)) throw new Error(`expected to lose only the fee ${draft.fee}, lost ${spent}`);
    console.log('real LBC payment OK');
  } finally {
    await wallets.shutdown();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
