import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build, createServer } from 'vite';

await build({ configFile: 'vite.main.config.ts' });
await build({ configFile: 'vite.preload.config.ts' });

const renderer = await createServer({ configFile: 'vite.config.ts' });
await renderer.listen();
const url = renderer.resolvedUrls?.local?.[0];
if (!url) throw new Error('Vite не сообщил адрес renderer');

const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env, VUT_RENDERER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_PATH;
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env,
});

const stop = async (code) => {
  await renderer.close();
  process.exit(code ?? 0);
};

child.on('exit', (code) => {
  void stop(code);
});
process.on('SIGINT', () => {
  child.kill('SIGINT');
});
