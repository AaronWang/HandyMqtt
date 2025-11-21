"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// When contextIsolation is false, we can directly set properties on window
// instead of using contextBridge
window.electron = {
    isElectron: true,
    // Example: send message to main process
    send: (channel, data) => {
        const validChannels = ['toMain'];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.send(channel, data);
        }
    },
    // Example: receive message from main process
    receive: (channel, func) => {
        const validChannels = ['fromMain'];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    // File system operations
    fs: {
        saveData: (data) => electron_1.ipcRenderer.invoke('fs:saveData', data),
        loadData: () => electron_1.ipcRenderer.invoke('fs:loadData'),
    },
    // File dialog
    dialog: {
        selectFile: (title, filters) => electron_1.ipcRenderer.invoke('dialog:selectFile', title, filters),
    }
};
console.log('Preload script loaded, window.electron:', window.electron);
//# sourceMappingURL=preload.js.map