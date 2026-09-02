const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    savePdf: (defaultName) => ipcRenderer.invoke('save-pdf-dialog', defaultName),
    saveJsonBackup: (data, defaultName) => ipcRenderer.invoke('save-json-backup', { data, defaultName }),
    loadJsonBackup: () => ipcRenderer.invoke('load-json-backup'),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    onTriggerPrint: (callback) => ipcRenderer.on('trigger-print', () => callback()),
    onTriggerExportPdf: (callback) => ipcRenderer.on('trigger-export-pdf', () => callback())
});
