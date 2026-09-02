const fs = require('fs');
const path = require('path');

const wwwDir = path.join(__dirname, '..', 'www');
if (fs.existsSync(wwwDir)) {
    fs.rmSync(wwwDir, { recursive: true, force: true });
}
fs.mkdirSync(wwwDir, { recursive: true });

const filesToCopy = ['index.html', 'manifest.json', 'sw.js'];
filesToCopy.forEach(file => {
    const src = path.join(__dirname, '..', file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(wwwDir, file));
    }
});

const dirsToCopy = ['css', 'js', 'img', 'data'];
dirsToCopy.forEach(dir => {
    const src = path.join(__dirname, '..', dir);
    const dest = path.join(wwwDir, dir);
    if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
    }
});

console.log('✅ Carpeta www preparada exitosamente para Android.');
