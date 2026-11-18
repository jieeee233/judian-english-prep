import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    target: 'node20',
    lib: {
      entry: 'src/preload/preload.ts',
      fileName: () => 'preload.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
