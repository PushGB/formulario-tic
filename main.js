const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1366,
        height: 850,
        minWidth: 960,
        minHeight: 650,
        title: "Gestión de Equipamiento TIC - ISP Chile",
        icon: path.join(__dirname, 'img', 'icon-512.png'),
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: false
        }
    });

    // Cargar interfaz local
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Configuración de enlaces externos (abrir en navegador predeterminado del sistema)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Menú de aplicación nativo
    const menuTemplate = [
        {
            label: 'Archivo',
            submenu: [
                {
                    label: 'Imprimir Formulario (Ctrl+P)',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send('trigger-print');
                    }
                },
                {
                    label: 'Exportar Acta a PDF Directo...',
                    accelerator: 'CmdOrCtrl+Shift+P',
                    click: async () => {
                        if (mainWindow) mainWindow.webContents.send('trigger-export-pdf');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Salir',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: 'Edición',
            submenu: [
                { label: 'Deshacer', role: 'undo' },
                { label: 'Rehacer', role: 'redo' },
                { type: 'separator' },
                { label: 'Cortar', role: 'cut' },
                { label: 'Copiar', role: 'copy' },
                { label: 'Pegar', role: 'paste' },
                { label: 'Seleccionar todo', role: 'selectAll' }
            ]
        },
        {
            label: 'Ver',
            submenu: [
                { label: 'Recargar', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: 'Forzar Recarga', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
                { type: 'separator' },
                { label: 'Zoom +', role: 'zoomIn' },
                { label: 'Zoom -', role: 'zoomOut' },
                { label: 'Restablecer Zoom', role: 'resetZoom' },
                { type: 'separator' },
                { label: 'Pantalla Completa', role: 'togglefullscreen' },
                {
                    label: 'Herramientas de Desarrollador',
                    accelerator: 'F12',
                    click: () => mainWindow && mainWindow.webContents.toggleDevTools()
                }
            ]
        },
        {
            label: 'Ayuda',
            submenu: [
                {
                    label: 'Acerca de Formulario TIC',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Acerca de Gestión TIC',
                            message: 'Gestión de Equipamiento TIC - ISP Chile',
                            detail: `Versión: ${app.getVersion()}\nOficina de Tecnologías de la Información y Comunicaciones (TIC)\nInstituto de Salud Pública de Chile.`,
                            buttons: ['Aceptar']
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Inicialización de la aplicación
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// CANALES IPC PARA CAPACIDADES NATIVAS
// ==========================================

// 1. Guardar PDF oficial directamente en disco
ipcMain.handle('save-pdf-dialog', async (event, defaultName) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Acta en formato PDF',
        defaultPath: defaultName || 'Acta_TIC_Oficial.pdf',
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) return { success: false };

    try {
        const pdfData = await mainWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: {
                width: 216000,   // 216 mm (Oficio / Circular Chile)
                height: 330000   // 330 mm (Oficio / Circular Chile)
            },
            margins: {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0
            }
        });

        await fs.promises.writeFile(filePath, pdfData);
        return { success: true, filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 2. Guardar Copia de Seguridad JSON nativa
ipcMain.handle('save-json-backup', async (event, { data, defaultName }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Respaldo de Base de Datos TIC',
        defaultPath: defaultName || `respaldo_tic_${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'Archivos JSON', extensions: ['json'] }]
    });

    if (canceled || !filePath) return { success: false };

    try {
        await fs.promises.writeFile(filePath, data, 'utf-8');
        return { success: true, filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 3. Cargar Copia de Seguridad JSON desde disco
ipcMain.handle('load-json-backup', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Cargar Respaldo JSON de Actas',
        filters: [{ name: 'Archivos JSON', extensions: ['json'] }],
        properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { success: false };

    try {
        const content = await fs.promises.readFile(filePaths[0], 'utf-8');
        return { success: true, data: content, filePath: filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 4. Obtener información de la aplicación
ipcMain.handle('get-app-info', () => {
    return {
        name: app.getName(),
        version: app.getVersion(),
        userDataPath: app.getPath('userData'),
        isElectron: true
    };
});
