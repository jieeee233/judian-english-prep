const path = require('node:path');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  // 输出目录（默认 out/），可通过 ETE_OUT_DIR 覆盖
  outDir: process.env.ETE_OUT_DIR || 'out',
  packagerConfig: {
    name: 'EnglishTeachingTool',
    executableName: 'EnglishTeachingTool',
    win32metadata: { ProductName: '句点英语备课', FileDescription: '句点' },
    appBundleId: 'com.squirrel.EnglishTeachingTool.EnglishTeachingTool',
    icon: path.resolve(__dirname, 'assets/app'),
    asar: true,
    extraResource: [path.resolve(__dirname, 'assets/app.ico')],
    // 网络受限时可指定本地 electron 压缩包目录，避免重复下载
    electronZipDir: process.env.ELECTRON_ZIP_DIR,
    // 只保留运行期真正需要的依赖，避免把工具链打进包体
    ignore: [
      /^\/src/,
      /^\/scripts/,
      // 教材词表原始 JSON 只在构建期用于生成 src/renderer/data/vocab.json
      /^\/data/,
      /^\/dist/,
      /^\/\.smoke/,
      /^\/out/,
      /\.map$/,
      /^\/node_modules\/\.electron/,
      // vite 开发模式预打包缓存，运行期不需要
      /^\/node_modules\/\.vite/,
      /^\/tsconfig/,
      /^\/vite\..*\.ts$/,
      /^\/forge\.config\.js$/,
      /^\/index\.html$/,
      /^\/\.git/,
      /^\/\.workbuddy/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'EnglishTeachingTool',
        title: '句点',
        setupExe: '句点英语备课-0.9.10-Setup.exe',
        loadingGif: path.resolve(__dirname, 'assets/installer.gif'),
        setupIcon: path.resolve(__dirname, 'assets/app.ico'),
        // 证书未配置时跳过签名，本地构建不报错
        certificateFile: process.env.WINDOWS_CERT_FILE,
        certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main/index.ts',
            config: 'vite.main.config.ts',
            target: 'main',
          },
          {
            entry: 'src/preload/preload.ts',
            config: 'vite.preload.config.ts',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.ts',
          },
        ],
      },
    },
  ],
};
