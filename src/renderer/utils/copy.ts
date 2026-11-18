import { desktop } from '../useDesktop';

/** 优先走主进程剪贴板（沙箱内 navigator.clipboard 不一定可用）。 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const result = await desktop().copyText(text);
    if (result.ok) return true;
  } catch {
    // 继续尝试浏览器 API
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
