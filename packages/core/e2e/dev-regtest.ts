/**
 * Local LBC development network: lbcd (regtest) + LBRY hub emulator + Stratum
 * test pool. Point the desktop app at it (Settings → About → Developer mode →
 * Regtest, then add hub 127.0.0.1:50101) to try every feature without real funds.
 *
 *   LBCD_BIN=/path/to/lbcd npm run regtest
 *
 * The funded test wallet is the BIP39 phrase "abandon … about" (12 words).
 */
import { startRegtest } from './harness.js';
import { startRegtestHub } from './regtest-hub.js';
import { startTestPool } from './test-pool.js';
import { REGTEST } from '../src/networks.js';
import { AddressDeriver, deriveAccountKey, publicOnly } from '../src/keys/hd.js';
import { addressToScript } from '../src/address.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function main() {
  const account = deriveAccountKey(PHRASE, 'bip44', REGTEST);
  const miner = new AddressDeriver(publicOnly(account, REGTEST), REGTEST).derive(0, 0).address;
  const node = await startRegtest(miner);
  await node.generate(Number(process.env.BLOCKS ?? 120));
  const hub = await startRegtestHub(node.rpc, { port: Number(process.env.HUB_PORT ?? 50101), pollMs: 300 });
  const pool = await startTestPool(node.rpc, addressToScript(miner, REGTEST), Number(process.env.POOL_DIFF ?? 0.005), Number(process.env.POOL_PORT ?? 33340));
  const info = { ready: true, rpcUrl: node.rpcUrl, p2pPort: node.p2pPort, rpcUser: 'e2e', rpcPassword: 'e2e', hubPort: hub.port, poolPort: pool.port, fundedPhrase: PHRASE, minerAddress: miner };
  console.log(JSON.stringify(info));
  let timer: ReturnType<typeof setInterval> | undefined;
  if (process.env.AUTOMINE) timer = setInterval(() => void node.generate(1).catch(() => undefined), Number(process.env.AUTOMINE) * 1000);
  const stop = async () => {
    if (timer) clearInterval(timer);
    await pool.close();
    await hub.close();
    await node.stop();
    process.exit(0);
  };
  process.stdin.on('data', (d) => {
    const cmd = d.toString().trim();
    const m = /^mine (\d+)$/.exec(cmd);
    if (m) void node.generate(Number(m[1])).then((h) => console.log(JSON.stringify({ mined: h.length })));
    // Windows has no SIGTERM handler; tests ask over stdin instead.
    if (cmd === 'stop') void stop();
  });
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
