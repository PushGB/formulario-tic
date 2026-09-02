const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
    try {
        const win = new BrowserWindow({
            width: 1440,
            height: 900,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, '..', 'preload.js'),
                contextIsolation: true
            }
        });

        await win.loadFile(path.join(__dirname, '..', 'index.html'));
        await new Promise(r => setTimeout(r, 1500));

        // 1. Dashboard
        let img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'img', 'manual', 'screenshot-dashboard.png'), img.toPNG());

        // 2. Formulario
        await win.webContents.executeJavaScript("switchTab('form-view');");
        await new Promise(r => setTimeout(r, 800));
        img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'img', 'manual', 'screenshot-formulario.png'), img.toPNG());

        // 3. Catastro
        await win.webContents.executeJavaScript("switchTab('inventory');");
        await new Promise(r => setTimeout(r, 800));
        img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'img', 'manual', 'screenshot-catastro.png'), img.toPNG());

        // 4. Metricas
        await win.webContents.executeJavaScript("switchTab('metrics');");
        await new Promise(r => setTimeout(r, 800));
        img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'img', 'manual', 'screenshot-metricas.png'), img.toPNG());

        // 5. Modal de Info y Novedades
        await win.webContents.executeJavaScript("openSystemInfoModal();");
        await new Promise(r => setTimeout(r, 800));
        img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'img', 'manual', 'screenshot-modal-info.png'), img.toPNG());

        // 6. Previsualizacion de Impresion
        await win.webContents.executeJavaScript("closeSystemInfoModal(); openPrintPreview();");
        await new Promise(r => setTimeout(r, 1000));
        img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'img', 'manual', 'screenshot-print-preview.png'), img.toPNG());

        console.log('✅ Capturas de pantalla completadas.');
    } catch (err) {
        console.error('Error al capturar:', err);
    } finally {
        app.quit();
    }
});
