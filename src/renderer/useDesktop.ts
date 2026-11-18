import type { DesktopApi } from '../shared/api';
import { installMockBridge } from './mock';
import { store } from './store';

let cached: DesktopApi | null = null;

/**
 * 拿到 IPC 桥。只有在本机用 vite 打开页面（无 Electron）时才装 mock，
 * 打包后的应用若桥缺失会直接抛错，避免用假数据掩盖真实故障。
 */
export function desktop(): DesktopApi {
  if (cached) return cached;
  if (window.desktop) {
    cached = window.desktop;
    return cached;
  }
  const isBrowserPreview = import.meta.env.DEV || location.protocol.startsWith('http');
  if (!isBrowserPreview) {
    throw new Error('桌面桥未加载，请重新启动应用。');
  }
  cached = installMockBridge();
  window.desktop = cached;
  store.previewMode = true;
  return cached;
}

export function hasDesktopBridge(): boolean {
  return Boolean(window.desktop);
}
