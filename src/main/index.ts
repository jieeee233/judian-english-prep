import { app, BrowserWindow, net, session, shell } from 'electron';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { CollocationStore } from './collocations';
import { HistoryStore } from './history';
import { MyVocabStore } from './myvocab';
import { VocabPracticeStore } from './vocabPractice';
import { registerIpc } from './ipc';
import { AnalysisRunner } from './runner';
import { SettingsStore } from './settings';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

/** Forge 在构建时注入这两个常量；用 typeof 保护，脱离 Forge 单独构建也能跑。 */
function devServerUrl(): string | undefined {
  return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
}

function rendererDirName(): string {
  return typeof MAIN_WINDOW_VITE_NAME !== 'undefined' ? MAIN_WINDOW_VITE_NAME : 'main_window';
}

app.setPath('userData', path.join(app.getPath('appData'), 'English Teaching Tool'));
app.setName('句点英语备课');
const windowsAppId = 'Judian.EnglishLessonPrep';
app.setAppUserModelId(windowsAppId);

const trustedWindows = new Set<number>();
const settings = new SettingsStore();
const history = new HistoryStore();
const myVocab = new MyVocabStore();
const collocations = new CollocationStore();
const vocabPractice = new VocabPracticeStore();
const runner = new AnalysisRunner({ fetch: (url, init) => net.fetch(url, init) });

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: `句点英语备课 ${app.getVersion()}`,
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f6f7f9',
    show: false,
    icon: path.join(__dirname, '../../assets/window.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (process.platform === 'win32' && app.isPackaged) {
    window.setAppDetails({
      appId: windowsAppId,
      appIconPath: path.join(process.resourcesPath, 'app.ico'),
      appIconIndex: 0,
      relaunchCommand: '"' + process.execPath + '"',
      relaunchDisplayName: '句点英语备课',
    });
  }

  const windowId = window.webContents.id;
  trustedWindows.add(windowId);

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    trustedWindows.delete(windowId);
    runner.dispose(windowId);
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on('render-process-gone', () => runner.dispose(windowId));
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) runner.cancel(windowId);
  });

  window.setMenuBarVisibility(false);
  window.on('page-title-updated', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Window failed to load:', errorCode, errorDescription);
  });

  const serverUrl = devServerUrl();
  if (serverUrl) {
    void window.loadURL(serverUrl);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${rendererDirName()}/index.html`));
  }

  return window;
}

async function bootstrap(): Promise<void> {
  settings.init();
  history.init();
  collocations.init();
  await settings.load();

  // 渲染层不需要任何系统权限：麦克风、摄像头、通知一律拒绝
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpc({
    settings,
    history,
    myVocab,
    collocations,
    vocabPractice,
    runner,
    isTrustedWindow: (windowId) => trustedWindows.has(windowId),
  });

  refreshShortcutIdentity();
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}

function refreshShortcutIdentity(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const installRoot = path.resolve(path.dirname(process.execPath), '..');
  const programs = path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs');
  const dirs = [app.getPath('desktop'), programs];
  try {
    for (const item of readdirSync(programs, { withFileTypes: true })) {
      if (item.isDirectory()) dirs.push(path.join(programs, item.name));
    }
  } catch { /* Start menu access may be restricted. */ }
  for (const dir of dirs) {
    const link = path.join(dir, '句点英语备课.lnk');
    if (!existsSync(link)) continue;
    try {
      const current = shell.readShortcutLink(link);
      if (path.dirname(current.target).toLowerCase() !== installRoot.toLowerCase()) continue;
      const icon = path.join(process.resourcesPath, 'app.ico');
      if (current.appUserModelId !== windowsAppId || current.icon !== icon) {
        shell.writeShortcutLink(link, 'update', { ...current, appUserModelId: windowsAppId, icon, iconIndex: 0 });
      }
    } catch { /* A locked shortcut can be refreshed on the next launch. */ }
  }
}

function handleInstallerEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const event = process.argv[1];
  if (event === '--squirrel-obsolete') {
    app.quit();
    return true;
  }
  const executable = path.basename(process.execPath);
  let args: string[];
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    args = [`--createShortcut=${executable}`, `--icon=${path.join(process.resourcesPath, 'app.ico')}`];
  } else if (event === '--squirrel-uninstall') {
    args = [`--removeShortcut=${executable}`];
  } else {
    return false;
  }
  const updater = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const child = spawn(updater, args, { windowsHide: true, stdio: 'ignore' });
  child.once('error', () => app.exit(1));
  child.once('close', async code => {
    if (code === 0 && event !== '--squirrel-uninstall') {
      await app.whenReady();
      refreshShortcutIdentity();
    }
    app.exit(code ?? 1);
  });
  return true;
}

if (!handleInstallerEvent()) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });

    app
      .whenReady()
      .then(bootstrap)
      .catch((error: unknown) => {
        console.error('Application failed to start:', error);
        app.exit(1);
      });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
