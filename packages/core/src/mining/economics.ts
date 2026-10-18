import { bitsToTarget, workForTarget } from '../crypto/pow.js';
import { DEWIES_PER_LBC } from '../networks.js';

const BASE_SUBSIDY = 500n * DEWIES_PER_LBC;
const SUBSIDY_LEVEL_INTERVAL = 32n; // chaincfg SubsidyReductionInterval = 1 << 5
/** From this block on the reward is 500 LBC minus one LBC per reduction step. */
const DECAY_START = 55_001n;
/** Reduction steps until the reward reaches zero. */
const MAX_REDUCTION = BASE_SUBSIDY / DEWIES_PER_LBC;
/** LBRY's target time between blocks (2.5 minutes). */
export const BLOCK_TIME_SECONDS = 150;

const triangular = (n: bigint) => (n * (n + 1n)) / 2n;

function withinLevelBounds(reduction: bigint, lv: bigint): boolean {
  if ((reduction * reduction + reduction) >> 1n > lv) return false;
  const r = reduction + 1n;
  return (r * r + r) >> 1n > lv;
}

/** Reduction steps reached at subsidy level `lv`: the largest r with r(r+1)/2 <= lv. */
function reductionAt(lv: bigint): bigint {
  let reduction = (BigInt(Math.floor(Math.sqrt(Number(8n * lv) + 1))) - 1n) / 2n;
  while (!withinLevelBounds(reduction, lv)) {
    if ((reduction * reduction + reduction) >> 1n > lv) reduction--;
    else reduction++;
  }
  return reduction;
}

/** Block reward in dewies at `height` (exact port of lbcd blockchain.CalcBlockSubsidy). */
export function blockSubsidy(height: number): bigint {
  const h = BigInt(height);
  if (h === 0n) return DEWIES_PER_LBC * 400_000_000n;
  if (h <= 5100n) return DEWIES_PER_LBC;
  if (h <= 55000n) return DEWIES_PER_LBC * (1n + (h - 5001n) / 100n);
  const subsidyReduction = DEWIES_PER_LBC * reductionAt((h - DECAY_START) / SUBSIDY_LEVEL_INTERVAL);
  if (subsidyReduction >= BASE_SUBSIDY) return 0n;
  return BASE_SUBSIDY - subsidyReduction;
}

/**
 * Every LBC created by blocks 0 to `height`, in dewies: the sum of their
 * rewards under the consensus schedule above, in closed form.
 */
export function issuedSupply(height: number): bigint {
  if (height < 0) return 0n;
  const h = BigInt(height);
  // Block 0 (400 million LBC), then 1 LBC per block up to 5100.
  let lbc = 400_000_000n + (h < 5100n ? h : 5100n);
  if (h > 5100n) {
    // Blocks 5101–55000 pay k + 1 LBC in 100-block groups k = 1…499 (block 5001 + 100k onwards).
    const end = h < 55000n ? h : 55000n;
    const k = (end - 5001n) / 100n;
    lbc += 100n * (k - 1n + triangular(k - 1n)) + (end - 5000n - 100n * k) * (k + 1n);
  }
  if (h >= DECAY_START) {
    // Reduction step q pays 500 − q LBC for 32·(q + 1) blocks.
    const r = reductionAt((h - DECAY_START) / SUBSIDY_LEVEL_INTERVAL);
    const done = r < MAX_REDUCTION ? r : MAX_REDUCTION;
    // Σ_{s=1}^{done} s·(501 − s) for the completed steps …
    lbc += SUBSIDY_LEVEL_INTERVAL * ((MAX_REDUCTION + 1n) * triangular(done) - (done * (done + 1n) * (2n * done + 1n)) / 6n);
    // … plus the blocks of the current one.
    if (r < MAX_REDUCTION) lbc += (h - DECAY_START - SUBSIDY_LEVEL_INTERVAL * triangular(r) + 1n) * (MAX_REDUCTION - r);
  }
  return lbc * DEWIES_PER_LBC;
}

/** The last block that pays a reward; after it miners earn transaction fees only. */
export const LAST_REWARD_HEIGHT = Number(DECAY_START + SUBSIDY_LEVEL_INTERVAL * triangular(MAX_REDUCTION)) - 1;

/** All LBC that will ever exist, in dewies (1,083,202,000 LBC). */
export const TOTAL_SUPPLY = issuedSupply(LAST_REWARD_HEIGHT);

/** The first block after `height` whose reward differs from the reward at `height`, or null once rewards have ended. */
export function nextRewardChange(height: number): { height: number; reward: bigint } | null {
  const current = blockSubsidy(height);
  let x = BigInt(height);
  for (;;) {
    let next: bigint;
    if (x === 0n) next = 1n;
    else if (x <= 5100n) next = 5101n;
    else if (x < DECAY_START) next = 5001n + 100n * ((x - 5001n) / 100n + 1n);
    else {
      const r = reductionAt((x - DECAY_START) / SUBSIDY_LEVEL_INTERVAL);
      if (r >= MAX_REDUCTION) return null;
      next = DECAY_START + SUBSIDY_LEVEL_INTERVAL * triangular(r + 1n);
    }
    const reward = blockSubsidy(Number(next));
    if (reward !== current) return { height: Number(next), reward };
    x = next;
  }
}

export interface SupplyFacts {
  /** Reward of the next block, in dewies. */
  reward: bigint;
  /** Created up to and including `height`, in dewies. */
  issued: bigint;
  /** Still to be paid to miners, in dewies. */
  remaining: bigint;
  total: bigint;
  /** Next change of the block reward, with the expected days until it. */
  nextChange: { height: number; reward: bigint; days: number } | null;
  lastRewardHeight: number;
  /** Expected days until the last reward (at 2.5 minutes per block). */
  daysToLastReward: number;
}

/** Supply figures for a chain whose newest block is `height` (mainnet schedule). */
export function supplyFacts(height: number): SupplyFacts {
  const issued = issuedSupply(height);
  const days = (blocks: number) => (Math.max(0, blocks) * BLOCK_TIME_SECONDS) / 86_400;
  const change = nextRewardChange(height + 1);
  return {
    reward: blockSubsidy(height + 1),
    issued,
    remaining: TOTAL_SUPPLY - issued,
    total: TOTAL_SUPPLY,
    nextChange: change ? { ...change, days: days(change.height - height) } : null,
    lastRewardHeight: LAST_REWARD_HEIGHT,
    daysToLastReward: days(LAST_REWARD_HEIGHT - height),
  };
}

/** Estimated network hashrate (H/s) from the current difficulty bits. */
export function networkHashrateFromBits(bits: number, blockTimeSeconds = BLOCK_TIME_SECONDS): number {
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
  const blockTime = params.blockTimeSeconds ?? BLOCK_TIME_SECONDS;
  const reward = Number(blockSubsidy(params.height)) / 1e8;
  // Your hashrate is part of the network's, so the share can never exceed 100 %.
  const share = params.networkHashrate > 0 ? Math.min(1, params.hashrate / params.networkHashrate) : 0;
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
