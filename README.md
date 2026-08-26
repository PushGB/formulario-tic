# Gestión de Equipamiento TIC - ISP Chile (v5.5.0)

Sistema web institucional y Progressive Web App (PWA) de página única (SPA) diseñado para digitalizar y gestionar el **Formulario de Asignación, Traspaso y/o Devolución de Equipamiento Tecnológico** de la Oficina de TIC del Instituto de Salud Pública de Chile, bajo el código oficial **RG-02-IT-140.03-004 versión 5**.

🌐 **Acceso en Producción:** [https://formulario-tic.vercel.app/](https://formulario-tic.vercel.app/)

---

## 📁 Estructura del Proyecto

```text
Formulario/
│
├── index.html          # Interfaz de usuario interactiva y plantillas de impresión (HTML5)
├── manifest.json       # Manifiesto PWA para instalación nativa en Android, iOS y Windows
├── sw.js               # Service Worker v5.5.0 con caché inteligente offline y actualización continua
├── vercel.json         # Configuración de despliegue y headers para producción en Vercel
│
├── data/
│   └── catastro.json   # Catálogo precargado de 969 equipos y 879 actas en JSON instantáneo (<5ms)
│
├── css/
│   └── styles.css      # Estilos visuales personalizados y directivas CSS para impresión (@media print)
│
├── js/
│   ├── app.js          # Lógica integral: roles, canvas de firmas, catastro, PWA, QR y validaciones
│   ├── qrcode.min.js   # Generador local y autónomo de Códigos QR para actas oficiales
│   └── xlsx.full.min.js# Librería SheetJS para lectura y parsing local de archivos Excel
│
├── img/
│   ├── logo-isp.svg    # Logotipo institucional vectorizado (SVG) del ISP de Chile
│   ├── icon-192.png    # Icono PWA de alta resolución (192x192)
│   └── icon-512.png    # Icono PWA de alta resolución (512x512)
│
├── Catastro_ISP_2025_PRECARGADO.xlsx # Base de datos inicial precargada de inventario TIC
└── README.md           # Este manual de instrucciones y documentación técnica
```

---

## 📱 Progressive Web App (PWA) e Instalación Nativa

La aplicación cumple con los estándares modernos de **PWA**:
- **Instalación con 1 Clic:** Desde el menú lateral `☰` presiona **"Instalar App en el Celular"** para añadir el icono oficial a tu pantalla de inicio.
- **Modo Standalone:** Se ejecuta a pantalla completa sin barra de direcciones del navegador.
- **Soporte Offline Completo:** Gracias a `sw.js`, la aplicación funciona incluso sin conexión a internet.
- **Cero desbordamiento móvil:** Diseño adaptado con meta viewport seguro y control de overflow horizontal.

---

## 🔐 Control de Acceso y Roles (Admin / Técnico / Funcionario)

El sistema cuenta con un control de accesos por roles:
1. 👤 **Modo Funcionario (Público por Defecto):**
   - Vista aislada y confidencial: solo muestra el formulario oficial limpio para registrar datos o estampar firma receptora.
   - Oculta completamente el panel de registros, métricas y datos de otros funcionarios.
2. 💻 **Modo Técnico TIC (Operativo):**
   - Desbloquea el Panel de Registros, **Inventario de Catastro (+900 Equipos)**, Catastro Excel, Kits Rápidos, Generador de Links y Firmas TIC.
   - *(Clave por defecto: `tecnico123` o `1234`)*.
3. 🛡️ **Modo Administrador (Control Total):**
   - Acceso total a todas las funciones, métricas de avance, visor de inventario completo, eliminación de registros, exportación CSV/Excel y respaldos JSON.
   - *(Clave por defecto: `admin123` o `9999`)*.
4. 🔑 **Personalización de Contraseñas:**
   - Desde el modal de acceso, los administradores pueden definir y guardar sus propias contraseñas personalizadas en `localStorage`.

---

## 📦 Módulo de Inventario de Catastro (+900 Equipos)

- **Visor Masivo:** Visualiza los **872 computadores** (Notebooks, AIO, PCs) y **97 impresoras/scanners** precargados desde el Excel institucional.
- **Búsqueda Reactiva en Tiempo Real:** Filtra instantáneamente por Serie, Funcionario, RUT, Departamento, Modelo, Correo o Contrato (Ricoh, Netnow, Brother, etc.).
- **Filtros por Tipo, Estado y Unidad:** Selectores dinámicos con los más de 300 departamentos del ISP.
- **Asignación Rápida (1 Clic):** Botón `[ Asignar ]` en cada fila que carga automáticamente los datos del equipo y funcionario en el formulario oficial listo para firmas.
- **Paginación Ágil:** Configurable a 25, 50, 100 o Todos los equipos por página.
- **Exportación Filtrada a Excel:** Descarga planillas `.xlsx` con los resultados exactos del filtro activo.

---

## 📲 Experiencia Táctil para Teléfonos y Tablets

- **Tarjetas Táctiles Inteligentes:** En smartphones, la tabla se convierte automáticamente en tarjetas limpias con ticket, fecha, funcionario y estado.
- **Action Sheet Emergente:** Al tocar cualquier tarjeta o el botón `[ ⋮ ]`, se despliega un menú táctil inferior con botones grandes para Editar, Generar Link, Clonar, Imprimir PDF y Eliminar.
- **Barra Inferior Rápida (Bottom Bar):** Los administradores y técnicos disponen de una barra inferior fija para alternar con un toque entre Registros, Catastro (+900), Métricas y Nueva Solicitud.

---

## 💾 Persistencia y Respaldos de Datos (LocalStorage & JSON)

- **Control de Versiones:** Detección de versiones y botón verde **"Limpiar Caché"** en la barra superior.
- **Copia de Seguridad JSON:** Descarga respaldos íntegros de todos los registros y firmas digitales.
- **Restauración JSON:** Permite cargar copias de seguridad o migrar la base de datos a otro computador.
- **Exportación CSV:** Compatible directamente con Microsoft Excel para auditorías.
- **Precarga de Catastro Excel:** Integra búsqueda inteligente y autocompletado desde planillas de inventario.

---

## 🖨️ Impresión Oficial y Generación de PDF (2 Páginas)

Configuración recomendada en el diálogo de impresión (`Ctrl + P`):
- **Destino:** *Guardar como PDF* o impresora física.
- **Tamaño de Papel:** *Oficio* / *Legal* / *Folio* (216mm x 330mm).
- **Márgenes:** *Ninguno* o *Por defecto*.
- **Gráficos de Fondo:** **ACTIVADO** (para imprimir los encabezados oficiales).

---

*Desarrollado y mantenido para la Oficina de Tecnologías de la Información y Comunicación (TIC) - Instituto de Salud Pública de Chile.*
