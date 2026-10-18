import { bitsToTarget, workForTarget } from '../crypto/pow.js';
import { DEWIES_PER_LBC } from '../networks.js';

const BASE_SUBSIDY = 500n * DEWIES_PER_LBC;
const SUBSIDY_LEVEL_INTERVAL = 32n; // chaincfg SubsidyReductionInterval = 1 << 5

function withinLevelBounds(reduction: bigint, lv: bigint): boolean {
  if ((reduction * reduction + reduction) >> 1n > lv) return false;
  const r = reduction + 1n;
  return (r * r + r) >> 1n > lv;
}

/** Block reward in dewies at `height` (exact port of lbcd blockchain.CalcBlockSubsidy). */
export function blockSubsidy(height: number): bigint {
  const h = BigInt(height);
  if (h === 0n) return DEWIES_PER_LBC * 400_000_000n;
  if (h <= 5100n) return DEWIES_PER_LBC;
  if (h <= 55000n) return DEWIES_PER_LBC * (1n + (h - 5001n) / 100n);
  const lv = (h - 55001n) / SUBSIDY_LEVEL_INTERVAL;
  let reduction = (BigInt(Math.floor(Math.sqrt(Number(8n * lv) + 1))) - 1n) / 2n;
  while (!withinLevelBounds(reduction, lv)) {
    if ((reduction * reduction + reduction) >> 1n > lv) reduction--;
    else reduction++;
  }
  const subsidyReduction = DEWIES_PER_LBC * reduction;
  if (subsidyReduction >= BASE_SUBSIDY) return 0n;
  return BASE_SUBSIDY - subsidyReduction;
}

/** Estimated network hashrate (H/s) from the current difficulty bits. */
export function networkHashrateFromBits(bits: number, blockTimeSeconds = 150): number {
  return Number(workForTarget(bitsToTarget(bits))) / blockTimeSeconds;
}

/** Bitcoin-style difficulty number (relative to the 0x1d00ffff-equivalent of LBRY's diff-1 target). */
export function difficultyFromBits(bits: number, powLimitBits = 0x1f00ffff): number {
  const t = bitsToTarget(bits);
  const limit = bitsToTarget(powLimitBits);
  if (t === 0n) return 0;
  return Number((limit * 1_000_000n) / t) / 1_000_000;
}

export interface EarningsEstimate {
  /** Probability-weighted LBC per day. */
  lbcPerDay: number;
  /** Expected days between blocks if solo mining. */
  daysPerBlock: number;
  /** Share of the network hashrate. */
  networkShare: number;
  blockReward: number;
}

export function estimateEarnings(params: {
  hashrate: number;
  networkHashrate: number;
  height: number;
  poolFeePercent?: number;
  blockTimeSeconds?: number;
}): EarningsEstimate {
  const blockTime = params.blockTimeSeconds ?? 150;
  const reward = Number(blockSubsidy(params.height)) / 1e8;
  const share = params.networkHashrate > 0 ? params.hashrate / params.networkHashrate : 0;
  const blocksPerDay = 86_400 / blockTime;
  const fee = (params.poolFeePercent ?? 0) / 100;
  const lbcPerDay = share * blocksPerDay * reward * (1 - fee);
  return {
    lbcPerDay,
    daysPerBlock: share > 0 ? 1 / (share * blocksPerDay) : Infinity,
    networkShare: share,
    blockReward: reward,
  };
}

export function formatHashrate(hps: number): string {
  if (!Number.isFinite(hps) || hps <= 0) return '0 H/s';
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let v = hps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}
