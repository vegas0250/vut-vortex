import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist/preload',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: 'src/preload/index.ts',
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    noExternal: true,
    external: ['electron'],
  },
});
