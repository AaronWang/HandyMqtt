import { ipcRenderer } from 'electron';

// When contextIsolation is false, we can directly set properties on window
// instead of using contextBridge
(window as any).electron = {
  isElectron: true,
  // Example: send message to main process
  send: (channel: string, data: any) => {
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  // Example: receive message from main process
  receive: (channel: string, func: Function) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  // File system operations
  fs: {
    saveData: (data: string) => ipcRenderer.invoke('fs:saveData', data),
    loadData: () => ipcRenderer.invoke('fs:loadData'),
  },
  // File dialog
  dialog: {
    selectFile: (title: string, filters: any[]) => ipcRenderer.invoke('dialog:selectFile', title, filters),
  }
};

console.log('Preload script loaded, window.electron:', (window as any).electron);
