import type { VortexApi } from '../preload/index';

declare global {
  interface Window {
    vortex: VortexApi;
  }
}

export {};
