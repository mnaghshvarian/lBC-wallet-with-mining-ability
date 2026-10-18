import type { LbcApi } from '@lbcwallet/services/api';

declare global {
  interface Window {
    lbc: LbcApi;
  }
}

export {};
