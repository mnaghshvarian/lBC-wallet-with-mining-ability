import type { MiningSettings } from '@lbcwallet/services';

export type PauseReason = 'battery' | 'in-use';

/**
 * Why mining that is switched on should not run right now. Battery takes
 * precedence; "in use" means less than `idleMinutes` since the last keyboard or
 * mouse input (the idle counter restarts at every input, so one threshold both
 * pauses mining when the user comes back and resumes it once they have left).
 */
export function pauseReason(
  mining: Pick<MiningSettings, 'pauseOnBattery' | 'onlyWhenIdle' | 'idleMinutes'>,
  system: { onBattery: boolean; idleSeconds: number },
): PauseReason | null {
  if (mining.pauseOnBattery && system.onBattery) return 'battery';
  if (mining.onlyWhenIdle && system.idleSeconds < mining.idleMinutes * 60) return 'in-use';
  return null;
}
