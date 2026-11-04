import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { startServer, type RunningServer } from '@shopme/server';

// The server runs inside this (main) process: PGlite's WASM and the napi argon2 binary both work under
// Electron's Node, and it avoids a second process to supervise. A crash of the server is a crash of the app,
// which is acceptable for a single-user local store.

const here = path.dirname(fileURLToPath(import.meta.url));
/** Preferred port: keeps the origin (and therefore the admin login cookie) stable between launches. */
const PREFERRED_PORT = 38417;

let server: RunningServer | undefined;
let mainWindow: BrowserWindow | undefined;
let splash: BrowserWindow | undefined;
let quitting = false;

const resources = path.join(here, 'resources');
const iconPath = path.join(resources, 'icon.png');

function splashHtml(message: string): string {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1E40AF;color:#fff;font:15px system-ui,sans-serif;-webkit-user-select:none">
<div style="font-size:34px;font-weight:700;letter-spacing:.5px">ShopMe</div><div style="margin-top:14px;opacity:.85">${message}</div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showSplash(): void {
  splash = new BrowserWindow({ width: 360, height: 220, frame: false, resizable: false, show: true, center: true, alwaysOnTop: true, icon: iconPath, title: 'ShopMe' });
  void splash.loadURL(splashHtml('Starting your store…'));
}

async function launchServer(): Promise<RunningServer> {
  const dataDir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  const base = {
    host: '127.0.0.1', // local only: never exposed to the network
    dataDir,
    logger: true,
    paths: {
      adminDist: path.join(resources, 'admin'),
      migrationsDir: path.join(resources, 'migrations'),
      themeDefaultDir: path.join(resources, 'theme'),
    },
  };
  try {
    return await startServer({ ...base, port: PREFERRED_PORT, appUrl: `http://127.0.0.1:${PREFERRED_PORT}` });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    return startServer({ ...base, port: 0 });
  }
}

function isInApp(url: string): boolean {
  if (!server) return false;
  try {
    const u = new URL(url);
    return u.origin === new URL(server.url).origin && (u.pathname === '/admin' || u.pathname.startsWith('/admin/'));
  } catch {
    return false;
  }
}

function openExternal(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

function openAdmin(): void {
  if (!server) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'ShopMe',
    icon: iconPath,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow = win;
  win.on('closed', () => { mainWindow = undefined; });
  // Keep the "ShopMe" title whatever the page sets.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInApp(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInApp(url)) {
      e.preventDefault();
      openExternal(url);
    }
  });
  void win.loadURL(`${server.url}/admin`);
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'ShopMe',
      submenu: [
        { label: 'Open admin', accelerator: 'CmdOrCtrl+Shift+A', click: openAdmin },
        { label: 'Open storefront', accelerator: 'CmdOrCtrl+Shift+S', click: () => server && openExternal(server.url) },
        { label: 'Open data folder', click: () => void shell.openPath(path.join(app.getPath('userData'), 'data')) },
        { type: 'separator' },
        { label: 'Export my store… (coming soon)', enabled: false },
        { type: 'separator' },
        { label: 'Quit', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4', click: () => app.quit() },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openAdmin());
  app.setName('ShopMe');

  // Closing the last window quits the app (and the store): it only runs while the app is open.
  app.on('window-all-closed', () => {
    if (!splash || splash.isDestroyed()) app.quit();
  });
  app.on('activate', () => openAdmin());

  app.on('before-quit', (e) => {
    if (quitting || !server) return;
    e.preventDefault();
    quitting = true;
    const s = server;
    server = undefined;
    s.close().catch((err) => console.error('shutdown error', err)).finally(() => app.exit(0));
  });

  app.whenReady().then(async () => {
    buildMenu();
    showSplash();
    try {
      server = await launchServer();
      console.log(`SHOPME_URL=${server.url}`);
      openAdmin();
    } catch (err) {
      console.error(err);
      dialog.showErrorBox('ShopMe could not start', err instanceof Error ? err.message : String(err));
      app.exit(1);
      return;
    } finally {
      splash?.destroy();
      splash = undefined;
    }
  });
}
