import type { DesktopApi } from '../shared/api';

declare global {
  interface Window {
    /** preload 注入；浏览器预览模式下由 mock 填充 */
    desktop?: DesktopApi;
  }
}

export {};
