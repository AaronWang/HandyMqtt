"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let mainWindow = null;
// Get user data directory
const getDataDirectory = () => {
    const userHome = electron_1.app.getPath('home');
    const dataDir = path.join(userHome, '.handymqtt');
    // Create directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('Created data directory:', dataDir);
    }
    return dataDir;
};
const getDataFilePath = () => {
    return path.join(getDataDirectory(), 'app-data.json');
};
// Setup IPC handlers
const setupIpcHandlers = () => {
    // Save data to file
    electron_1.ipcMain.handle('fs:saveData', async (event, data) => {
        try {
            const filePath = getDataFilePath();
            fs.writeFileSync(filePath, data, 'utf-8');
            console.log('Data saved to:', filePath);
            return { success: true };
        }
        catch (error) {
            console.error('Error saving data:', error);
            return { success: false, error: error.message };
        }
    });
    // Load data from file
    electron_1.ipcMain.handle('fs:loadData', async () => {
        try {
            const filePath = getDataFilePath();
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                console.log('Data loaded from:', filePath);
                return { success: true, data };
            }
            else {
                console.log('No data file found at:', filePath);
                return { success: true, data: null };
            }
        }
        catch (error) {
            console.error('Error loading data:', error);
            return { success: false, error: error.message };
        }
    });
    // File dialog for selecting files
    electron_1.ipcMain.handle('dialog:selectFile', async (event, title, filters) => {
        try {
            const result = await electron_1.dialog.showOpenDialog({
                title,
                properties: ['openFile'],
                filters
            });
            if (!result.canceled && result.filePaths.length > 0) {
                return { success: true, filePath: result.filePaths[0] };
            }
            else {
                return { success: false, canceled: true };
            }
        }
        catch (error) {
            console.error('Error opening file dialog:', error);
            return { success: false, error: error.message };
        }
    });
};
function createWindow() {
    // Determine the correct preload path
    const preloadPath = electron_1.app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../dist-electron/preload.js');
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        // Production mode - load from dist folder
        const indexPath = electron_1.app.isPackaged
            ? path.join(__dirname, '../dist/browser/index.html')
            : path.join(__dirname, '../dist/browser/index.html');
        mainWindow.loadFile(indexPath);
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.on('ready', () => {
    setupIpcHandlers();
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
//# sourceMappingURL=main.js.map