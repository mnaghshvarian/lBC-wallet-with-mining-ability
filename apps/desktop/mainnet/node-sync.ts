/**
 * Mainnet check of the built-in node: starts NodeService with the bundled lbcd
 * on LBC mainnet in a temporary folder and verifies that it finds peers (DNS
 * seeds, or the wallet's bootstrap peers when those fail) and downloads and
 * verifies headers and blocks.
 *
 *   LBCD_BIN=apps/desktop/resources/bin/linux-x64/lbcd npx tsx mainnet/node-sync.ts [minutes]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryFiles, SettingsStore, type NodeStatusView } from '@lbcwallet/services';
import { NodeService } from '../src/main/node-service';

const minutes = Number(process.argv[2] ?? 6);
const binary = process.env.LBCD_BIN;
if (!binary) throw new Error('set LBCD_BIN to the lbcd binary');

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'lbcd-mainnet-'));
  const settings = new SettingsStore(memoryFiles(), 2);
  settings.update({ network: 'mainnet', node: { enabled: false, dataDir: dir, listen: false, peers: [] } });
  let status: NodeStatusView | null = null;
  const node = new NodeService({
    settings,
    appDataDir: dir,
    binary: binary!,
    onStatus: (s) => (status = s),
    onNotice: (n) => console.log(`notice: ${n.code} ${JSON.stringify(n.params ?? {})}`),
    onAvailabilityChange: () => undefined,
    hubHeight: () => null,
    requiredDiskGb: 1,
  });
  const started = Date.now();
  try {
    await node.start();
    let best = { peers: 0, headers: 0, height: 0 };
    while (Date.now() - started < minutes * 60_000) {
      await new Promise((r) => setTimeout(r, 15_000));
      const s = (status ?? node.status()) as NodeStatusView;
      best = { peers: Math.max(best.peers, s.peers), headers: Math.max(best.headers, s.headers), height: Math.max(best.height, s.height) };
      console.log(
        `${Math.round((Date.now() - started) / 1000)}s ${s.state}: ${s.peers} peers, headers ${s.headers}, blocks ${s.height}` +
          `${s.networkHeight ? ` of ~${s.networkHeight}` : ''}, ${(s.progress * 100).toFixed(2)}%${s.version ? `, ${s.version}` : ''}${s.error ? `, error: ${s.error}` : ''}`,
      );
      if (s.state === 'error') throw new Error(`node stopped: ${s.error}`);
      if (best.peers > 0 && best.height > 2000) break;
    }
    if (best.peers === 0) {
      console.log(`---- lbcd log (last 60 lines) ----\n${node.logs().slice(-60).join('\n')}\n---- end of lbcd log ----`);
      throw new Error('the node found no peers (DNS seeds and bootstrap peers failed, or P2P is blocked)');
    }
    if (best.height <= 0 && best.headers <= 0) throw new Error('the node did not download any headers or blocks');
    console.log(`built-in node OK on mainnet: up to ${best.peers} peers, ${best.headers} headers, ${best.height} blocks verified`);
  } finally {
    await node.stop({ remember: false }).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
