import { createClient } from '@supabase/supabase-js';

// Inicializar Supabase Client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let supabase = null;

if (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('tu-proyecto-nuevo')) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
    console.warn("Supabase no configurado o tiene valores por defecto. Trabajando en modo local/offline.");
}

// Inicialización de Variables Globales
let submissions = [];
let activeSubmissionId = null;
let activeTab = 'dashboard';
let activeFilterType = 'All';

// Estructuras de Firmas
const drawingStates = {
    tic: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false },
    emisor: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false },
    receptor: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false }
};

// Al iniciar la página
window.addEventListener('load', () => {
    // Inicializar Tema (Claro / Oscuro)
    initTheme();

    // Inicializar Iconos Lucide
    lucide.createIcons();
    
    // Cargar datos guardados
    loadSubmissions();
    
    // Renderizar la tabla principal
    renderTable();
    
    // Configurar Listeners para las Firmas
    initSignaturePads();

    // Sincronizar dimensiones de Canvas si cambia el tamaño de pantalla
    window.addEventListener('resize', resizeAllCanvases);

    // Intentar precargar el catastro Excel desde el servidor local automáticamente
    preloadExcelData();
});

// Inicializar Tema (Oscuro / Claro)
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    updateThemeIcon();
}

function toggleTheme() {
    if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    updateThemeIcon();
    
    // Redimensionar canvases para asegurar que la firma sea nítida tras refrescar el tema
    resizeAllCanvases();
}

function updateThemeIcon() {
    const iconSpan = document.getElementById('theme-toggle-icon');
    if (document.documentElement.classList.contains('dark')) {
        iconSpan.innerHTML = '<i data-lucide="sun" class="w-5 h-5 text-amber-400"></i>';
    } else {
        iconSpan.innerHTML = '<i data-lucide="moon" class="w-5 h-5 text-slate-300"></i>';
    }
    lucide.createIcons();
}

// Cargar registros desde localStorage y sincronizar con Supabase
async function loadSubmissions() {
    // 1. Cargar caché local para renderizado instantáneo (0ms)
    const localData = localStorage.getItem('tic_equip_submissions');
    if (localData) {
        try {
            submissions = JSON.parse(localData);
        } catch (e) {
            console.error("Error al cargar registros locales", e);
            submissions = [];
        }
    } else {
        submissions = [];
    }
    updateStats();
    renderTable();

    // 2. Sincronizar en segundo plano con Supabase si está disponible (SWR)
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('solicitudes_tic')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (data) {
                // Mapear los campos de la base de datos al formato local
                const mappedSubmissions = data.map(dbRow => ({
                    id: dbRow.id,
                    fecha: dbRow.fecha,
                    ticket: dbRow.ticket,
                    funcionario: {
                        nombre: dbRow.funcionario_nombre,
                        rut: dbRow.funcionario_rut,
                        cargo: dbRow.funcionario_cargo,
                        depto: dbRow.funcionario_depto
                    },
                    tipo_solicitud: dbRow.tipo_solicitud,
                    propiedad_equipamiento: dbRow.propiedad_equipamiento,
                    equipamiento_categorias: dbRow.equipamiento_categorias,
                    otros_detalles: dbRow.otros_detalles || '',
                    traspaso: dbRow.tipo_solicitud === 'Traspaso' ? {
                        emisor_nombre: dbRow.traspaso_emisor_nombre,
                        emisor_depto: dbRow.traspaso_emisor_depto,
                        receptor_nombre: dbRow.traspaso_receptor_nombre,
                        receptor_depto: dbRow.traspaso_receptor_depto,
                        observacion: dbRow.traspaso_observacion
                    } : null,
                    equipamiento: dbRow.equipamiento,
                    accesorios: dbRow.accesorios || '',
                    observaciones_generales: dbRow.observaciones_generales || '',
                    firmas: {
                        tic_mode: dbRow.firmas_tic_mode,
                        emisor_mode: dbRow.firmas_emisor_mode,
                        receptor_mode: dbRow.firmas_receptor_mode,
                        tic: dbRow.firma_tic,
                        emisor: dbRow.firma_emisor,
                        receptor: dbRow.firma_receptor
                    }
                }));

                submissions = mappedSubmissions;
                localStorage.setItem('tic_equip_submissions', JSON.stringify(submissions));
                updateStats();
                renderTable();
                
                // Si estamos en la pestaña de métricas, volver a renderizar
                if (activeTab === 'metrics') {
                    renderMetrics();
                }
                
                // Actualizar la interfaz si hay badge de Excel
                const badge = document.getElementById('excel-status-badge');
                if (badge && loadedAllEquipments.length > 0) {
                    processWorkbookData();
                }
            }
        } catch (e) {
            console.error("Error al sincronizar con Supabase en segundo plano:", e.message);
        }
    }
}

// Guardar en localStorage
function saveSubmissionsToStorage() {
    localStorage.setItem('tic_equip_submissions', JSON.stringify(submissions));
    updateStats();
}

// Actualizar estadísticas del Dashboard
function updateStats() {
    document.getElementById('stat-total').innerText = submissions.length;
    
    const asignaciones = submissions.filter(s => s.tipo_solicitud === 'Asignacion').length;
    const traspasos = submissions.filter(s => s.tipo_solicitud === 'Traspaso').length;
    const devoluciones = submissions.filter(s => s.tipo_solicitud === 'Devolucion').length;
    
    document.getElementById('stat-asignaciones').innerText = asignaciones;
    document.getElementById('stat-traspasos').innerText = traspasos;
    document.getElementById('stat-devoluciones').innerText = devoluciones;
}

// Alternar visualización de pestañas
function switchTab(tabId) {
    activeTab = tabId;
    document.getElementById('tab-dashboard').classList.add('hidden');
    document.getElementById('tab-form-view').classList.add('hidden');
    document.getElementById('tab-metrics').classList.add('hidden');
    
    // Estilos de botones de navegación
    const btnDash = document.getElementById('nav-dashboard');
    const btnForm = document.getElementById('nav-form');
    const btnMetrics = document.getElementById('nav-metrics');
    
    btnDash.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";
    btnForm.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";
    if (btnMetrics) {
        btnMetrics.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";
    }

    if (tabId === 'dashboard') {
        document.getElementById('tab-dashboard').classList.remove('hidden');
        btnDash.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white";
        renderTable();
    } else if (tabId === 'form-view') {
        document.getElementById('tab-form-view').classList.remove('hidden');
        btnForm.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";
        // Redimensionar canvases de firma al visualizar
        setTimeout(resizeAllCanvases, 50);
    } else if (tabId === 'metrics') {
        document.getElementById('tab-metrics').classList.remove('hidden');
        if (btnMetrics) {
            btnMetrics.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";
        }
        renderMetrics();
    }
}

// Abrir un nuevo formulario vacío
function openNewForm() {
    activeSubmissionId = null;
    document.getElementById('equip-form').reset();
    
    // Restablecer estilos de validación del RUT
    const rutElement = document.getElementById('func-rut');
    rutElement.classList.remove('border-emerald-500', 'dark:border-emerald-500', 'border-rose-500', 'dark:border-rose-500', 'focus:ring-emerald-500', 'focus:ring-rose-500');
    rutElement.classList.add('border-slate-200', 'dark:border-slate-700');
    document.getElementById('rut-validation-icon').classList.add('hidden');
    document.getElementById('rut-validation-msg').classList.add('hidden');

    // Fecha por defecto hoy
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('form-fecha').value = hoy;
    
    // Limpiar tabla de equipamiento y añadir primera fila vacía
    const eqContainer = document.getElementById('equipment-rows');
    eqContainer.innerHTML = '';
    addEquipmentRow();
    
    // Establecer modos de firma por defecto a digital
    document.querySelectorAll('input[value="digital"]').forEach(input => input.checked = true);
    toggleSigMode('tic');
    toggleSigMode('emisor');
    toggleSigMode('receptor');
    
    // Limpiar firmas
    clearCanvas('tic');
    clearCanvas('emisor');
    clearCanvas('receptor');
    
    // Seccion traspaso oculta por defecto
    document.getElementById('section-traspaso').classList.add('hidden');
    
    // Ocultar botón imprimir para nuevos registros hasta que se guarden
    document.getElementById('print-btn-form').classList.add('hidden');
    
    switchTab('form-view');
}

// Formatear RUT Chileno
function formatRut(rut) {
    let valor = rut.replace(/[^0-9kK]/g, '');
    if (valor.length <= 1) return valor;
    let cuerpo = valor.slice(0, -1);
    let dv = valor.slice(-1).toUpperCase();
    
    let formateado = '';
    while (cuerpo.length > 3) {
        formateado = '.' + cuerpo.slice(-3) + formateado;
        cuerpo = cuerpo.slice(0, -3);
    }
    formateado = cuerpo + formateado;
    return formateado + '-' + dv;
}

// Algoritmo de validación del RUT (Módulo 11)
function validateRut(rut) {
    if (!rut) return false;
    const clean = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    if (clean.length < 2) return false;
    
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    
    if (!/^[0-9]+$/.test(body)) return false;
    
    let sum = 0;
    let multiplier = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body.charAt(i)) * multiplier;
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    
    let expectedDv = 11 - (sum % 11);
    if (expectedDv === 11) expectedDv = '0';
    else if (expectedDv === 10) expectedDv = 'K';
    else expectedDv = expectedDv.toString();
    
    return dv === expectedDv;
}

function handleRutInput(element) {
    element.value = formatRut(element.value);
    
    const rut = element.value;
    const isValid = validateRut(rut);
    const icon = document.getElementById('rut-validation-icon');
    const msg = document.getElementById('rut-validation-msg');
    
    if (rut.length >= 7) {
        icon.classList.remove('hidden');
        msg.classList.remove('hidden');
        if (isValid) {
            element.classList.remove('border-slate-200', 'dark:border-slate-700', 'focus:ring-indigo-500', 'border-rose-500', 'dark:border-rose-500', 'focus:ring-rose-500');
            element.classList.add('border-emerald-500', 'dark:border-emerald-500', 'focus:ring-emerald-500');
            icon.innerHTML = '<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-500"></i>';
            msg.innerText = "RUT Válido";
            msg.className = "text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 block font-semibold";
        } else {
            element.classList.remove('border-slate-200', 'dark:border-slate-700', 'focus:ring-indigo-500', 'border-emerald-500', 'dark:border-emerald-500', 'focus:ring-emerald-500');
            element.classList.add('border-rose-500', 'dark:border-rose-500', 'focus:ring-rose-500');
            icon.innerHTML = '<i data-lucide="alert-circle" class="w-4 h-4 text-rose-500"></i>';
            msg.innerText = "RUT Inválido";
            msg.className = "text-[10px] text-rose-600 dark:text-rose-455 mt-1 block font-semibold";
        }
        lucide.createIcons();
    } else {
        element.classList.remove('border-emerald-500', 'dark:border-emerald-500', 'border-rose-500', 'dark:border-rose-500', 'focus:ring-emerald-500', 'focus:ring-rose-500');
        element.classList.add('border-slate-200', 'dark:border-slate-700');
        icon.classList.add('hidden');
        msg.classList.add('hidden');
    }
}

