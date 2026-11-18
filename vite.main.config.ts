import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';

// 版本号构建期注入：这样无论用打包后的 exe 还是 electron 脚本启动，
// 界面显示的都是 package.json 里的版本，不会退回 Electron 自身版本。
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// 主进程：打成 CommonJS；electron / 原生无关的第三方依赖运行时从 node_modules 解析
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    target: 'node20',
    lib: {
      entry: 'src/main/index.ts',
      fileName: () => 'main.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        'electron',
        'electron-squirrel-startup',
        'docx',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
