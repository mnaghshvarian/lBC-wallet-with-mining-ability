import type { LbcApi } from '../../shared/api';

declare global {
  interface Window {
    lbc: LbcApi;
  }
}

export {};
