import { build } from 'vite';

const configs = ['vite.main.config.ts', 'vite.preload.config.ts', 'vite.config.ts'];

for (const configFile of configs) {
  await build({ configFile });
}
