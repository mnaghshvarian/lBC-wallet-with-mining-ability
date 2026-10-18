import { blockSubsidy, decodeAddress, estimateEarnings, getNetwork, networkHashrateFromBits } from '@lbcwallet/core';
import type { MinerEstimateView, PoolBalanceView, Settings } from './api.js';
import { UserError } from './errors.js';
import type { SettingsStore } from './settings.js';
import { scopedLogger, type Logger, type Platform } from './platform.js';

export interface MiningInfoDeps {
  /** Receiving address of the open wallet, used when no payout address is configured. */
  walletAddress: () => string | null;
  /** Height and difficulty bits of the wallet's chain tip. */
  chainTip: () => { height: number; bits: number } | null;
  price: () => number | null;
}

/** Pool fee assumed for estimates (LBRYPool charges 0.5 %). */
const POOL_FEE_PERCENT = 0.5;
const POOL_BALANCE_TTL_MS = 120_000;

/**
 * Mining information that does not need a miner: the payout address, earnings
 * estimates and the balance at a yiimp-compatible pool. Shared by the desktop
 * miner and the Android mining monitor.
 */
export class MiningInfo {
  private readonly log: Logger;
  private poolBalanceCache: { at: number; key: string; value: PoolBalanceView | null } | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly settings: SettingsStore,
    private readonly deps: MiningInfoDeps,
  ) {
    this.log = scopedLogger(platform, 'mining');
  }

  /** The address mining rewards go to; throws a user-facing error if there is none or it is invalid. */
  payoutAddress(settings: Settings = this.settings.get()): string {
    const address = settings.mining.payoutAddress || this.deps.walletAddress();
    if (!address) throw new UserError('minerNeedsWallet');
    try {
      decodeAddress(address, getNetwork(settings.network));
    } catch (err) {
      throw new UserError('payoutInvalid', { detail: (err as Error).message });
    }
    return address;
  }

  /** Expected earnings for `hashrate` at the current difficulty. */
  estimate(params: { hashrate: number; mode: 'pool' | 'solo'; networkBits?: number | null; height?: number | null }): MinerEstimateView {
    const tip = this.deps.chainTip();
    const bits = params.networkBits ?? tip?.bits ?? null;
    const height = params.height ?? tip?.height ?? null;
    if (!bits || height === null) return { networkHashrate: 0, blockReward: 0, lbcPerDay: 0, daysPerBlock: Infinity, fiatPerDay: null, basis: 'none' };
    const networkHashrate = networkHashrateFromBits(bits);
    const e = estimateEarnings({ hashrate: params.hashrate, networkHashrate, height, poolFeePercent: params.mode === 'solo' ? 0 : POOL_FEE_PERCENT });
    const price = this.deps.price();
    return {
      networkHashrate,
      blockReward: Number(blockSubsidy(height)) / 1e8,
      lbcPerDay: e.lbcPerDay,
      daysPerBlock: e.daysPerBlock,
      fiatPerDay: price !== null ? e.lbcPerDay * price : null,
      basis: 'difficulty',
    };
  }

  /** Unpaid/paid balance at a yiimp-compatible pool (e.g. lbrypool.net), cached for two minutes. */
  async poolBalance(addressOverride?: string | null): Promise<PoolBalanceView | null> {
    const settings = this.settings.get();
    const api = settings.mining.poolApi.replace(/\/+$/, '');
    if (!api || settings.mining.mode !== 'pool' || settings.network !== 'mainnet') return null;
    let address: string;
    try {
      address = addressOverride ?? this.payoutAddress(settings);
    } catch {
      return null;
    }
    const key = `${api}|${address}`;
    if (this.poolBalanceCache?.key === key && Date.now() - this.poolBalanceCache.at < POOL_BALANCE_TTL_MS) return this.poolBalanceCache.value;
    let value: PoolBalanceView | null = null;
    try {
      if (!/^https:\/\//.test(api)) throw new Error('pool API must use https');
      const d = (await this.platform.fetchJson(`${api}/api/walletEx?address=${encodeURIComponent(address)}`)) as {
        balance?: number;
        unpaid?: number;
        paid24h?: number;
        total?: number;
        miners?: { accepted?: number }[];
      } | null;
      if (d && typeof d === 'object') {
        const hashrate = (d.miners ?? []).reduce((sum, m) => sum + (m.accepted ?? 0), 0);
        value = { balance: d.balance ?? 0, unpaid: d.unpaid ?? 0, paid24h: d.paid24h ?? 0, total: d.total ?? 0, hashrate, updatedAt: Date.now() };
      } else {
        // yiimp answers an empty body for addresses it has never seen
        value = { balance: 0, unpaid: 0, paid24h: 0, total: 0, updatedAt: Date.now() };
      }
    } catch (err) {
      this.log('warn', `pool balance: ${(err as Error).message}`);
    }
    this.poolBalanceCache = { at: Date.now(), key, value };
    return value;
  }
}
