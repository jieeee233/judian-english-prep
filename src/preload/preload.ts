import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type DesktopApi } from '../shared/api';
import type { AnalyzeProgress } from '../shared/types';

const api: DesktopApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (payload) => ipcRenderer.invoke(IPC.settingsSave, payload),
  clearSettings: () => ipcRenderer.invoke(IPC.settingsClear),
  analyze: (payload) => ipcRenderer.invoke(IPC.analyze, payload),
  pathForFile: (file) => {
    try {
      // preload 的 tsconfig 不含 DOM lib，这里绕过 File 类型（运行时一定是 File）
      return webUtils.getPathForFile(file as never);
    } catch {
      return '';
    }
  },
  onAnalyzeProgress: (handler) => {
    const listener = (_event: unknown, progress: AnalyzeProgress) => handler(progress);
    ipcRenderer.on(IPC.analyzeProgress, listener);
    return () => ipcRenderer.removeListener(IPC.analyzeProgress, listener);
  },
  cancelAnalysis: (requestId) => ipcRenderer.invoke(IPC.cancel, requestId),
  generatePractice: (payload) => ipcRenderer.invoke(IPC.practice, payload),
  copyText: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  listHistory: () => ipcRenderer.invoke(IPC.historyList),
  getHistory: (id) => ipcRenderer.invoke(IPC.historyGet, id),
  removeHistory: (id) => ipcRenderer.invoke(IPC.historyRemove, id),
  clearHistory: () => ipcRenderer.invoke(IPC.historyClear),
  exportLesson: (payload) => ipcRenderer.invoke(IPC.exportLesson, payload),
  exportDemo: (payload) => ipcRenderer.invoke(IPC.demoExport, payload),
  exportWordSheet: (payload) => ipcRenderer.invoke(IPC.wordSheetExport, payload),
  listMyVocab: () => ipcRenderer.invoke(IPC.myVocabList),
  addMyVocab: (payload) => ipcRenderer.invoke(IPC.myVocabAdd, payload),
  updateMyVocab: (payload) => ipcRenderer.invoke(IPC.myVocabUpdate, payload),
  removeMyVocab: (ids) => ipcRenderer.invoke(IPC.myVocabRemove, ids),
  extractCollocations: (payload) => ipcRenderer.invoke(IPC.collocationExtract, payload),
  listCollocations: (unitId) => ipcRenderer.invoke(IPC.collocationList, unitId),
  setCollocation: (payload) => ipcRenderer.invoke(IPC.collocationSet, payload),
  importArticle: (payload) => ipcRenderer.invoke(IPC.articleImport, payload),
  listVocabPractice: (unitId) => ipcRenderer.invoke(IPC.practiceVocabList, unitId),
  saveVocabPractice: (payload) => ipcRenderer.invoke(IPC.practiceVocabSave, payload),
  resetVocabPractice: (payload) => ipcRenderer.invoke(IPC.practiceVocabReset, payload),
  generateVocabPractice: (payload) => ipcRenderer.invoke(IPC.practiceVocabGenerate, payload),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
};

contextBridge.exposeInMainWorld('desktop', api);