// Alternar modo de firma (Digital / Manual)
function toggleSigMode(id) {
    const mode = document.querySelector(`input[name="sig_mode_${id}"]:checked`).value;
    const container = document.getElementById(`sig-container-${id}`);
    const placeholder = document.getElementById(`sig-manual-placeholder-${id}`);
    
    if (mode === 'digital') {
        container.classList.remove('hidden');
        placeholder.classList.add('hidden');
        setTimeout(() => resizeAllCanvases(), 50);
    } else {
        container.classList.add('hidden');
        placeholder.classList.remove('hidden');
        clearCanvas(id); // Limpiar firmas digitales previas al cambiar a manual
    }
}

// Toggle Seccion Traspaso
function toggleTraspasoSection() {
    const isTraspaso = document.querySelector('input[name="solicitud_tipo"]:checked').value === 'Traspaso';
    const section = document.getElementById('section-traspaso');
    if (isTraspaso) {
        section.classList.remove('hidden');
    } else {
        section.classList.add('hidden');
    }
}

// Tabla de Equipos Dinámica: Añadir Fila
function addEquipmentRow(data = {}) {
    const container = document.getElementById('equipment-rows');
    const rowId = 'row_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.className = "hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors border-b border-slate-100 dark:border-slate-850";
    
    tr.innerHTML = `
        <td class="p-2">
            <input type="text" name="eq_tipo" value="${data.tipo || ''}" placeholder="Ej: Notebook" required oninput="syncEquipmentCategoriesFromRows()" class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_marca" value="${data.marca || ''}" placeholder="Ej: Lenovo" required class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_modelo" value="${data.modelo || ''}" placeholder="Ej: ThinkPad L14" required class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_serie" value="${data.serie || ''}" placeholder="Ej: SPF0349A" required class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_inventario" value="${data.inventario || ''}" placeholder="Ej: ISP-2024-49" class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_obs" value="${data.observacion || ''}" placeholder="Opcional" class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs transition-all">
        </td>
        <td class="p-2 text-center no-print">
            <button type="button" onclick="removeEquipmentRow('${rowId}')" class="text-rose-500 hover:text-rose-750 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        </td>
    `;
    container.appendChild(tr);
    lucide.createIcons();
    syncEquipmentCategoriesFromRows();
}

// Eliminar fila de equipos
function removeEquipmentRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        // Evitar eliminar la última fila si queda sola
        const container = document.getElementById('equipment-rows');
        if (container.children.length > 1) {
            row.remove();
            syncEquipmentCategoriesFromRows();
        } else {
            showToast("Debe haber al menos un ítem de equipamiento en la solicitud.", "error");
        }
    }
}

// Sincronizar automáticamente las casillas de categorías de la sección 2 en base a los tipos ingresados en la sección 4
function syncEquipmentCategoriesFromRows() {
    const eqRows = document.getElementById('equipment-rows').children;
    const types = [];
    for (let tr of eqRows) {
        const input = tr.querySelector('[name="eq_tipo"]');
        if (input) {
            types.push(input.value.trim().toLowerCase());
        }
    }
    
    // Desmarcar todos los checkboxes de la sección 2 primero
    document.querySelectorAll('input[name="eq_cat"]').forEach(cb => cb.checked = false);
    
    // Marcar dinámicamente según coincidencia
    types.forEach(tipo => {
        if (!tipo) return;
        
        // Computacionales
        if (tipo === 'pc' || tipo.includes('desktop') || tipo.includes('computador')) {
            const cb = document.querySelector('input[name="eq_cat"][value="PC"]');
            if (cb) cb.checked = true;
        }
        if (tipo.includes('notebook') || tipo.includes('laptop')) {
            const cb = document.querySelector('input[name="eq_cat"][value="Notebook"]');
            if (cb) cb.checked = true;
        }
        if (tipo.includes('aio') || tipo.includes('all in one') || tipo.includes('all-in-one')) {
            const cb = document.querySelector('input[name="eq_cat"][value="All In One"]');
            if (cb) cb.checked = true;
        }
        if (tipo.includes('pantalla') || tipo.includes('monitor') || tipo.includes('display')) {
            const cb = document.querySelector('input[name="eq_cat"][value="Monitor"]');
            if (cb) cb.checked = true;
        }
        
        // Telefonía / Conectividad
        if (tipo.includes('celular') || tipo.includes('movil') || tipo.includes('smartphone')) {
            const cb = document.querySelector('input[name="eq_cat"][value="Celular"]');
            if (cb) cb.checked = true;
        }
        if (tipo.includes('telefono ip') || tipo.includes('telefono') || tipo.includes('phone')) {
            const cb = document.querySelector('input[name="eq_cat"][value="Telefono IP"]');
            if (cb) cb.checked = true;
        }
        if (tipo.includes('simcard') || tipo.includes('sim card') || tipo.includes('chip') || tipo.includes('sim')) {
            const cb = document.querySelector('input[name="eq_cat"][value="SIMCARD"]');
            if (cb) cb.checked = true;
        }
        if (tipo.includes('bam') || tipo.includes('banda ancha') || tipo.includes('modem')) {
            const cb = document.querySelector('input[name="eq_cat"][value="BAM"]');
            if (cb) cb.checked = true;
        }
    });
}

// Control de los Lienzos de Firma (Signature Pads)
function initSignaturePads() {
    const ids = ['tic', 'emisor', 'receptor'];
    
    ids.forEach(id => {
        const canvas = document.getElementById(`canvas-${id}`);
        
        // Eventos de Mouse
        canvas.addEventListener('mousedown', (e) => startDrawing(e, id));
        canvas.addEventListener('mousemove', (e) => draw(e, id));
        canvas.addEventListener('mouseup', () => stopDrawing(id));
        canvas.addEventListener('mouseleave', () => stopDrawing(id));
        
        // Eventos Táctiles para móviles/tablets
        canvas.addEventListener('touchstart', (e) => startDrawing(e, id, true));
        canvas.addEventListener('touchmove', (e) => draw(e, id, true));
        canvas.addEventListener('touchend', () => stopDrawing(id));
    });
}

function resizeAllCanvases() {
    const ids = ['tic', 'emisor', 'receptor'];
    const ratio = window.devicePixelRatio || 1;

    ids.forEach(id => {
        const canvas = document.getElementById(`canvas-${id}`);
        const container = canvas.parentElement;
        
        // Si el canvas no está visible (modo manual), no lo redimensionamos
        if (canvas.offsetParent === null) return;
        
        // Guardar contenido existente para que no se borre al redimensionar
        const tempImage = canvas.toDataURL();
        
        // Dimensiones lógicas (CSS)
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        // Ajustar resolución física interna
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        
        const ctx = canvas.getContext('2d');
        // Escalar contexto para que no tengamos que multiplicar las coordenadas a mano
        ctx.scale(ratio, ratio);
        
        // Restaurar contenido si ya había dibujado algo
        if (drawingStates[id].hasSigned) {
            const img = new Image();
            img.onload = function() {
                ctx.drawImage(img, 0, 0, width, height);
            };
            img.src = tempImage;
        } else {
            clearCanvas(id, false); // Limpiar fondo
        }

        updateSignatureFeedback(id);
    });
}

function clearCanvas(id, resetState = true) {
    const canvas = document.getElementById(`canvas-${id}`);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (resetState) {
        drawingStates[id].hasSigned = false;
        updateSignatureFeedback(id);
    }
}

function updateSignatureFeedback(id) {
    const canvas = document.getElementById(`canvas-${id}`);
    const container = canvas.parentElement;
    const hasSigned = drawingStates[id].hasSigned;
    
    let badge = container.querySelector('.sig-badge');
    if (hasSigned) {
        container.classList.remove('border-slate-200', 'dark:border-slate-700', 'hover:border-indigo-500');
        container.classList.add('border-emerald-500', 'dark:border-emerald-500');
        
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'sig-badge absolute bottom-2 right-2 bg-emerald-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider no-print shadow-sm transition-all duration-300';
            badge.innerText = 'Firmado';
            container.appendChild(badge);
        }
    } else {
        container.classList.remove('border-emerald-500', 'dark:border-emerald-500');
        container.classList.add('border-slate-200', 'dark:border-slate-700', 'hover:border-indigo-500');
        if (badge) badge.remove();
    }
}

function startDrawing(e, id, isTouch = false) {
    const canvas = document.getElementById(`canvas-${id}`);
    const state = drawingStates[id];
    state.isDrawing = true;
    
    const coords = getCoords(e, canvas, isTouch);
    state.lastX = coords.x;
    state.lastY = coords.y;
}

function draw(e, id, isTouch = false) {
    const state = drawingStates[id];
    if (!state.isDrawing) return;
    
    if (isTouch) e.preventDefault();
    
    const canvas = document.getElementById(`canvas-${id}`);
    const ctx = canvas.getContext('2d');
    const coords = getCoords(e, canvas, isTouch);
    
    ctx.beginPath();
    ctx.strokeStyle = '#0f172a'; // Tinta siempre oscura para impresión correcta
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    
    state.lastX = coords.x;
    state.lastY = coords.y;
    
    if (!state.hasSigned) {
        state.hasSigned = true;
        updateSignatureFeedback(id);
    }
}

function stopDrawing(id) {
    drawingStates[id].isDrawing = false;
}

