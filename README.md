# Gestión de Equipamiento TIC - ISP Chile

Este proyecto consiste en una aplicación web interactiva de página única (SPA) diseñada para digitalizar y gestionar el **Formulario de Asignación, Traspaso y/o Devolución de Equipamiento Tecnológico** de la Oficina de TIC del Instituto de Salud Pública de Chile, bajo el código oficial **RG-02-IT-140.03-004 versión 5**.

La aplicación funciona de forma completamente local y offline (sin necesidad de internet), ideal para entornos de intranet gubernamentales o redes seguras.

---

## 📁 Estructura del Proyecto

Los archivos se encuentran organizados y limpios dentro de la carpeta:

```text
Formulario/
│
├── index.html          # Interfaz de usuario interactiva y plantillas de impresión (HTML5)
│
├── css/
│   └── styles.css      # Estilos visuales personalizados y directivas CSS para impresión (@media print)
│
├── js/
│   └── app.js          # Lógica de la aplicación: localStorage, firmas digitales canvas, validaciones y RUT
│
├── img/
│   └── logo-isp.svg    # Logotipo institucional vectorizado (SVG) del ISP de Chile (cargado de forma local/offline)
│
└── README.md           # Este manual de instrucciones y documentación del proyecto
```

---

## 🚀 ¿Cómo Ver y Usar la Aplicación de Forma Local?

Para ejecutar la aplicación, solo necesitas abrir el archivo principal en tu navegador web:

1. **Apertura Directa:**
   - Haz doble clic sobre el archivo [index.html](index.html) en tu explorador de archivos.
   - Se abrirá en tu navegador predeterminado (se recomienda Google Chrome, Microsoft Edge o Mozilla Firefox).

2. **Uso de Servidor Local (Opcional - Recomendado para desarrollo):**
   - Si utilizas Visual Studio Code, puedes abrir la carpeta completa `Formulario` y hacer clic en **"Go Live"** (extensión Live Server).
   - Esto creará un servidor local en `http://127.0.5.1:5500` que facilitará las pruebas.

---

## 💾 Persistencia de Datos (LocalStorage)

Toda la información y registros que crees se guardan automáticamente en tu navegador usando **LocalStorage**:
- **Sin base de datos externa:** No necesitas configurar servidores de bases de datos. Los datos permanecen guardados en la memoria caché del navegador de tu computador de forma indefinida.
- **Exportación:** Puedes presionar el botón **"Exportar a Excel (CSV)"** en el Panel de Registros para descargar un archivo con todo el historial de solicitudes recopilado hasta el momento.
- **Edición y Carga:** Al hacer clic en el botón de edición (ícono de lápiz) en la tabla del panel, el formulario cargará todos los datos del registro y redibujará las firmas digitales que correspondan.

---

## ✍️ Modalidades de Firmas (Digital vs. Manual)

El sistema soporta firmas mixtas independientes para los tres actores involucrados (**Oficina TIC**, **Emisor** y **Receptor**):

1. **Firma Digital (Por defecto):**
   - Habilita un panel táctil en pantalla de alta precisión (High-DPI Canvas).
   - Puedes firmar usando un lápiz digital, pantalla táctil, mouse o touchpad.
   - El trazo se guarda en formato Base64 de alta resolución y se plasma en el PDF impreso.

2. **Firma Manual:**
   - Oculta el panel táctil y exime de validación obligatoria en pantalla a ese firmante.
   - En el documento impreso o PDF generado, el sistema dibujará automáticamente un recuadro limpio con una línea punteada para que la persona firme físicamente con lápiz de pasta una vez impreso el papel.

---

## 🖨️ Instrucciones para Imprimir o Guardar en PDF

Para obtener la copia digital o física exacta que coincida con el formato oficial institucional de **2 páginas**:

1. En el panel de registro, haz clic en **Editar** en el registro correspondiente y luego en **"Imprimir / Guardar PDF"** (o presiona `Ctrl + P`).
2. Se abrirá la ventana de impresión del navegador. Configura los siguientes parámetros en el panel de impresión para asegurar la fidelidad visual:
   - **Destino:** Selecciona *"Guardar como PDF"* (para generar el archivo digital) o tu impresora física.
   - **Páginas:** Selecciona *"Todo"* (está estructurado para ocupar exactamente 2 páginas, divididas automáticamente sin cortar tablas).
   - **Diseño:** Vertical.
   - **Tamaño de Papel:** *Oficio* / *Legal* / *Folio* (configurado internamente a la medida chilena de *216mm x 330mm* para evitar que se descuadre o se generen páginas adicionales).
   - **Márgenes:** Selecciona **Ninguno** o **Por defecto** (se recomienda *Ninguno* para que los bordes de la cuadrícula queden perfectamente alineados a los bordes de la hoja).
   - **Opciones / Gráficos de Fondo:** Debe estar **ACTIVADO** (esto asegura que los fondos grises decorativos de los encabezados de las tablas se impriman).

---

*Desarrollado y mantenido por la Oficina de Tecnologías de la Información y Comunicación (TIC) - Instituto de Salud Pública de Chile.*
