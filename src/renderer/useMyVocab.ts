import type { MyVocabEntry, MyVocabInput } from '../shared/types';
import { showToast, store } from './store';
import { desktop } from './useDesktop';

/**
 * 我的词汇：主进程落盘，渲染层用 store 缓存。
 * 所有写操作都以主进程返回的列表为准，避免本地与磁盘不一致。
 */

export async function loadMyVocab(force = false): Promise<void> {
  if (store.myVocab.loading) return;
  if (store.myVocab.loaded && !force) return;
  store.myVocab.loading = true;
  try {
    const result = await desktop().listMyVocab();
    if (result.ok) {
      store.myVocab.items = result.items;
      store.myVocab.loaded = true;
    }
  } catch {
    // 读取失败保持空列表，界面上的空态会提示
  } finally {
    store.myVocab.loading = false;
  }
}

export async function addToMyVocab(items: MyVocabInput[], source = ''): Promise<number> {
  if (!items.length) return 0;
  try {
    const result = await desktop().addMyVocab({ items, source });
    if (!result.ok) {
      showToast('error', result.message);
      return 0;
    }
    store.myVocab.items = result.items;
    store.myVocab.loaded = true;
    return items.length;
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '收藏失败，请稍后重试。');
    return 0;
  }
}

export async function updateMyVocab(id: string, patch: MyVocabInput): Promise<boolean> {
  try {
    const result = await desktop().updateMyVocab({ id, patch });
    if (!result.ok) {
      showToast('error', result.message);
      return false;
    }
    const index = store.myVocab.items.findIndex((item) => item.id === id);
    if (index >= 0) store.myVocab.items[index] = result.item;
    return true;
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '保存失败，请稍后重试。');
    return false;
  }
}

export async function removeMyVocab(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  try {
    const result = await desktop().removeMyVocab(ids);
    if (!result.ok) {
      showToast('error', result.message);
      return false;
    }
    store.myVocab.items = result.items;
    return true;
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '删除失败，请稍后重试。');
    return false;
  }
}

export function findMyVocab(term: string): MyVocabEntry | undefined {
  const key = term.toLowerCase().replace(/\s+/g, ' ').trim();
  return store.myVocab.items.find((item) => item.term.toLowerCase().replace(/\s+/g, ' ').trim() === key);
}