function getCoords(e, canvas, isTouch) {
    const rect = canvas.getBoundingClientRect();
    if (isTouch) {
        const touch = e.touches[0] || e.changedTouches[0];
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    } else {
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
}

// Guardar/Crear Registro
function saveForm(event) {
    event.preventDefault();
    
    const tipo_solicitud = document.querySelector('input[name="solicitud_tipo"]:checked').value;
    const propiedad_tipo = document.querySelector('input[name="propiedad_tipo"]:checked').value;
    
    // Validar RUT chileno antes de guardar
    const rut = document.getElementById('func-rut').value.trim();
    if (!validateRut(rut)) {
        showToast("Por favor, ingrese un RUT chileno válido.", "error");
        return;
    }

    // Validar que se haya marcado al menos una categoría o llenado "Otros"
    const eqCategorias = Array.from(document.querySelectorAll('input[name="eq_cat"]:checked')).map(cb => cb.value);
    const otrosDetalles = document.getElementById('eq_otros_detalles').value.trim();
    if (eqCategorias.length === 0 && !otrosDetalles) {
        showToast("Debe marcar al menos un Tipo de Equipamiento o detallar en 'Otros'.", "error");
        return;
    }

    // Obtener registros de la tabla dinámica
    const eqRows = document.getElementById('equipment-rows').children;
    const equipamiento = [];
    for (let tr of eqRows) {
        const tipo = tr.querySelector('[name="eq_tipo"]').value.trim();
        const marca = tr.querySelector('[name="eq_marca"]').value.trim();
        const modelo = tr.querySelector('[name="eq_modelo"]').value.trim();
        const serie = tr.querySelector('[name="eq_serie"]').value.trim();
        const inventario = tr.querySelector('[name="eq_inventario"]').value.trim();
        const observacion = tr.querySelector('[name="eq_obs"]').value.trim();
        
        if (tipo && marca && modelo && serie) {
            equipamiento.push({ tipo, marca, modelo, serie, inventario, observacion });
        }
    }

    if (equipamiento.length === 0) {
        showToast("Debe ingresar los datos de al menos un equipo tecnológico.", "error");
        return;
    }

    // Obtener modos de firma
    const sigModeTic = document.querySelector('input[name="sig_mode_tic"]:checked').value;
    const sigModeEmisor = document.querySelector('input[name="sig_mode_emisor"]:checked').value;
    const sigModeReceptor = document.querySelector('input[name="sig_mode_receptor"]:checked').value;

    // Validar firmas digitales requeridas
    if (sigModeTic === 'digital' && !drawingStates.tic.hasSigned) {
        showToast("Falta la firma digital del Profesional de la Oficina TIC.", "error");
        return;
    }
    if (sigModeReceptor === 'digital' && !drawingStates.receptor.hasSigned) {
        showToast("Falta la firma digital del Funcionario Responsable Receptor.", "error");
        return;
    }
    if (tipo_solicitud === 'Traspaso' && sigModeEmisor === 'digital' && !drawingStates.emisor.hasSigned) {
        showToast("Para traspasos es obligatoria la firma del Funcionario Emisor.", "error");
        return;
    }

    // Capturar firmas como Base64 PNG
    const firma_tic = sigModeTic === 'digital' ? document.getElementById('canvas-tic').toDataURL() : null;
    const firma_emisor = (sigModeEmisor === 'digital' && drawingStates.emisor.hasSigned) ? document.getElementById('canvas-emisor').toDataURL() : null;
    const firma_receptor = sigModeReceptor === 'digital' ? document.getElementById('canvas-receptor').toDataURL() : null;

    // Construcción del Objeto de Envío
    const submissionData = {
        id: activeSubmissionId || 'sub_' + Date.now(),
        fecha: document.getElementById('form-fecha').value,
        ticket: document.getElementById('form-ticket').value.trim() || 'S/N',
        funcionario: {
            nombre: document.getElementById('func-nombre').value.trim(),
            rut: rut,
            cargo: document.getElementById('func-cargo').value.trim(),
            depto: document.getElementById('func-depto').value.trim()
        },
        tipo_solicitud: tipo_solicitud,
        propiedad_equipamiento: propiedad_tipo,
        equipamiento_categorias: eqCategorias,
        otros_detalles: otrosDetalles,
        traspaso: tipo_solicitud === 'Traspaso' ? {
            emisor_nombre: document.getElementById('traspaso-emisor-nombre').value.trim(),
            emisor_depto: document.getElementById('traspaso-emisor-depto').value.trim(),
            receptor_nombre: document.getElementById('traspaso-receptor-nombre').value.trim(),
            receptor_depto: document.getElementById('traspaso-receptor-depto').value.trim(),
            observacion: document.getElementById('traspaso-observacion').value.trim()
        } : null,
        equipamiento: equipamiento,
        accesorios: document.getElementById('form-accesorios').value.trim(),
        observaciones_generales: document.getElementById('form-observaciones').value.trim(),
        firmas: {
            tic_mode: sigModeTic,
            emisor_mode: sigModeEmisor,
            receptor_mode: sigModeReceptor,
            tic: firma_tic,
            emisor: firma_emisor,
            receptor: firma_receptor
        }
    };

    if (activeSubmissionId) {
        // Editar Registro Existente
        const idx = submissions.findIndex(s => s.id === activeSubmissionId);
        if (idx !== -1) {
            submissions[idx] = submissionData;
            showToast("Registro actualizado localmente.", "success");
        }
    } else {
        // Crear Nuevo Registro
        submissions.unshift(submissionData);
        showToast("Nuevo registro guardado localmente.", "success");
    }

    saveSubmissionsToStorage();
    activeSubmissionId = submissionData.id;

    // Sincronizar en caliente con Supabase
    if (supabase) {
        const dbRow = {
            id: submissionData.id,
            fecha: submissionData.fecha,
            ticket: submissionData.ticket,
            funcionario_nombre: submissionData.funcionario.nombre,
            funcionario_rut: submissionData.funcionario.rut,
            funcionario_cargo: submissionData.funcionario.cargo,
            funcionario_depto: submissionData.funcionario.depto,
            tipo_solicitud: submissionData.tipo_solicitud,
            propiedad_equipamiento: submissionData.propiedad_equipamiento,
            equipamiento_categorias: submissionData.equipamiento_categorias,
            otros_detalles: submissionData.otros_detalles,
            traspaso_emisor_nombre: submissionData.traspaso ? submissionData.traspaso.emisor_nombre : null,
            traspaso_emisor_depto: submissionData.traspaso ? submissionData.traspaso.emisor_depto : null,
            traspaso_receptor_nombre: submissionData.traspaso ? submissionData.traspaso.receptor_nombre : null,
            traspaso_receptor_depto: submissionData.traspaso ? submissionData.traspaso.receptor_depto : null,
            traspaso_observacion: submissionData.traspaso ? submissionData.traspaso.observacion : null,
            equipamiento: submissionData.equipamiento,
            accesorios: submissionData.accesorios,
            observaciones_generales: submissionData.observaciones_generales,
            firmas_tic_mode: submissionData.firmas.tic_mode,
            firmas_emisor_mode: submissionData.firmas.emisor_mode,
            firmas_receptor_mode: submissionData.firmas.receptor_mode,
            firma_tic: submissionData.firmas.tic,
            firma_emisor: submissionData.firmas.emisor,
            firma_receptor: submissionData.firmas.receptor
        };

        supabase
            .from('solicitudes_tic')
            .upsert(dbRow)
            .then(({ error }) => {
                if (error) {
                    console.error("Error al guardar en Supabase:", error.message);
                    showToast("Guardado localmente. Error al sincronizar con la nube.", "error");
                } else {
                    showToast("Registro guardado y sincronizado con la nube.", "success");
                }
            })
            .catch(err => {
                console.error("Error de conexión al guardar en Supabase:", err);
                showToast("Guardado localmente. Error de conexión con la nube.", "error");
            });
    }
    
    // Habilitar impresión tras guardar exitosamente
    document.getElementById('print-btn-form').classList.remove('hidden');
    
    // Regresar al dashboard después de un corto retardo para visualización
    setTimeout(() => {
        switchTab('dashboard');
    }, 1000);
}

// Sincronizar los datos del formulario web interactivo al documento oficial de impresión
function syncPrintTemplate() {
    // Rellenar fecha y ticket
    document.getElementById('print-header-fecha').innerText = document.getElementById('form-fecha').value || '-';
    document.getElementById('print-header-ticket').innerText = document.getElementById('form-ticket').value.trim() || 'S/N';
    
    // Rellenar datos funcionario
    document.getElementById('print-func-nombre').innerText = document.getElementById('func-nombre').value.trim() || '-';
    document.getElementById('print-func-rut').innerText = document.getElementById('func-rut').value.trim() || '-';
    document.getElementById('print-func-cargo').innerText = document.getElementById('func-cargo').value.trim() || '-';
    document.getElementById('print-func-depto').innerText = document.getElementById('func-depto').value.trim() || '-';
    
    // Seccion 2 checkboxes
    const solicitudTipo = document.querySelector('input[name="solicitud_tipo"]:checked').value;
    const propiedadTipo = document.querySelector('input[name="propiedad_tipo"]:checked').value;
    
    document.getElementById('print-solicitud-asignacion').querySelector('span').innerText = solicitudTipo === 'Asignacion' ? 'X' : '';
    document.getElementById('print-solicitud-traspaso').querySelector('span').innerText = solicitudTipo === 'Traspaso' ? 'X' : '';
    document.getElementById('print-solicitud-devolucion').querySelector('span').innerText = solicitudTipo === 'Devolucion' ? 'X' : '';
    
    document.getElementById('print-propiedad-arriendo').querySelector('span').innerText = propiedadTipo === 'En Arriendo' ? 'X' : '';
    document.getElementById('print-propiedad-isp').querySelector('span').innerText = propiedadTipo === 'Propiedad ISP' ? 'X' : '';
    
    // Checkboxes equipamiento
    const eqCats = Array.from(document.querySelectorAll('input[name="eq_cat"]:checked')).map(cb => cb.value);
    const allCats = ['pc', 'notebook', 'aio', 'monitor', 'celular', 'telefonoip', 'simcard', 'bam'];
    allCats.forEach(cat => {
        const el = document.getElementById(`print-eq-cat-${cat}`);
        if (el) {
            let valToMatch = '';
            if (cat === 'pc') valToMatch = 'PC';
            else if (cat === 'notebook') valToMatch = 'Notebook';
            else if (cat === 'aio') valToMatch = 'All In One';
            else if (cat === 'monitor') valToMatch = 'Monitor';
            else if (cat === 'celular') valToMatch = 'Celular';
            else if (cat === 'telefonoip') valToMatch = 'Telefono IP';
            else if (cat === 'simcard') valToMatch = 'SIMCARD';
            else if (cat === 'bam') valToMatch = 'BAM';
            
            const isChecked = eqCats.includes(valToMatch);
            el.querySelector('span').innerText = isChecked ? 'X' : '';
        }
    });
    
    // Otros detalles
    document.getElementById('print-eq-otros-val').innerText = document.getElementById('eq_otros_detalles').value.trim() || '-';
    
    // Seccion 3: Traspaso
    const isTraspaso = solicitudTipo === 'Traspaso';
    document.getElementById('print-traspaso-emisor-nombre').innerText = isTraspaso ? (document.getElementById('traspaso-emisor-nombre').value.trim() || '-') : '-';
    document.getElementById('print-traspaso-receptor-nombre').innerText = isTraspaso ? (document.getElementById('traspaso-receptor-nombre').value.trim() || '-') : '-';
    document.getElementById('print-traspaso-emisor-depto').innerText = isTraspaso ? (document.getElementById('traspaso-emisor-depto').value.trim() || '-') : '-';
    document.getElementById('print-traspaso-receptor-depto').innerText = isTraspaso ? (document.getElementById('traspaso-receptor-depto').value.trim() || '-') : '-';
    document.getElementById('print-traspaso-obs').innerText = isTraspaso ? (document.getElementById('traspaso-observacion').value.trim() || '-') : '-';
    
    // Seccion 4: Tabla de equipos
    const printEqTableBody = document.getElementById('print-equipment-rows');
    printEqTableBody.innerHTML = '';
    
    const eqRows = document.getElementById('equipment-rows').children;
    const items = [];
    for (let tr of eqRows) {
        const tipo = tr.querySelector('[name="eq_tipo"]').value.trim();
        const marca = tr.querySelector('[name="eq_marca"]').value.trim();
        const modelo = tr.querySelector('[name="eq_modelo"]').value.trim();
        const serie = tr.querySelector('[name="eq_serie"]').value.trim();
        const inventario = tr.querySelector('[name="eq_inventario"]').value.trim();
        const obs = tr.querySelector('[name="eq_obs"]').value.trim();
        
        if (tipo || marca || modelo || serie) {
            items.push({ tipo, marca, modelo, serie, inventario, obs });
        }
    }
    
    // Dibujar mínimo 3 filas para conservar la visualización oficial
    const rowsToDraw = Math.max(3, items.length);
    for (let i = 0; i < rowsToDraw; i++) {
        const item = items[i] || { tipo: '', marca: '', modelo: '', serie: '', inventario: '', obs: '' };
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.tipo || '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.marca || '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.modelo || '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-mono print-calibri-12">${item.serie || '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-mono print-calibri-12">${item.inventario || '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.obs || '&nbsp;'}</td>
        `;
        printEqTableBody.appendChild(tr);
    }
    
    // Accesorios y Observaciones
    document.getElementById('print-accesorios').innerText = document.getElementById('form-accesorios').value.trim() || 'Sin accesorios registrados.';
    document.getElementById('print-observaciones').innerText = document.getElementById('form-observaciones').value.trim() || 'Sin observaciones.';
    
    // Renderizar firmas de acuerdo a la modalidad
    const sigModeTic = document.querySelector('input[name="sig_mode_tic"]:checked').value;
    const sigModeEmisor = document.querySelector('input[name="sig_mode_emisor"]:checked').value;
    const sigModeReceptor = document.querySelector('input[name="sig_mode_receptor"]:checked').value;
    
    // TIC (Pagina 1)
    const imgTic = document.getElementById('print-sig-tic-img');
    if (sigModeTic === 'digital' && drawingStates.tic.hasSigned) {
        imgTic.src = document.getElementById('canvas-tic').toDataURL();
        imgTic.classList.remove('hidden');
    } else {
        imgTic.src = '';
        imgTic.classList.add('hidden');
    }
    
    // Emisor (Pagina 2)
    const imgEmisor = document.getElementById('print-sig-emisor-img');
    if (sigModeEmisor === 'digital' && drawingStates.emisor.hasSigned) {
        imgEmisor.src = document.getElementById('canvas-emisor').toDataURL();
        imgEmisor.classList.remove('hidden');
    } else {
        imgEmisor.src = '';
        imgEmisor.classList.add('hidden');
    }
    
    // Receptor (Pagina 2)
    const imgReceptor = document.getElementById('print-sig-receptor-img');
    if (sigModeReceptor === 'digital' && drawingStates.receptor.hasSigned) {
        imgReceptor.src = document.getElementById('canvas-receptor').toDataURL();
        imgReceptor.classList.remove('hidden');
    } else {
        imgReceptor.src = '';
        imgReceptor.classList.add('hidden');
    }
}

// Filtro por tipo desde los botones del dashboard
function setFilterType(type) {
    activeFilterType = type;
    
    const types = ['All', 'Asignacion', 'Traspaso', 'Devolucion'];
    types.forEach(t => {
        const btn = document.getElementById(`filter-${t.toLowerCase()}`);
        if (t === type) {
            btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-indigo-650 dark:bg-indigo-600 text-white shadow-sm";
        } else {
            btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700";
        }
    });
    
    renderTable();
}

// Renderizar la tabla del Dashboard con Filtros de Búsqueda y de Tipo
function renderTable() {
    const search = document.getElementById('search-input').value.toLowerCase().trim();
    const tbody = document.getElementById('submissions-list');
    const emptyState = document.getElementById('empty-state');
    
    tbody.innerHTML = '';
    
    const filtered = submissions.filter(s => {
        // Filtro por Tipo de Solicitud (Categoría de Botón)
        if (activeFilterType !== 'All' && s.tipo_solicitud !== activeFilterType) {
            return false;
        }

        // Filtro por Texto de Búsqueda
        const matchNombre = s.funcionario.nombre.toLowerCase().includes(search);
        const matchRut = s.funcionario.rut.toLowerCase().includes(search);
        const matchTicket = s.ticket.toLowerCase().includes(search);
        const matchTipo = s.tipo_solicitud.toLowerCase().includes(search);
        const matchSerie = s.equipamiento.some(e => e.serie.toLowerCase().includes(search));
        return matchNombre || matchRut || matchTicket || matchTipo || matchSerie;
    });

    if (filtered.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        
        filtered.forEach(s => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-100 dark:border-slate-800/60";
            
            let badgesSolicitud = '';
            if (s.tipo_solicitud === 'Asignacion') {
                badgesSolicitud = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-450"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Asignación</span>';
            } else if (s.tipo_solicitud === 'Traspaso') {
                badgesSolicitud = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-450"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Traspaso</span>';
            } else {
                badgesSolicitud = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-455"><span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>Devolución</span>';
            }

            // Formatear resumen de equipos para la columna
            const eqSummary = s.equipamiento.map(e => `${e.tipo} (${e.marca} ${e.modelo})`).join(', ');

            tr.innerHTML = `
                <td class="py-4 px-6 font-medium text-slate-900 dark:text-slate-100">${s.fecha}</td>
                <td class="py-4 px-6 font-mono text-xs text-indigo-650 dark:text-indigo-400 font-semibold">${s.ticket}</td>
                <td class="py-4 px-6">
                    <div class="font-medium text-slate-850 dark:text-slate-200">${s.funcionario.nombre}</div>
                    <div class="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">${s.funcionario.rut}</div>
                </td>
                <td class="py-4 px-6">${badgesSolicitud}</td>
                <td class="py-4 px-6 max-w-xs truncate text-slate-500 dark:text-slate-450" title="${eqSummary}">${eqSummary}</td>
                <td class="py-4 px-6 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="viewAndEditForm('${s.id}')" class="p-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors" title="Ver / Editar">
                            <i data-lucide="edit" class="w-4.5 h-4.5"></i>
                        </button>
                        <button onclick="deleteSubmission('${s.id}')" class="p-2 text-rose-500 hover:text-rose-755 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors" title="Eliminar">
                            <i data-lucide="trash-2" class="w-4.5 h-4.5"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    lucide.createIcons();
}

// Cargar un registro para editarlo o imprimirlo
function viewAndEditForm(id) {
    const s = submissions.find(sub => sub.id === id);
    if (!s) return;

    activeSubmissionId = s.id;
    
    // Rellenar cabecera
    document.getElementById('form-fecha').value = s.fecha;
    document.getElementById('form-ticket').value = s.ticket === 'S/N' ? '' : s.ticket;
    
    // Rellenar sección 1 y disparar validación visual de RUT
    const rutField = document.getElementById('func-rut');
    document.getElementById('func-nombre').value = s.funcionario.nombre;
    rutField.value = s.funcionario.rut;
    handleRutInput(rutField);
    
    document.getElementById('func-cargo').value = s.funcionario.cargo;
    document.getElementById('func-depto').value = s.funcionario.depto;

    // Rellenar sección 2: Solicitud y propiedad
    document.querySelector(`input[name="solicitud_tipo"][value="${s.tipo_solicitud}"]`).checked = true;
    document.querySelector(`input[name="propiedad_tipo"][value="${s.propiedad_equipamiento}"]`).checked = true;
    
    // Desmarcar todos y re-marcar
    document.querySelectorAll('input[name="eq_cat"]').forEach(cb => cb.checked = false);
    s.equipamiento_categorias.forEach(cat => {
        const cb = document.querySelector(`input[name="eq_cat"][value="${cat}"]`);
        if (cb) cb.checked = true;
    });
    document.getElementById('eq_otros_detalles').value = s.otros_detalles || '';

    // Seccion traspaso
    toggleTraspasoSection();
    if (s.tipo_solicitud === 'Traspaso' && s.traspaso) {
        document.getElementById('traspaso-emisor-nombre').value = s.traspaso.emisor_nombre || '';
        document.getElementById('traspaso-emisor-depto').value = s.traspaso.emisor_depto || '';
        document.getElementById('traspaso-receptor-nombre').value = s.traspaso.receptor_nombre || '';
        document.getElementById('traspaso-receptor-depto').value = s.traspaso.receptor_depto || '';
        document.getElementById('traspaso-observacion').value = s.traspaso.observacion || '';
    }

    // Rellenar equipamiento en tabla
    const container = document.getElementById('equipment-rows');
    container.innerHTML = '';
    s.equipamiento.forEach(eq => {
        addEquipmentRow(eq);
    });

    // Rellenar comentarios
    document.getElementById('form-accesorios').value = s.accesorios || '';
    document.getElementById('form-observaciones').value = s.observaciones_generales || '';

    // Rellenar modos de firma (Digital vs Manual)
    const sigModes = s.firmas || { tic_mode: 'digital', emisor_mode: 'digital', receptor_mode: 'digital' };
    document.querySelector(`input[name="sig_mode_tic"][value="${sigModes.tic_mode || 'digital'}"]`).checked = true;
    document.querySelector(`input[name="sig_mode_emisor"][value="${sigModes.emisor_mode || 'digital'}"]`).checked = true;
    document.querySelector(`input[name="sig_mode_receptor"][value="${sigModes.receptor_mode || 'digital'}"]`).checked = true;
    
    toggleSigMode('tic');
    toggleSigMode('emisor');
    toggleSigMode('receptor');

    // Habilitar impresión porque ya existe registro guardado
    document.getElementById('print-btn-form').classList.remove('hidden');

    // Renderizar firmas guardadas en canvas
    switchTab('form-view');
    
    setTimeout(() => {
        resizeAllCanvases();
        setTimeout(() => {
            if (sigModes.tic_mode === 'digital') drawSavedSignature('tic', s.firmas.tic);
            if (sigModes.emisor_mode === 'digital') drawSavedSignature('emisor', s.firmas.emisor);
            if (sigModes.receptor_mode === 'digital') drawSavedSignature('receptor', s.firmas.receptor);
        }, 120);
    }, 120);
}

// Función para renderizar firmas almacenadas en los paneles canvas respetando devicePixelRatio
function drawSavedSignature(id, dataUrl) {
    if (!dataUrl) {
        clearCanvas(id);
        return;
    }
    const canvas = document.getElementById(`canvas-${id}`);
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const img = new Image();
    img.onload = function() {
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.width / ratio;
        const height = canvas.height / ratio;
        ctx.drawImage(img, 0, 0, width, height);
        drawingStates[id].hasSigned = true;
        updateSignatureFeedback(id);
    };
    img.src = dataUrl;
}

// Eliminar Registro
async function deleteSubmission(id) {
    if (confirm("¿Está seguro de que desea eliminar permanentemente este registro del historial local y la nube?")) {
        submissions = submissions.filter(s => s.id !== id);
        if (activeSubmissionId === id) {
            activeSubmissionId = null;
        }
        saveSubmissionsToStorage();
        renderTable();
        
        if (supabase) {
            try {
                const { error } = await supabase
                    .from('solicitudes_tic')
                    .delete()
                    .eq('id', id);
                
                if (error) throw error;
                showToast("Registro eliminado de local y de la nube.", "success");
            } catch (e) {
                console.error("Error al eliminar de Supabase:", e.message);
                showToast("Eliminado localmente. Error al eliminar en la nube.", "error");
            }
        } else {
            showToast("Registro eliminado localmente.", "success");
        }
    }
}

// Exportar toda la base de datos local a un CSV amigable con Excel
function exportToCSV() {
    if (submissions.length === 0) {
        showToast("No hay registros en el historial para exportar.", "error");
        return;
    }

    let csvContent = "\uFEFF"; // Byte Order Mark (BOM) para acentos en Excel
    
    // Encabezados
    csvContent += "ID,Fecha Solicitud,N° Ticket,Funcionario Receptor,RUT Receptor,Cargo,Depto Receptor,Tipo Solicitud,Propiedad Equipamiento,Categorías,Otros Detalles,Traspaso Emisor,Traspaso Emisor Depto,Traspaso Observación,Equipos Detalle,Accesorios Incluidos,Observaciones Generales\r\n";

    submissions.forEach(s => {
        const equiposDetalleStr = s.equipamiento.map(e => `${e.tipo} [Marca: ${e.marca} Mod: ${e.modelo} Serie: ${e.serie} Inv: ${e.inventario || 'S/N'} Obs: ${e.observacion || 'Ninguna'}]`).join(' | ');
        
        const fila = [
            s.id,
            s.fecha,
            s.ticket,
            `"${s.funcionario.nombre.replace(/"/g, '""')}"`,
            s.funcionario.rut,
            `"${s.funcionario.cargo.replace(/"/g, '""')}"`,
            `"${s.funcionario.depto.replace(/"/g, '""')}"`,
            s.tipo_solicitud,
            s.propiedad_equipamiento,
            `"${s.equipamiento_categorias.join(', ')}"`,
            `"${(s.otros_detalles || '').replace(/"/g, '""')}"`,
            s.traspaso ? `"${s.traspaso.emisor_nombre.replace(/"/g, '""')}"` : 'N/A',
            s.traspaso ? `"${s.traspaso.emisor_depto.replace(/"/g, '""')}"` : 'N/A',
            s.traspaso ? `"${s.traspaso.observacion.replace(/"/g, '""')}"` : 'N/A',
            `"${equiposDetalleStr.replace(/"/g, '""')}"`,
            `"${(s.accesorios || '').replace(/"/g, '""')}"`,
            `"${(s.observaciones_generales || '').replace(/"/g, '""')}"`
        ];
        
        csvContent += fila.join(",") + "\r\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `TIC_Registro_Traspasos_ISP_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("Historial exportado correctamente para abrir en Microsoft Excel.", "success");
}

// Trigger del modo impresión optimizado
function triggerPrintMode() {
    syncPrintTemplate();
    window.print();
}

// Mostrar Notificaciones (Toasts) personalizadas sin usar alert() molestos
function showToast(message, type = "success") {
    const toast = document.getElementById('toast');
    const iconSpan = document.getElementById('toast-icon');
    const msgSpan = document.getElementById('toast-message');
    
    msgSpan.innerText = message;
    
    if (type === 'success') {
        iconSpan.innerHTML = '<i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-450"></i>';
    } else {
        iconSpan.innerHTML = '<i data-lucide="x-circle" class="w-5 h-5 text-rose-400"></i>';
    }
    
    lucide.createIcons();
    
    toast.classList.remove('translate-y-10', 'opacity-0', 'pointer-events-none');
    toast.classList.add('translate-y-0', 'opacity-100');
    
    setTimeout(() => {
        toast.classList.add('translate-y-10', 'opacity-0', 'pointer-events-none');
        toast.classList.remove('translate-y-0', 'opacity-100');
    }, 3500);
}

// ================= INTEGRACIÓN Y AUTOMATIZACIÓN CON EXCEL =================
let uploadedWorkbook = null;
let loadedAllEquipments = [];

// Normalizar claves para que sean robustas contra espacios, nuevas líneas y acentos
function normalizeKey(key) {
    if (typeof key !== 'string') return '';
    return key.toLowerCase()
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar acentos
              .replace(/[\s\r\n\t]+/g, '')                     // quitar espacios y saltos de línea
              .replace(/[^a-z0-9]/g, '');                      // mantener solo caracteres alfanuméricos
}

// Convertir fila genérica a un formato estructurado y limpio
function cleanRowData(row, sourceSheet) {
    const cleaned = {
        n: '',
        inventario: '',
        serie: '',
        tipo: '',
        marca: '',
        modelo: '',
        propiedad: '',
        funcionario: '',
        mail: '',
        depto: '',
        estado: '',
        observaciones: '',
        _originalRow: row // Referencia original
    };
    
    for (let key in row) {
        const norm = normalizeKey(key);
        const val = String(row[key] || '').trim();
        if (norm === 'n') cleaned.n = val;
        else if (norm === 'ninventarioisp') cleaned.inventario = val;
        else if (norm === 'nserie') cleaned.serie = val;
        else if (norm === 'tipopcnotebookaio' || norm === 'tipoimpresorascannermfp') cleaned.tipo = val;
        else if (norm === 'marca') cleaned.marca = val;
        else if (norm === 'modelo') cleaned.modelo = val;
        else if (norm === 'propiedadarriendoisp') cleaned.propiedad = val;
        else if (norm === 'funcionarioa') cleaned.funcionario = val;
        else if (norm === 'mail') cleaned.mail = val;
        else if (norm === 'unidaddepto') cleaned.depto = val;
        else if (norm === 'estado') cleaned.estado = val;
        else if (norm === 'observaciones') cleaned.observaciones = val;
    }
    cleaned.sheet = sourceSheet;
    return cleaned;
}

// Asignar valor a celda en SheetJS (conservando el formato original del libro de trabajo)
function setCellValue(sheet, rowIdx, colIdx, val) {
    const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
    if (!sheet[cellRef]) {
        sheet[cellRef] = { t: 's', v: '' };
    }
    const cell = sheet[cellRef];
    
    if (typeof val === 'number') {
        cell.t = 'n';
        cell.v = val;
    } else if (typeof val === 'boolean') {
        cell.t = 'b';
        cell.v = val;
    } else {
        cell.t = 's';
        cell.v = String(val);
    }
}

// Actualizar el rango "!ref" de la hoja si los nuevos datos superan el tamaño inicial
function updateSheetRange(sheet, maxRowIndex) {
    if (!sheet['!ref']) return;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (maxRowIndex > range.e.r) {
        range.e.r = maxRowIndex;
        sheet['!ref'] = XLSX.utils.encode_range(range);
    }
}

// Actualizar el estado y observaciones de un equipo en su correspondiente fila original
function updateEquipmentStatusInSheet(sheet, range, serialNumber, statusValue, observationValue, estadoColIndex, obsColIndex) {
    const startRow = 4; // Fila 5 es índice 4 (después de cabeceras)
    const endRow = range.e.r;
    let found = false;
    
    for (let r = startRow; r <= endRow; r++) {
        const serialCellRef = XLSX.utils.encode_cell({ r: r, c: 2 }); // Columna C (N° Serie) es índice 2
        const serialCell = sheet[serialCellRef];
        if (serialCell && serialCell.v) {
            const currentSerial = String(serialCell.v).trim().toLowerCase();
            if (currentSerial === serialNumber.trim().toLowerCase()) {
                setCellValue(sheet, r, estadoColIndex, statusValue);
                setCellValue(sheet, r, obsColIndex, observationValue);
                found = true;
            }
        }
    }
    return found;
}

// Cargar y procesar el archivo Excel subido por el usuario
function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            uploadedWorkbook = XLSX.read(data, { type: 'array' });
            
            processWorkbookData();
            
            showToast("Planilla Excel cargada y lista para auto-relleno.", "success");
            
        } catch (error) {
            console.error("Error al procesar Excel:", error);
            showToast("Error al procesar el archivo Excel. Verifique que sea el formato correcto.", "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

// Intentar precargar el catastro Excel automáticamente desde el servidor local al iniciar la app
function preloadExcelData() {
    fetch('Catastro_ISP_2025_PRECARGADO.xlsx')
        .then(response => {
            if (!response.ok) {
                throw new Error("No se pudo cargar el archivo automáticamente.");
            }
            return response.arrayBuffer();
        })
        .then(buffer => {
            const data = new Uint8Array(buffer);
            uploadedWorkbook = XLSX.read(data, { type: 'array' });
            processWorkbookData();
            console.log("Excel catastral precargado de forma automática.");
        })
        .catch(err => {
            console.warn("Precarga automática de Excel omitida (puede deberse a abrir mediante file:// o archivo inexistente):", err.message);
        });
}

// Procesar el libro de Excel cargado (computadores, impresoras y registros catastrados existentes)
function processWorkbookData() {
    if (!uploadedWorkbook) return;

    // 1. Procesar Hoja de Computadores para auto-relleno
    const compSheet = uploadedWorkbook.Sheets['Computadores'];
    let computers = [];
    if (compSheet) {
        const compRows = XLSX.utils.sheet_to_json(compSheet, { range: 3 });
        computers = compRows
            .filter(row => {
                const serie = row['N° Serie'] || row['N° de Serie'] || row['Serie'];
                return serie && String(serie).trim().length > 0 && !String(serie).startsWith('▶');
            })
            .map(row => cleanRowData(row, 'Computadores'));
    }
    
    // 2. Procesar Hoja de Impresoras-Scanner para auto-relleno
    const printerSheet = uploadedWorkbook.Sheets['Impresoras-Scanner'];
    let printers = [];
    if (printerSheet) {
        const printerRows = XLSX.utils.sheet_to_json(printerSheet, { range: 3 });
        printers = printerRows
            .filter(row => {
                const serie = row['N° Serie'] || row['N° de Serie'] || row['Serie'];
                return serie && String(serie).trim().length > 0 && !String(serie).startsWith('▶');
            })
            .map(row => cleanRowData(row, 'Impresoras-Scanner'));
    }
    
    loadedAllEquipments = [...computers, ...printers];
    
    // 3. Procesar Hoja de Equipos para importar registros ya catastrados
    const equiposSheet = uploadedWorkbook.Sheets['Equipos'];
    let importedCount = 0;
    if (equiposSheet) {
        const rawEquipos = XLSX.utils.sheet_to_json(equiposSheet);
        
        // Agrupar filas de catastro por Funcionario
        const grouped = {};
        rawEquipos.forEach(item => {
            const nombre = item['Nombre Funcionario'] || item['Nombre'];
            const serie = item['Serie'] || item['N° Serie'];
            
            // Omitir filas vacías de la plantilla
            if (!nombre || String(nombre).trim().length === 0 || !serie || String(serie).trim().length === 0) {
                return;
            }
            
            const key = String(nombre).trim().toLowerCase();
            if (!grouped[key]) {
                grouped[key] = {
                    nombre: String(nombre).trim(),
                    rut: String(item['Rut'] || '').trim(),
                    cargo: String(item['Cargo'] || '').trim(),
                    depto: String(item['Departamento'] || '').trim(),
                    propiedad: item['EsInventario'] === true || String(item['EsInventario']).toLowerCase() === 'true' ? 'Propiedad ISP' : 'En Arriendo',
                    equipos: []
                };
            }
            
            const rawEq = {
                tipo: String(item['Tipo (AIO Notebook o Pantalla)'] || 'Equipo').trim(),
                marca: String(item['Marca'] || '').trim(),
                modelo: String(item['Modelo'] || '').trim(),
                serie: String(serie).trim(),
                inventario: String(item['Nº Inventario'] || item['N° Inventario'] || '').trim(),
                observacion: String(item['Observacion'] || '').trim()
            };
            const splitEqs = splitEquipmentIfCombined(rawEq);
            splitEqs.forEach(eq => {
                grouped[key].equipos.push(eq);
            });
        });
        
        // Crear las solicitudes agrupadas en LocalStorage
        Object.keys(grouped).forEach(key => {
            const group = grouped[key];
            // ID determinista basado en el nombre para evitar duplicar si se carga múltiples veces
            const subId = 'sub_excel_' + key.replace(/[^a-z0-9]/g, '_');
            
            if (submissions.some(s => s.id === subId)) return;
            
            const sub = {
                id: subId,
                fecha: new Date().toISOString().split('T')[0],
                ticket: 'S/N',
                funcionario: {
                    nombre: group.nombre,
                    rut: group.rut,
                    cargo: group.cargo,
                    depto: group.depto
                },
                tipo_solicitud: 'Asignacion',
                propiedad_equipamiento: group.propiedad,
                equipamiento_categorias: [],
                otros_detalles: '',
                traspaso: null,
                equipamiento: group.equipos,
                accesorios: '',
                observaciones_generales: '',
                firmas: {
                    tic_mode: 'manual',
                    emisor_mode: 'manual',
                    receptor_mode: 'manual',
                    tic: null,
                    emisor: null,
                    receptor: null
                }
            };
            
            // Deducir categorías en base a todos los equipos cargados
            group.equipos.forEach(eq => {
                const tipoLower = eq.tipo.toLowerCase();
                
                // Usar condicionales independientes (no else-if) para marcar múltiples categorías
                if (tipoLower === 'pc' || tipoLower.includes('desktop') || tipoLower.includes('computador') || tipoLower.includes('torre')) {
                    if (!sub.equipamiento_categorias.includes('PC')) {
                        sub.equipamiento_categorias.push('PC');
                    }
                }
                if (tipoLower.includes('notebook') || tipoLower.includes('laptop')) {
                    if (!sub.equipamiento_categorias.includes('Notebook')) {
                        sub.equipamiento_categorias.push('Notebook');
                    }
                }
                if (tipoLower.includes('aio') || tipoLower.includes('all in one') || tipoLower.includes('all-in-one')) {
                    if (!sub.equipamiento_categorias.includes('All In One')) {
                        sub.equipamiento_categorias.push('All In One');
                    }
                }
                if (tipoLower.includes('pantalla') || tipoLower.includes('monitor') || tipoLower.includes('display')) {
                    if (!sub.equipamiento_categorias.includes('Monitor')) {
                        sub.equipamiento_categorias.push('Monitor');
                    }
                }
                
                // Telefonía / Conectividad
                if (tipoLower.includes('celular') || tipoLower.includes('movil') || tipoLower.includes('smartphone')) {
                    if (!sub.equipamiento_categorias.includes('Celular')) {
                        sub.equipamiento_categorias.push('Celular');
                    }
                }
                if (tipoLower.includes('telefono ip') || tipoLower.includes('telefono') || tipoLower.includes('phone')) {
                    if (!sub.equipamiento_categorias.includes('Telefono IP')) {
                        sub.equipamiento_categorias.push('Telefono IP');
                    }
                }
                if (tipoLower.includes('simcard') || tipoLower.includes('sim card') || tipoLower.includes('chip') || tipoLower.includes('sim')) {
                    if (!sub.equipamiento_categorias.includes('SIMCARD')) {
                        sub.equipamiento_categorias.push('SIMCARD');
                    }
                }
                if (tipoLower.includes('bam') || tipoLower.includes('banda ancha') || tipoLower.includes('modem')) {
                    if (!sub.equipamiento_categorias.includes('BAM')) {
                        sub.equipamiento_categorias.push('BAM');
                    }
                }
            });
            
            submissions.push(sub);
            importedCount++;
        });
        
        if (importedCount > 0) {
            saveSubmissionsToStorage();
            renderTable();
        }
    }
    
    // 4. Actualizar estado de interfaz
    const badge = document.getElementById('excel-status-badge');
    if (badge) {
        let text = `Catastro Excel Precargado: ${computers.length} Computadores y ${printers.length} Impresoras/Scanners disponibles.`;
        if (importedCount > 0) {
            text += ` Se importaron ${importedCount} registros ya catastrados al historial.`;
        }
        badge.innerHTML = `
            <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-450 border border-emerald-200/50 dark:border-emerald-800 text-xs font-semibold">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                ${text}
            </div>
        `;
    }
    
    // Mostrar controles relacionados
    const searchContainer = document.getElementById('excel-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');
    
    const exportBtn = document.getElementById('excel-export-btn');
    if (exportBtn) exportBtn.classList.remove('hidden');
}

// Mostrar sugerencias de auto-completado en base a la consulta de búsqueda
function showExcelSuggestions(query) {
    const dropdown = document.getElementById('excel-suggestions-dropdown');
    dropdown.innerHTML = '';
    
    if (!query || query.trim().length < 2) {
        dropdown.classList.add('hidden');
        return;
    }
    
    const term = query.toLowerCase().trim();
    const matches = [];
    
    for (let i = 0; i < loadedAllEquipments.length; i++) {
        const item = loadedAllEquipments[i];
        const matchFunc = (item.funcionario || '').toLowerCase().includes(term);
        const matchSerie = (item.serie || '').toLowerCase().includes(term);
        const matchInv = (item.inventario || '').toLowerCase().includes(term);
        const matchMail = (item.mail || '').toLowerCase().includes(term);
        
        if (matchFunc || matchSerie || matchInv || matchMail) {
            matches.push({ index: i, item: item });
        }
        if (matches.length >= 10) break; // Límite de 10 sugerencias
    }
    
    if (matches.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-center text-slate-450">No se encontraron coincidencias en el catastro.</div>';
        dropdown.classList.remove('hidden');
        return;
    }
    
    matches.forEach(match => {
        const item = match.item;
        const div = document.createElement('div');
        div.className = "p-3 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors flex justify-between items-center";
        div.onclick = () => selectExcelSuggestion(match.index);
        
        const badgeClass = item.sheet === 'Computadores' 
            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' 
            : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400';
            
        div.innerHTML = `
            <div>
                <div class="font-bold text-slate-800 dark:text-slate-200">${item.funcionario || 'Sin Funcionario asignado'}</div>
                <div class="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">S/N: ${item.serie} | Inv: ${item.inventario || 'S/N'}</div>
            </div>
            <div class="text-right text-[10px]">
                <span class="px-2 py-0.5 rounded-full font-semibold ${badgeClass}">${item.tipo || 'Equipo'}</span>
                <div class="text-slate-400 dark:text-slate-500 mt-1">${item.marca || ''} ${item.modelo || ''}</div>
            </div>
        `;
        dropdown.appendChild(div);
    });
    
    dropdown.classList.remove('hidden');
}

// Rellenar automáticamente los datos del formulario al seleccionar una sugerencia
function selectExcelSuggestion(index) {
    const item = loadedAllEquipments[index];
    if (!item) return;
    
    // 1. Rellenar datos funcionario
    if (item.funcionario) {
        document.getElementById('func-nombre').value = item.funcionario;
    }
    if (item.depto) {
        document.getElementById('func-depto').value = item.depto;
    }
    
    // 2. Establecer Tipo Propiedad
    const isArriendo = (item.propiedad || '').toLowerCase().includes('arriendo');
    if (isArriendo) {
        const rad = document.querySelector('input[name="propiedad_tipo"][value="En Arriendo"]');
        if (rad) rad.checked = true;
    } else {
        const rad = document.querySelector('input[name="propiedad_tipo"][value="Propiedad ISP"]');
        if (rad) rad.checked = true;
    }
    
    // 3. Establecer Checkboxes Categoría
    document.querySelectorAll('input[name="eq_cat"]').forEach(cb => cb.checked = false);
    document.getElementById('eq_otros_detalles').value = '';
    
    const tipoLower = (item.tipo || '').toLowerCase();
    if (tipoLower.includes('pc') || tipoLower === 'desktop') {
        const cb = document.querySelector('input[name="eq_cat"][value="PC"]');
        if (cb) cb.checked = true;
    } else if (tipoLower.includes('notebook') || tipoLower.includes('laptop')) {
        const cb = document.querySelector('input[name="eq_cat"][value="Notebook"]');
        if (cb) cb.checked = true;
    } else if (tipoLower.includes('aio') || tipoLower.includes('all in one')) {
        const cb = document.querySelector('input[name="eq_cat"][value="All In One"]');
        if (cb) cb.checked = true;
    } else if (tipoLower.includes('pantalla') || tipoLower.includes('monitor')) {
        const cb = document.querySelector('input[name="eq_cat"][value="Monitor"]');
        if (cb) cb.checked = true;
    } else {
        document.getElementById('eq_otros_detalles').value = item.tipo;
    }
    
    // 4. Agregar fila en Sección 4 (separando equipos combinados si corresponde)
    const container = document.getElementById('equipment-rows');
    container.innerHTML = '';
    const splitItems = splitEquipmentIfCombined({
        tipo: item.tipo,
        marca: item.marca,
        modelo: item.modelo,
        serie: item.serie,
        inventario: item.inventario,
        observacion: ''
    });
    splitItems.forEach(splitItem => {
        addEquipmentRow(splitItem);
    });
    
    // Limpiar barra de búsqueda y ocultar dropdown
    document.getElementById('excel-autocomplete-input').value = '';
    document.getElementById('excel-suggestions-dropdown').classList.add('hidden');
    
    showToast("Datos de funcionario y equipo auto-rellenados.", "success");
}

// Exportar la planilla Excel modificada y descargarla localmente
function exportUpdatedExcel() {
    if (!uploadedWorkbook) {
        showToast("Debe cargar primero el Catastro Excel.", "error");
        return;
    }
    
    const equiposSheet = uploadedWorkbook.Sheets['Equipos'];
    if (!equiposSheet) {
        showToast("No se encontró la hoja 'Equipos' en el Excel.", "error");
        return;
    }
    
    // Listar todos los equipos recopilados de las solicitudes locales
    const flatEquipments = [];
    submissions.forEach(sub => {
        sub.equipamiento.forEach(eq => {
            flatEquipments.push({
                sub: sub,
                eq: eq
            });
        });
    });
    
    // Limpiar datos previos en la hoja 'Equipos' (columnas index 1 a 13)
    const rangeEquipos = XLSX.utils.decode_range(equiposSheet['!ref']);
    for (let r = 1; r <= rangeEquipos.e.r; r++) {
        for (let c = 1; c <= 13; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
            if (equiposSheet[cellRef]) {
                delete equiposSheet[cellRef];
            }
        }
        setCellValue(equiposSheet, r, 12, false); // Baseline EsInventario = false
    }
    
    // Escribir los registros recopilados
    flatEquipments.forEach((record, index) => {
        const rowIdx = index + 1; // Fila 2 en adelante
        const sub = record.sub;
        const eq = record.eq;
        
        setCellValue(equiposSheet, rowIdx, 0, index + 1); // Nº
        setCellValue(equiposSheet, rowIdx, 1, eq.tipo || ''); // Tipo (AIO Notebook o Pantalla)
        setCellValue(equiposSheet, rowIdx, 2, eq.serie || ''); // Serie
        setCellValue(equiposSheet, rowIdx, 3, ''); // Nombre Equipo
        setCellValue(equiposSheet, rowIdx, 4, eq.marca || ''); // Marca
        setCellValue(equiposSheet, rowIdx, 5, eq.modelo || ''); // Modelo
        setCellValue(equiposSheet, rowIdx, 6, sub.funcionario.nombre || ''); // Nombre Funcionario
        setCellValue(equiposSheet, rowIdx, 7, sub.funcionario.rut || ''); // Rut
        setCellValue(equiposSheet, rowIdx, 8, sub.funcionario.cargo || ''); // Cargo
        setCellValue(equiposSheet, rowIdx, 9, sub.funcionario.depto || ''); // Departamento
        setCellValue(equiposSheet, rowIdx, 10, ''); // Ubicación
        
        let obsText = eq.observacion || '';
        if (sub.ticket && sub.ticket !== 'S/N') {
            obsText = `Ticket ${sub.ticket}: ${obsText}`.trim();
        }
        setCellValue(equiposSheet, rowIdx, 11, obsText); // Observación
        
        const isInventario = sub.propiedad_equipamiento === 'Propiedad ISP';
        setCellValue(equiposSheet, rowIdx, 12, isInventario); // EsInventario
        setCellValue(equiposSheet, rowIdx, 13, eq.inventario || ''); // Nº Inventario
    });
    
    // Actualizar el ref de la hoja Equipos
    updateSheetRange(equiposSheet, flatEquipments.length);
    
    // Actualizar estados "Catastrado" en las hojas 'Computadores' e 'Impresoras-Scanner'
    const compSheet = uploadedWorkbook.Sheets['Computadores'];
    const compRange = compSheet ? XLSX.utils.decode_range(compSheet['!ref']) : null;
    
    const printSheet = uploadedWorkbook.Sheets['Impresoras-Scanner'];
    const printRange = printSheet ? XLSX.utils.decode_range(printSheet['!ref']) : null;
    
    let updatedCount = 0;
    
    flatEquipments.forEach(record => {
        const eq = record.eq;
        const sub = record.sub;
        if (!eq.serie) return;
        
        const statusValue = 'Catastrado';
        const obsValue = `Catastrado el ${sub.fecha}${sub.ticket && sub.ticket !== 'S/N' ? ' (Ticket ' + sub.ticket + ')' : ''}`;
        
        let found = false;
        
        if (compSheet && compRange) {
            found = updateEquipmentStatusInSheet(compSheet, compRange, eq.serie, statusValue, obsValue, 21, 22);
        }
        
        if (!found && printSheet && printRange) {
            found = updateEquipmentStatusInSheet(printSheet, printRange, eq.serie, statusValue, obsValue, 16, 17);
        }
        
        if (found) {
            updatedCount++;
        }
    });
    
    // Generar binario del libro y descargar
    try {
        const wbout = XLSX.write(uploadedWorkbook, { bookType: 'xlsx', type: 'binary' });
        
        function s2ab(s) {
            const buf = new ArrayBuffer(s.length);
            const view = new Uint8Array(buf);
            for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
            return buf;
        }
        
        const blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Catastro_ISP_2025_ACTUALIZADO.xlsx`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast(`Catastro actualizado exportado con éxito. Se marcaron ${updatedCount} equipos en las planillas de inventario y se registraron ${flatEquipments.length} asignaciones.`, "success");
    } catch (e) {
        console.error("Error al exportar Excel:", e);
        showToast("Error al exportar la planilla Excel.", "error");
    }
}

// Ocultar dropdown de autocompletado si se hace clic fuera de él
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('excel-suggestions-dropdown');
    const input = document.getElementById('excel-autocomplete-input');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
});

// Función auxiliar para separar equipos combinados (ej. AIO / MONITOR o series con "/")
function splitEquipmentIfCombined(rawEq) {
    const tipo = String(rawEq.tipo || '').trim();
    const serie = String(rawEq.serie || '').trim();
    const marca = String(rawEq.marca || '').trim();
    const modelo = String(rawEq.modelo || '').trim();
    const inventario = String(rawEq.inventario || '').trim();
    const observacion = String(rawEq.observacion || '').trim();

    const hasSlashTipo = tipo.includes('/');
    const hasSlashSerie = serie.includes('/');

    const isCombined = hasSlashTipo || hasSlashSerie || 
                       (tipo.toLowerCase().includes('aio') && (tipo.toLowerCase().includes('monitor') || tipo.toLowerCase().includes('pantalla')));

    if (!isCombined) {
        return [rawEq];
    }

    const splitTipo = hasSlashTipo ? tipo.split('/') : [tipo];
    const splitSerie = hasSlashSerie ? serie.split('/') : [serie];
    const splitMarca = marca.includes('/') ? marca.split('/') : [marca];
    const splitModelo = modelo.includes('/') ? modelo.split('/') : [modelo];
    const splitInventario = inventario.includes('/') ? inventario.split('/') : [inventario];
    const splitObservacion = observacion.includes('/') ? observacion.split('/') : [observacion];

    let numItems = Math.max(splitTipo.length, splitSerie.length);
    if (numItems === 1 && (tipo.toLowerCase().includes('aio') && (tipo.toLowerCase().includes('monitor') || tipo.toLowerCase().includes('pantalla')))) {
        numItems = 2;
    }

    const results = [];
    for (let i = 0; i < numItems; i++) {
        let itemTipo = (splitTipo[i] || splitTipo[0] || 'Equipo').trim();
        let itemSerie = (splitSerie[i] || '').trim();
        let itemMarca = (splitMarca[i] || splitMarca[0] || '').trim();
        let itemModelo = (splitModelo[i] || splitModelo[0] || '').trim();
        let itemInventario = (splitInventario[i] || splitInventario[0] || '').trim();
        let itemObservacion = (splitObservacion[i] || splitObservacion[0] || '').trim();

        // Limpiar el número de serie para el segundo ítem si el original no tenía división (ej. sólo serial del AIO)
        // Excepto si es una etiqueta especial como "ARRIENDO", "N/A" o "S/N"
        if (i > 0 && splitSerie.length === 1) {
            const sLower = itemSerie.toLowerCase();
            if (sLower !== 'arriendo' && sLower !== 'n/a' && sLower !== 's/n') {
                itemSerie = '';
            }
        }

        // Normalizar tipos
        const itemTipoLower = itemTipo.toLowerCase();
        if (itemTipoLower === 'aio' || itemTipoLower === 'all in one' || itemTipoLower === 'all-in-one') {
            itemTipo = 'All In One';
        } else if (itemTipoLower === 'monitor' || itemTipoLower === 'pantalla' || itemTipoLower === 'display') {
            itemTipo = 'Monitor';
        } else if (itemTipoLower === 'pc' || itemTipoLower === 'torre' || itemTipoLower === 'desktop') {
            itemTipo = 'PC';
        } else if (itemTipoLower === 'notebook' || itemTipoLower === 'laptop') {
            itemTipo = 'Notebook';
        }

        results.push({
            tipo: itemTipo,
            marca: itemMarca,
            modelo: itemModelo,
            serie: itemSerie,
            inventario: itemInventario,
            observacion: itemObservacion
        });
    }

    // Caso especial: si el tipo contiene AIO y Monitor pero no se dividió por slashes, forzar la asignación
    if (splitTipo.length === 1 && tipo.toLowerCase().includes('aio') && (tipo.toLowerCase().includes('monitor') || tipo.toLowerCase().includes('pantalla'))) {
        if (results[0]) results[0].tipo = 'All In One';
        if (results[1]) results[1].tipo = 'Monitor';
    }

    return results;
}

// Función para calcular y renderizar las métricas de avance del catastro
function renderMetrics() {
    // 1. Obtener listado de series catastradas en submissions locales para actualización en tiempo real
    const localCatastradosSet = new Set();
    submissions.forEach(sub => {
        if (sub.equipamiento) {
            sub.equipamiento.forEach(eq => {
                if (eq.serie) {
                    localCatastradosSet.add(String(eq.serie).trim().toLowerCase());
                }
            });
        }
    });

    // 2. Obtener totales
    const totalComps = loadedAllEquipments.filter(e => e.sheet === 'Computadores').length;
    const totalPrinters = loadedAllEquipments.filter(e => e.sheet === 'Impresoras-Scanner').length;
    const totalUniverse = totalComps + totalPrinters;

    // Contar cuántos están catastrados (ya sea marcado en el Excel o en las submissions locales activas)
    const isEqCatastrado = (e) => {
        const estadoLower = String(e.estado || '').toLowerCase();
        const isCatExcel = estadoLower.includes('catastrado');
        const isCatLocal = e.serie && localCatastradosSet.has(String(e.serie).trim().toLowerCase());
        return isCatExcel || isCatLocal;
    };

    const catastradosComps = loadedAllEquipments.filter(e => e.sheet === 'Computadores' && isEqCatastrado(e)).length;
    const catastradosPrinters = loadedAllEquipments.filter(e => e.sheet === 'Impresoras-Scanner' && isEqCatastrado(e)).length;
    const catastradosTotal = catastradosComps + catastradosPrinters;

    // Porcentajes
    const percentTotal = totalUniverse > 0 ? Math.round((catastradosTotal / totalUniverse) * 100) : 0;
    const percentComps = totalComps > 0 ? Math.round((catastradosComps / totalComps) * 100) : 0;
    const percentPrinters = totalPrinters > 0 ? Math.round((catastradosPrinters / totalPrinters) * 100) : 0;

    // Formularios con al menos una firma digital registrada
    const totalSignedForms = submissions.filter(sub => {
        return (sub.firmas && (sub.firmas.tic || sub.firmas.emisor || sub.firmas.receptor));
    }).length;

    // Actualizar elementos principales en el DOM
    const elPercent = document.getElementById('metric-percent');
    const elPercentBar = document.getElementById('metric-percent-bar');
    if (elPercent) elPercent.innerText = `${percentTotal}%`;
    if (elPercentBar) elPercentBar.style.width = `${percentTotal}%`;

    const elCompsCatastrados = document.getElementById('metric-comps-catastrados');
    const elCompsTotal = document.getElementById('metric-comps-total');
    const elCompsBar = document.getElementById('metric-comps-bar');
    if (elCompsCatastrados) elCompsCatastrados.innerText = catastradosComps;
    if (elCompsTotal) elCompsTotal.innerText = totalComps;
    if (elCompsBar) elCompsBar.style.width = `${percentComps}%`;

    const elPrintersCatastrados = document.getElementById('metric-printers-catastrados');
    const elPrintersTotal = document.getElementById('metric-printers-total');
    const elPrintersBar = document.getElementById('metric-printers-bar');
    if (elPrintersCatastrados) elPrintersCatastrados.innerText = catastradosPrinters;
    if (elPrintersTotal) elPrintersTotal.innerText = totalPrinters;
    if (elPrintersBar) elPrintersBar.style.width = `${percentPrinters}%`;

    const elFormsTotal = document.getElementById('metric-forms-total');
    if (elFormsTotal) elFormsTotal.innerText = totalSignedForms;

    // 3. Avance por Unidad / Departamento (Top 5)
    const deptsMap = {};
    loadedAllEquipments.forEach(e => {
        let dept = String(e.depto || 'SIN DEPARTAMENTO').trim().toUpperCase();
        if (dept === 'UNDEFINED' || dept === '') dept = 'SIN DEPARTAMENTO';
        
        if (!deptsMap[dept]) {
            deptsMap[dept] = { total: 0, catastrado: 0 };
        }
        deptsMap[dept].total++;
        if (isEqCatastrado(e)) {
            deptsMap[dept].catastrado++;
        }
    });

    const topDepts = Object.keys(deptsMap)
        .map(name => ({ name, ...deptsMap[name] }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    const deptsContainer = document.getElementById('metric-dept-list');
    if (deptsContainer) {
        deptsContainer.innerHTML = '';
        if (topDepts.length === 0) {
            deptsContainer.innerHTML = '<div class="p-4 text-center text-slate-400 dark:text-slate-500 text-xs">No hay datos de departamentos disponibles. Cargue un Excel.</div>';
        } else {
            topDepts.forEach(dept => {
                const pct = dept.total > 0 ? Math.round((dept.catastrado / dept.total) * 100) : 0;
                const div = document.createElement('div');
                div.className = "space-y-1.5";
                div.innerHTML = `
                    <div class="flex justify-between items-center text-xs font-semibold">
                        <span class="text-slate-700 dark:text-slate-300 truncate max-w-[200px]" title="${dept.name}">${dept.name}</span>
                        <span class="text-slate-500 dark:text-slate-400 font-mono">${dept.catastrado} / ${dept.total} (${pct}%)</span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div class="bg-indigo-650 dark:bg-indigo-500 h-full rounded-full transition-all duration-500" style="width: ${pct}%;"></div>
                    </div>
                `;
                deptsContainer.appendChild(div);
            });
        }
    }

    // 4. Distribución por Tipo de Equipo y Propiedad
    const typesMap = {};
    loadedAllEquipments.forEach(e => {
        let t = String(e.tipo || 'OTRO').trim().toUpperCase();
        if (t === 'UNDEFINED' || t === '') t = 'OTRO';
        
        if (t === 'PC' || t.includes('DESKTOP') || t.includes('TORRE')) t = 'PC';
        else if (t.includes('NOTEBOOK') || t.includes('LAPTOP')) t = 'NOTEBOOK';
        else if (t.includes('AIO') || t.includes('ALL IN ONE') || t.includes('ALL-IN-ONE')) t = 'ALL IN ONE';
        else if (t.includes('IMPRESORA')) t = 'IMPRESORA';
        else if (t.includes('SCANNER')) t = 'SCANNER';
        else if (t.includes('PANTALLA') || t.includes('MONITOR')) t = 'MONITOR';

        if (!typesMap[t]) {
            typesMap[t] = { total: 0, arriendo: 0, isp: 0, catastrado: 0 };
        }
        typesMap[t].total++;
        
        const isArriendo = String(e.propiedad || '').toLowerCase().includes('arriendo');
        if (isArriendo) typesMap[t].arriendo++;
        else typesMap[t].isp++;

        if (isEqCatastrado(e)) {
            typesMap[t].catastrado++;
        }
    });

    const typesContainer = document.getElementById('metric-types-list');
    if (typesContainer) {
        typesContainer.innerHTML = '';
        const sortedTypes = Object.keys(typesMap)
            .map(name => ({ name, ...typesMap[name] }))
            .sort((a, b) => b.total - a.total);

        if (sortedTypes.length === 0) {
            typesContainer.innerHTML = '<div class="p-4 text-center text-slate-400 dark:text-slate-500 text-xs">No hay datos de tipos de equipos disponibles. Cargue un Excel.</div>';
        } else {
            sortedTypes.forEach(t => {
                const pct = t.total > 0 ? Math.round((t.catastrado / t.total) * 100) : 0;
                const div = document.createElement('div');
                div.className = "flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/20 border border-slate-100/50 dark:border-slate-800/40 text-xs";
                div.innerHTML = `
                    <div>
                        <span class="font-bold text-slate-700 dark:text-slate-300 block">${t.name}</span>
                        <span class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 block font-medium">Arriendo: ${t.arriendo} | Propio: ${t.isp}</span>
                    </div>
                    <div class="text-right">
                        <span class="font-extrabold text-slate-800 dark:text-slate-150 block text-sm">${t.catastrado} <span class="text-slate-400 text-xs font-normal">/ ${t.total}</span></span>
                        <span class="text-[10px] text-emerald-600 dark:text-emerald-450 font-semibold block mt-0.5">${pct}% Listo</span>
                    </div>
                `;
                typesContainer.appendChild(div);
            });
        }
    }
}

// =======================================================================
// EXPOSICIÓN DE FUNCIONES A ÁMBITO GLOBAL (VITE ES MODULE COMPATIBILITY)
// =======================================================================
window.toggleTheme = toggleTheme;
window.switchTab = switchTab;
window.openNewForm = openNewForm;
window.exportToCSV = exportToCSV;
window.handleExcelUpload = handleExcelUpload;
window.exportUpdatedExcel = exportUpdatedExcel;
window.setFilterType = setFilterType;
window.renderTable = renderTable;
window.handleRutInput = handleRutInput;
window.toggleTraspasoSection = toggleTraspasoSection;
window.showExcelSuggestions = showExcelSuggestions;
window.selectExcelSuggestion = selectExcelSuggestion;
window.saveForm = saveForm;
window.viewAndEditForm = viewAndEditForm;
window.deleteSubmission = deleteSubmission;
window.removeEquipmentRow = removeEquipmentRow;
window.triggerPrintMode = triggerPrintMode;
window.clearCanvas = clearCanvas;
window.addEquipmentRow = addEquipmentRow;
window.syncEquipmentCategoriesFromRows = syncEquipmentCategoriesFromRows;
window.toggleSigMode = toggleSigMode;
