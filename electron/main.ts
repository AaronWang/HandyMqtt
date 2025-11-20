import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as url from 'url';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Determine the correct preload path
  const preloadPath = app.isPackaged
    ? path.join(__dirname, 'preload.js')
    : path.join(__dirname, '../dist-electron/preload.js');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the Angular app
  if (process.env['NODE_ENV'] === 'development') {
    // Development mode - load from Angular dev server
    mainWindow.loadURL('http://localhost:4200');
    // mainWindow.webContents.openDevTools();
  } else {
    // Production mode - load from dist folder
    const indexPath = app.isPackaged
      ? path.join(__dirname, '../dist/browser/index.html')
      : path.join(__dirname, '../dist/browser/index.html');

    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
