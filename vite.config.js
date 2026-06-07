import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080,
    host: true
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500, // Aumentar el límite para librerías grandes como Chart.js y XLSX
    rollupOptions: {
      output: {
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'css/styles.css';
          }
          return 'assets/[name]-[hash].[ext]';
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Dividir las dependencias externas de node_modules en un chunk separado
            return 'vendor';
          }
        }
      }
    }
  }
});
