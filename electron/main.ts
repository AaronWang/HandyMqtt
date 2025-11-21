import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;

// Get user data directory
const getDataDirectory = (): string => {
  const userHome = app.getPath('home');
  const dataDir = path.join(userHome, '.handymqtt');

  // Create directory if it doesn't exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Created data directory:', dataDir);
  }

  return dataDir;
};

const getDataFilePath = (): string => {
  return path.join(getDataDirectory(), 'app-data.json');
};

// Setup IPC handlers
const setupIpcHandlers = (): void => {
  // Save data to file
  ipcMain.handle('fs:saveData', async (event, data: string) => {
    try {
      const filePath = getDataFilePath();
      fs.writeFileSync(filePath, data, 'utf-8');
      console.log('Data saved to:', filePath);
      return { success: true };
    } catch (error) {
      console.error('Error saving data:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Load data from file
  ipcMain.handle('fs:loadData', async () => {
    try {
      const filePath = getDataFilePath();
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        console.log('Data loaded from:', filePath);
        return { success: true, data };
      } else {
        console.log('No data file found at:', filePath);
        return { success: true, data: null };
      }
    } catch (error) {
      console.error('Error loading data:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // File dialog for selecting files
  ipcMain.handle('dialog:selectFile', async (event, title: string, filters: any[]) => {
    try {
      const result = await dialog.showOpenDialog({
        title,
        properties: ['openFile'],
        filters
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, filePath: result.filePaths[0] };
      } else {
        return { success: false, canceled: true };
      }
    } catch (error) {
      console.error('Error opening file dialog:', error);
      return { success: false, error: (error as Error).message };
    }
  });
};

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
      nodeIntegration: true,
      contextIsolation: false,
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

app.on('ready', () => {
  setupIpcHandlers();
  createWindow();
});

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
