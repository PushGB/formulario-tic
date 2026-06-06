import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';

// Inicializar Supabase Client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let supabase = null;

if (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('tu-proyecto-nuevo')) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
    console.warn("Supabase no configurado o tiene valores por defecto. Trabajando en modo local/offline.");
}

// Función auxiliar para escapar caracteres HTML y prevenir XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// Inicialización de Variables Globales y Gráficos
let submissions = [];
let activeSubmissionId = null;
let activeTab = 'dashboard';
let activeFilterType = 'All';
let chartDeptsInstance = null;
let chartTypesInstance = null;
const pendingDeletes = new Set();
const pendingUpserts = new Set();
let currentUserRole = 'admin'; // 'admin' o 'tecnico' (por defecto 'admin' en modo local)

// Estructuras de Firmas
const drawingStates = {
    tic: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false },
    emisor: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false },
    receptor: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false }
};

// --- SISTEMA DE AUTENTICACIÓN (SUPABASE AUTH) ---
function showLoginOverlay() {
    const overlay = document.getElementById('auth-login-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const logoutBtn = document.getElementById('auth-logout-btn');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    const divider = document.getElementById('auth-divider');
    if (divider) divider.classList.add('hidden');
    
    // Deshabilitar botones de navegación
    ['nav-dashboard', 'nav-metrics', 'nav-history', 'nav-form'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });
}

function hideLoginOverlay() {
    const overlay = document.getElementById('auth-login-overlay');
    if (overlay) overlay.classList.add('hidden');
    const logoutBtn = document.getElementById('auth-logout-btn');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    const divider = document.getElementById('auth-divider');
    if (divider) divider.classList.remove('hidden');
    
    // Habilitar botones de navegación
    ['nav-dashboard', 'nav-metrics', 'nav-history', 'nav-form'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = false;
    });
}

async function checkAuthSession() {
    if (!supabase) return;
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        
        if (session) {
            onUserAuthenticated(session.user);
        } else {
            showLoginOverlay();
        }
    } catch (err) {
        console.error("Error al obtener sesión de Supabase:", err.message);
        showLoginOverlay();
    }
    
    // Escuchar cambios de estado en auth
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            onUserAuthenticated(session.user);
        } else if (event === 'SIGNED_OUT') {
            showLoginOverlay();
        }
    });
}

async function onUserAuthenticated(user) {
    hideLoginOverlay();
    showToast(`Sesión iniciada: ${user.email}`, "success");
    await fetchUserRole(user);
    applyRolePermissions();
    await loadSubmissions();
    lucide.createIcons();
}

async function fetchUserRole(user) {
    if (!supabase) {
        currentUserRole = 'admin';
        return;
    }
    try {
        const { data, error } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .single();
        if (error) {
            console.error("Error al obtener rol del usuario:", error.message);
            currentUserRole = 'tecnico'; // Rol por defecto seguro si hay error
        } else if (data) {
            currentUserRole = data.role;
            console.log(`Rol cargado para ${user.email}: ${currentUserRole}`);
        } else {
            currentUserRole = 'tecnico';
        }
    } catch (err) {
        console.error("Error al consultar rol:", err);
        currentUserRole = 'tecnico';
    }
}

function applyRolePermissions() {
    const uploadLabel = document.getElementById('excel-upload-label');
    const exportBtn = document.getElementById('excel-export-btn');
    
    if (currentUserRole === 'tecnico') {
        if (uploadLabel) uploadLabel.classList.add('hidden');
        if (exportBtn) exportBtn.classList.add('hidden');
    } else {
        if (uploadLabel) uploadLabel.classList.remove('hidden');
    }
}

function setFormReadOnly(readOnly) {
    const form = document.getElementById('equip-form');
    if (!form) return;
    
    // Deshabilitar/Habilitar inputs, textareas, select, etc.
    form.querySelectorAll('input, textarea, select, button[type="button"]').forEach(el => {
        // Excluir botones de control general del pie de página que no afectan al registro
        if (el.id === 'print-btn-form' || el.id === 'pdf-btn-form' || el.id === 'preview-btn-form' || el.id === 'cancel-btn-form') {
            return;
        }
        
        // Botones de firma y selección de modo
        if (el.classList.contains('clear-sig-btn') || el.classList.contains('mode-sig-btn')) {
            el.disabled = readOnly;
            el.style.opacity = readOnly ? '0.5' : '1';
            el.style.pointerEvents = readOnly ? 'none' : 'auto';
            return;
        }
        
        // Ocultar botones de fila de equipos si es solo lectura
        if (el.tagName === 'BUTTON') {
            const isAddBtn = el.getAttribute('onclick') && el.getAttribute('onclick').includes('addEquipmentRow');
            const isRemoveBtn = el.getAttribute('onclick') && el.getAttribute('onclick').includes('removeEquipmentRow');
            if (isAddBtn || isRemoveBtn) {
                el.style.display = readOnly ? 'none' : '';
            }
        } else {
            el.disabled = readOnly;
        }
    });

    // Ocultar el botón de Guardar si es solo lectura
    const saveBtn = document.getElementById('save-btn-form');
    if (saveBtn) {
        saveBtn.style.display = readOnly ? 'none' : '';
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error-msg');
    
    if (errorMsg) errorMsg.classList.add('hidden');
    
    if (!supabase) return;
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    } catch (err) {
        console.error("Error de autenticación:", err.message);
        if (errorMsg) {
            errorMsg.innerText = "Credenciales inválidas. Intente de nuevo.";
            errorMsg.classList.remove('hidden');
        }
    }
}

async function handleLogout() {
    if (supabase) {
        try {
            await supabase.auth.signOut();
            currentUserRole = null;
            showToast("Sesión cerrada.", "success");
        } catch (err) {
            console.error("Error al cerrar sesión:", err.message);
        }
    }
}

// --- RESOLUCIÓN Y SUBIDA DE FIRMAS (SUPABASE STORAGE) ---
function dataURLtoBlob(dataurl) {
    if (!dataurl) return null;
    const arr = dataurl.split(',');
    if (arr.length < 2) return null;
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function resolveSignature(submissionId, role, dbPath) {
    if (!dbPath) return null;
    if (dbPath.startsWith('data:image')) return dbPath;
    
    // Buscar en el cache local
    const localSub = submissions.find(s => s.id === submissionId);
    if (localSub && localSub.firmas && localSub.firmas[role] && localSub.firmas[role].startsWith('data:image')) {
        return localSub.firmas[role];
    }
    
    // Descargar desde el bucket
    if (supabase) {
        try {
            const { data, error } = await supabase.storage.from('firmas').download(dbPath);
            if (error) throw error;
            const base64 = await blobToBase64(data);
            return base64;
        } catch (err) {
            console.error(`Error al descargar firma ${role} (${dbPath}):`, err.message);
            // Fallback: intentar firmar la URL
            try {
                const { data, error } = await supabase.storage.from('firmas').createSignedUrl(dbPath, 60);
                if (!error && data) return data.signedUrl;
            } catch (e) {}
        }
    }
    return null;
}

async function uploadSignaturesToStorage(id, firmas) {
    const updatedFirmas = { ...firmas };
    if (!supabase) return updatedFirmas;

    const roles = ['tic', 'emisor', 'receptor'];
    for (const role of roles) {
        const sigData = firmas[role];
        if (sigData && sigData.startsWith('data:image/png;base64')) {
            const blob = dataURLtoBlob(sigData);
            if (blob) {
                const filePath = `signatures/${id}/${role}.png`;
                try {
                    const { data, error } = await supabase.storage
                        .from('firmas')
                        .upload(filePath, blob, { upsert: true });
                    if (error) throw error;
                    updatedFirmas[role] = filePath;
                    console.log(`Firma ${role} subida exitosamente:`, filePath);
                } catch (err) {
                    console.error(`Error al subir firma ${role}:`, err.message);
                }
            }
        }
    }
    return updatedFirmas;
}

async function mapDbRowsToSubmissions(data) {
    if (!data) return [];
    return await Promise.all(data.map(async dbRow => {
        const ticSig = await resolveSignature(dbRow.id, 'tic', dbRow.firma_tic);
        const emisorSig = await resolveSignature(dbRow.id, 'emisor', dbRow.firma_emisor);
        const receptorSig = await resolveSignature(dbRow.id, 'receptor', dbRow.firma_receptor);

        return {
            id: dbRow.id,
            fecha: dbRow.fecha,
            ticket: dbRow.ticket,
            funcionario: {
                nombre: dbRow.funcionario_nombre,
                rut: formatRut(dbRow.funcionario_rut),
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
                tic: ticSig,
                emisor: emisorSig,
                receptor: receptorSig
            }
        };
    }));
}

// Al iniciar la página
window.addEventListener('load', () => {
    // Inicializar Tema (Claro / Oscuro)
    initTheme();

    // Inicializar Iconos Lucide
    lucide.createIcons();
    
    // Configurar Listeners para las Firmas
    initSignaturePads();

    // Configurar listeners de validación de campos obligatorios
    setupInputValidationListeners();

    // Sincronizar dimensiones de Canvas si cambia el tamaño de pantalla
    window.addEventListener('resize', resizeAllCanvases);

    // Intentar precargar el catastro Excel desde el servidor local automáticamente
    preloadExcelData();

    // Cargar caché local e iniciar sincronización de datos
    currentUserRole = 'admin';
    applyRolePermissions();
    loadSubmissions();

    // Registrar Service Worker para PWA (offline local)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[PWA] Service Worker registrado con éxito:', reg.scope))
            .catch(err => console.error('[PWA] Error en Service Worker:', err));
    }
});

// Inicializar la sincronización en tiempo real de Supabase
function initRealtime() {
    if (supabase) {
        supabase
            .channel('realtime-solicitudes-tic')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_tic' }, payload => {
                console.log('[Realtime] Cambio detectado en solicitudes_tic:', payload);
                // Recargar solicitudes en segundo plano silenciosamente
                loadSubmissionsBackground();
            })
            .subscribe(status => {
                console.log(`[Realtime] Estado de suscripción Realtime: ${status}`);
            });
    }
}

// Función auxiliar para cargar solicitudes en segundo plano sin interrumpir la UX
async function loadSubmissionsBackground() {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('solicitudes_tic_secure')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (data) {
                const mappedSubmissions = await mapDbRowsToSubmissions(data);

                submissions = mappedSubmissions;
                consolidateDuplicateSubmissions();
                localStorage.setItem('tic_equip_submissions', JSON.stringify(submissions));
                updateStats();
                renderTable();
                if (activeTab === 'metrics') {
                    renderMetrics();
                }
            }
        } catch (e) {
            console.error("Error al actualizar solicitudes de fondo:", e.message);
        }
    }
}

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

// Consolidar de forma proactiva las solicitudes duplicadas (mismo RUT) en un solo registro
function consolidateDuplicateSubmissions() {
    if (submissions.length === 0) return;
    
    const consolidated = [];
    const rutMap = new Map(); // rut -> submission
    let hasChanges = false;
    const deletedIds = [];
    const updatedSubmissions = new Set();
    
    // Procesamos de más antiguo a más reciente para preservar el orden y datos actualizados
    for (let i = submissions.length - 1; i >= 0; i--) {
        const sub = submissions[i];
        const rawRut = sub.funcionario && sub.funcionario.rut;
        if (!rawRut) {
            consolidated.push(sub);
            continue;
        }
        
        // Normalizar RUT
        const rutKey = formatRut(rawRut);
        
        if (rutMap.has(rutKey)) {
            const existing = rutMap.get(rutKey);
            
            // Fusionar equipamiento evitando duplicados
            if (sub.equipamiento) {
                sub.equipamiento.forEach(eq => {
                    const isDup = existing.equipamiento.some(e => 
                        (e.serie || '').trim().toUpperCase() === (eq.serie || '').trim().toUpperCase()
                    );
                    if (!isDup) {
                        existing.equipamiento.push(eq);
                        if (!pendingUpserts.has(existing.id)) {
                            updatedSubmissions.add(existing);
                        }
                    }
                });
            }
            
            // Fusionar categorías
            if (sub.equipamiento_categorias) {
                sub.equipamiento_categorias.forEach(cat => {
                    if (!existing.equipamiento_categorias.includes(cat)) {
                        existing.equipamiento_categorias.push(cat);
                        if (!pendingUpserts.has(existing.id)) {
                            updatedSubmissions.add(existing);
                        }
                    }
                });
            }
            
            // Fusionar observaciones
            if (sub.observaciones_generales && !existing.observaciones_generales.includes(sub.observaciones_generales)) {
                existing.observaciones_generales += (existing.observaciones_generales ? ' | ' : '') + sub.observaciones_generales;
                if (!pendingUpserts.has(existing.id)) {
                    updatedSubmissions.add(existing);
                }
            }
            if (sub.accesorios && !existing.accesorios.includes(sub.accesorios)) {
                existing.accesorios += (existing.accesorios ? ' | ' : '') + sub.accesorios;
                if (!pendingUpserts.has(existing.id)) {
                    updatedSubmissions.add(existing);
                }
            }
            
            // Fusionar firmas
            if (sub.firmas) {
                if (!existing.firmas.tic && sub.firmas.tic) {
                    existing.firmas.tic = sub.firmas.tic;
                    existing.firmas.tic_mode = sub.firmas.tic_mode;
                    if (!pendingUpserts.has(existing.id)) {
                        updatedSubmissions.add(existing);
                    }
                }
                if (!existing.firmas.emisor && sub.firmas.emisor) {
                    existing.firmas.emisor = sub.firmas.emisor;
                    existing.firmas.emisor_mode = sub.firmas.emisor_mode;
                    if (!pendingUpserts.has(existing.id)) {
                        updatedSubmissions.add(existing);
                    }
                }
                if (!existing.firmas.receptor && sub.firmas.receptor) {
                    existing.firmas.receptor = sub.firmas.receptor;
                    existing.firmas.receptor_mode = sub.firmas.receptor_mode;
                    if (!pendingUpserts.has(existing.id)) {
                        updatedSubmissions.add(existing);
                    }
                }
            }
            
            // Unificar nombre conservando el más largo/completo (evitar typos como Mors vs Mora)
            if (sub.funcionario.nombre && existing.funcionario.nombre && sub.funcionario.nombre.length > existing.funcionario.nombre.length) {
                existing.funcionario.nombre = sub.funcionario.nombre;
                if (!pendingUpserts.has(existing.id)) {
                    updatedSubmissions.add(existing);
                }
            }
            
            // Eliminar de Supabase el duplicado sobrante (evitando llamadas repetidas)
            if (!pendingDeletes.has(sub.id)) {
                deletedIds.push(sub.id);
                hasChanges = true;
            }
        } else {
            sub.funcionario.rut = rutKey;
            rutMap.set(rutKey, sub);
        }
    }
    
    if (hasChanges) {
        submissions = Array.from(rutMap.values()).reverse();
        saveSubmissionsToStorage();
        
        // Sincronizar en Supabase de forma selectiva
        if (supabase) {
            // 1. Borrar registros duplicados obsoletos
            deletedIds.forEach(id => {
                pendingDeletes.add(id);
                supabase
                    .from('solicitudes_tic')
                    .delete()
                    .eq('id', id)
                    .then(({ error }) => {
                        pendingDeletes.delete(id);
                        if (error) console.error(`Error al eliminar duplicado ${id} de Supabase:`, error.message);
                    })
                    .catch(() => pendingDeletes.delete(id));
            });
            
            // 2. Upsertar registros consolidados que sufrieron cambios
            updatedSubmissions.forEach(s => {
                pendingUpserts.add(s.id);
                (async () => {
                    try {
                        const storageFirmas = await uploadSignaturesToStorage(s.id, s.firmas);
                        
                        const dbRow = {
                            id: s.id,
                            fecha: s.fecha,
                            ticket: s.ticket,
                            funcionario_nombre: s.funcionario.nombre,
                            funcionario_rut: s.funcionario.rut,
                            funcionario_cargo: s.funcionario.cargo,
                            funcionario_depto: s.funcionario.depto,
                            tipo_solicitud: s.tipo_solicitud,
                            propiedad_equipamiento: s.propiedad_equipamiento,
                            equipamiento_categorias: s.equipamiento_categorias,
                            otros_detalles: s.otros_detalles,
                            traspaso_emisor_nombre: s.traspaso ? s.traspaso.emisor_nombre : null,
                            traspaso_emisor_depto: s.traspaso ? s.traspaso.emisor_depto : null,
                            traspaso_receptor_nombre: s.traspaso ? s.traspaso.receptor_nombre : null,
                            traspaso_receptor_depto: s.traspaso ? s.traspaso.receptor_depto : null,
                            traspaso_observacion: s.traspaso ? s.traspaso.observacion : null,
                            equipamiento: s.equipamiento,
                            accesorios: s.accesorios,
                            observaciones_generales: s.observaciones_generales,
                            firmas_tic_mode: s.firmas.tic_mode,
                            firmas_emisor_mode: s.firmas.emisor_mode,
                            firmas_receptor_mode: s.firmas.receptor_mode,
                            firma_tic: storageFirmas.tic,
                            firma_emisor: storageFirmas.emisor,
                            firma_receptor: storageFirmas.receptor
                        };
                        const { error } = await supabase.from('solicitudes_tic').upsert(dbRow);
                        if (error) console.error(`Error al actualizar consolidado ${s.id} en Supabase:`, error.message);
                    } catch (e) {
                        console.error(`Error de conexión al actualizar consolidado ${s.id}:`, e);
                    } finally {
                        pendingUpserts.delete(s.id);
                    }
                })();
            });
        }
    }
}

// Cargar registros desde localStorage y sincronizar con Supabase
async function loadSubmissions() {
    // 1. Cargar caché local para renderizado instantáneo (0ms)
    const localData = localStorage.getItem('tic_equip_submissions');
    if (localData) {
        try {
            submissions = JSON.parse(localData);
            // Normalizar RUTs locales para asegurar mismo formato
            submissions.forEach(sub => {
                if (sub.funcionario && sub.funcionario.rut) {
                    sub.funcionario.rut = formatRut(sub.funcionario.rut);
                }
            });
            // Consolidar duplicados en caché
            consolidateDuplicateSubmissions();
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
                .from('solicitudes_tic_secure')
                .select('*')
                .order('created_at', { ascending: false });
 
            if (error) throw error;
 
            if (data) {
                const mappedSubmissions = await mapDbRowsToSubmissions(data);
 
                submissions = mappedSubmissions;
                // Consolidar duplicados en base a datos frescos de la nube
                consolidateDuplicateSubmissions();
                
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
    const tabHistory = document.getElementById('tab-history');
    if (tabHistory) tabHistory.classList.add('hidden');
    
    // Estilos de botones de navegación
    const btnDash = document.getElementById('nav-dashboard');
    const btnForm = document.getElementById('nav-form');
    const btnMetrics = document.getElementById('nav-metrics');
    const btnHistory = document.getElementById('nav-history');
    
    if (btnDash) btnDash.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";
    if (btnForm) btnForm.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";
    if (btnMetrics) btnMetrics.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";
    if (btnHistory) btnHistory.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors text-slate-300 hover:text-white hover:bg-slate-800";

    if (tabId === 'dashboard') {
        document.getElementById('tab-dashboard').classList.remove('hidden');
        if (btnDash) btnDash.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";
        renderTable();
    } else if (tabId === 'form-view') {
        document.getElementById('tab-form-view').classList.remove('hidden');
        if (btnForm) btnForm.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";
        // Redimensionar canvases de firma al visualizar
        setTimeout(resizeAllCanvases, 50);
    } else if (tabId === 'metrics') {
        document.getElementById('tab-metrics').classList.remove('hidden');
        if (btnMetrics) {
            btnMetrics.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";
        }
        renderMetrics();
    } else if (tabId === 'history') {
        if (tabHistory) tabHistory.classList.remove('hidden');
        if (btnHistory) {
            btnHistory.className = "px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";
        }
        resetHistoryTab();
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

    // Restablecer estilos de validación de campos obligatorios
    clearValidationStyles();

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
    
    // Ocultar botones de impresión/pdf/previsualización para nuevos registros hasta que se guarden
    document.getElementById('print-btn-form').classList.add('hidden');
    document.getElementById('pdf-btn-form').classList.add('hidden');
    document.getElementById('preview-btn-form').classList.add('hidden');
    
    setFormReadOnly(false);
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
            <input type="text" name="eq_tipo" value="${escapeHTML(data.tipo || '')}" placeholder="Ej: Notebook" required oninput="syncEquipmentCategoriesFromRows()" class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_marca" value="${escapeHTML(data.marca || '')}" placeholder="Ej: Lenovo" required class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_modelo" value="${escapeHTML(data.modelo || '')}" placeholder="Ej: ThinkPad L14" required class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_serie" value="${escapeHTML(data.serie || '')}" placeholder="Ej: SPF0349A" required class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_inventario" value="${escapeHTML(data.inventario || '')}" placeholder="Ej: ISP-2024-49" class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono transition-all">
        </td>
        <td class="p-2">
            <input type="text" name="eq_obs" value="${escapeHTML(data.observacion || '')}" placeholder="Opcional" class="w-full bg-transparent px-2 py-1.5 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs transition-all">
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
    
    // Validar campos obligatorios de la Sección 1
    const nombreVal = validateField(document.getElementById('func-nombre'), 3);
    const cargoVal = validateField(document.getElementById('func-cargo'), 2);
    const deptoVal = validateField(document.getElementById('func-depto'), 3);
    
    if (!nombreVal || !cargoVal || !deptoVal) {
        showToast("Por favor, complete correctamente los datos del Funcionario.", "error");
        // Desplazarse al primer error
        const firstError = document.querySelector('.border-rose-500');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Validar RUT chileno antes de guardar
    const rutInput = document.getElementById('func-rut').value.trim();
    if (!validateRut(rutInput)) {
        showToast("Por favor, ingrese un RUT chileno válido.", "error");
        const rutField = document.getElementById('func-rut');
        rutField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const rut = formatRut(rutInput);

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
        highlightUnsignedCanvas('tic');
        return;
    }
    if (sigModeReceptor === 'digital' && !drawingStates.receptor.hasSigned) {
        showToast("Falta la firma digital del Funcionario Responsable Receptor.", "error");
        highlightUnsignedCanvas('receptor');
        return;
    }
    if (tipo_solicitud === 'Traspaso' && sigModeEmisor === 'digital' && !drawingStates.emisor.hasSigned) {
        showToast("Para traspasos es obligatoria la firma del Funcionario Emisor.", "error");
        highlightUnsignedCanvas('emisor');
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
    consolidateDuplicateSubmissions();
    
    // Si se consolidó con un registro existente (mismo RUT), usamos ese ID para que la UI/PDF coincida
    const currentRut = submissionData.funcionario && submissionData.funcionario.rut ? formatRut(submissionData.funcionario.rut) : null;
    if (currentRut) {
        const consolidatedSub = submissions.find(s => s.funcionario && formatRut(s.funcionario.rut) === currentRut);
        if (consolidatedSub) {
            activeSubmissionId = consolidatedSub.id;
        } else {
            activeSubmissionId = submissionData.id;
        }
    } else {
        activeSubmissionId = submissionData.id;
    }

    // Sincronizar en caliente con Supabase
    if (supabase) {
        (async () => {
            try {
                const storageFirmas = await uploadSignaturesToStorage(submissionData.id, submissionData.firmas);
                
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
                    firma_tic: storageFirmas.tic,
                    firma_emisor: storageFirmas.emisor,
                    firma_receptor: storageFirmas.receptor
                };

                const { error } = await supabase
                    .from('solicitudes_tic')
                    .upsert(dbRow);
                
                if (error) {
                    console.error("Error al guardar en Supabase:", error.message);
                    showToast("Guardado localmente. Error al sincronizar con la nube.", "error");
                } else {
                    showToast("Registro guardado y sincronizado con la nube.", "success");
                }
            } catch (err) {
                console.error("Error de conexión al guardar en Supabase:", err);
                showToast("Guardado localmente. Error de conexión con la nube.", "error");
            }
        })();
    }
    
    // Habilitar impresión, PDF y previsualización tras guardar exitosamente
    document.getElementById('print-btn-form').classList.remove('hidden');
    document.getElementById('pdf-btn-form').classList.remove('hidden');
    document.getElementById('preview-btn-form').classList.remove('hidden');
    
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
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.tipo ? escapeHTML(item.tipo) : '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.marca ? escapeHTML(item.marca) : '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.modelo ? escapeHTML(item.modelo) : '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-mono print-calibri-12">${item.serie ? escapeHTML(item.serie) : '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-mono print-calibri-12">${item.inventario ? escapeHTML(item.inventario) : '&nbsp;'}</td>
            <td class="border border-black p-1.5 h-8 font-medium print-calibri-12">${item.obs ? escapeHTML(item.obs) : '&nbsp;'}</td>
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
            const eqSummary = s.equipamiento.map(e => `${escapeHTML(e.tipo)} (${escapeHTML(e.marca)} ${escapeHTML(e.modelo)})`).join(', ');

            const deleteBtnHtml = currentUserRole === 'admin' ? `
                <button onclick="deleteSubmission('${s.id}')" class="p-2 text-rose-500 hover:text-rose-755 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors" title="Eliminar">
                    <i data-lucide="trash-2" class="w-4.5 h-4.5"></i>
                </button>
            ` : '';

            tr.innerHTML = `
                <td class="py-4 px-6 font-medium text-slate-900 dark:text-slate-100">${escapeHTML(s.fecha)}</td>
                <td class="py-4 px-6 font-mono text-xs text-indigo-650 dark:text-indigo-400 font-semibold">${escapeHTML(s.ticket)}</td>
                <td class="py-4 px-6">
                    <div class="font-medium text-slate-850 dark:text-slate-200">${escapeHTML(s.funcionario.nombre)}</div>
                    <div class="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">${escapeHTML(s.funcionario.rut)}</div>
                </td>
                <td class="py-4 px-6">${badgesSolicitud}</td>
                <td class="py-4 px-6 max-w-xs truncate text-slate-500 dark:text-slate-450" title="${eqSummary}">${eqSummary}</td>
                <td class="py-4 px-6 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="viewAndEditForm('${s.id}')" class="p-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors" title="Ver / Editar">
                            <i data-lucide="edit" class="w-4.5 h-4.5"></i>
                        </button>
                        <button onclick="exportSubmissionToPDF('${s.id}')" class="p-2 text-emerald-600 dark:text-emerald-450 hover:text-emerald-850 dark:hover:text-emerald-300 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors" title="Descargar PDF">
                            <i data-lucide="file-text" class="w-4.5 h-4.5"></i>
                        </button>
                        ${deleteBtnHtml}
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
    
    // Si el rol es técnico, deshabilitar edición
    setFormReadOnly(currentUserRole === 'tecnico');
    
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

    // Habilitar botones de acción porque ya existe registro guardado
    document.getElementById('print-btn-form').classList.remove('hidden');
    document.getElementById('pdf-btn-form').classList.remove('hidden');
    document.getElementById('preview-btn-form').classList.remove('hidden');

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
        
        // Agrupar filas de catastro por RUT (o Nombre si no hay RUT)
        const grouped = {};
        rawEquipos.forEach(item => {
            const nombre = item['Nombre Funcionario'] || item['Nombre'];
            const serie = item['Serie'] || item['N° Serie'];
            
            // Omitir filas vacías de la plantilla
            if (!nombre || String(nombre).trim().length === 0 || !serie || String(serie).trim().length === 0) {
                return;
            }
            
            const rawRut = String(item['Rut'] || '').trim();
            const rutKey = formatRut(rawRut);
            const key = (rutKey && rutKey !== '-') ? rutKey : ('name_' + String(nombre).trim().toLowerCase());
            
            if (!grouped[key]) {
                grouped[key] = {
                    nombre: String(nombre).trim(),
                    rut: (rutKey && rutKey !== '-') ? rutKey : '',
                    cargo: String(item['Cargo'] || '').trim(),
                    depto: String(item['Departamento'] || '').trim(),
                    propiedad: item['EsInventario'] === true || String(item['EsInventario']).toLowerCase() === 'true' ? 'Propiedad ISP' : 'En Arriendo',
                    equipos: []
                };
            } else {
                // Si el nombre de esta fila es más largo/completo, lo preferimos para el grupo
                const currentName = grouped[key].nombre;
                const newName = String(nombre).trim();
                if (newName.length > currentName.length) {
                    grouped[key].nombre = newName;
                }
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
                const isDup = grouped[key].equipos.some(e => 
                    (e.serie || '').trim().toUpperCase() === (eq.serie || '').trim().toUpperCase()
                );
                if (!isDup) {
                    grouped[key].equipos.push(eq);
                }
            });
        });
        
        // Crear las solicitudes agrupadas en LocalStorage
        Object.keys(grouped).forEach(key => {
            const group = grouped[key];
            // ID determinista basado en el RUT o clave para evitar duplicar
            const subId = 'sub_excel_' + key.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
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

// Mostrar sugerencias de auto-completado en base a la consulta de búsqueda (Local + Supabase Cloud)
async function showExcelSuggestions(query) {
    const dropdown = document.getElementById('excel-suggestions-dropdown');
    dropdown.innerHTML = '';
    
    if (!query || query.trim().length < 2) {
        dropdown.classList.add('hidden');
        return;
    }
    
    const term = query.toLowerCase().trim();
    const localMatches = [];
    
    // 1. Búsqueda local en caché (Excel)
    for (let i = 0; i < loadedAllEquipments.length; i++) {
        const item = loadedAllEquipments[i];
        const matchFunc = (item.funcionario || '').toLowerCase().includes(term);
        const matchSerie = (item.serie || '').toLowerCase().includes(term);
        const matchInv = (item.inventario || '').toLowerCase().includes(term);
        const matchMail = (item.mail || '').toLowerCase().includes(term);
        
        if (matchFunc || matchSerie || matchInv || matchMail) {
            localMatches.push({ ...item, isLocal: true, index: i });
        }
        if (localMatches.length >= 10) break;
    }

    let combinedMatches = [...localMatches];

    // 2. Búsqueda remota en Supabase catastro_equipos (si está disponible)
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('catastro_equipos')
                .select('*')
                .or(`funcionario.ilike.%${term}%,serie.ilike.%${term}%,inventario.ilike.%${term}%,mail.ilike.%${term}%`)
                .limit(10);
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                // Mapear los datos de Supabase al formato esperado
                const remoteMatches = data.map(row => ({
                    n: row.n,
                    inventario: row.inventario,
                    serie: row.serie,
                    tipo: row.tipo,
                    marca: row.marca,
                    modelo: row.modelo,
                    propiedad: row.propiedad,
                    funcionario: row.funcionario,
                    mail: row.mail,
                    depto: row.depto,
                    estado: row.estado,
                    observaciones: row.observaciones,
                    sheet: row.sheet,
                    isLocal: false
                }));

                // Combinar y eliminar duplicados por Número de Serie (dando prioridad al registro de Supabase)
                const merged = [];
                const seenSeries = new Set();

                // Primero añadir remotos
                remoteMatches.forEach(item => {
                    if (item.serie) {
                        seenSeries.add(item.serie.toLowerCase().trim());
                        merged.push(item);
                    }
                });

                // Luego añadir locales si no están en vistos
                localMatches.forEach(item => {
                    if (item.serie && !seenSeries.has(item.serie.toLowerCase().trim())) {
                        merged.push(item);
                    }
                });

                combinedMatches = merged.slice(0, 10);
            }
        } catch (e) {
            console.error("Error al buscar en Supabase catastro_equipos:", e.message);
        }
    }
    
    if (combinedMatches.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-center text-slate-450">No se encontraron coincidencias en el catastro.</div>';
        dropdown.classList.remove('hidden');
        return;
    }
    
    combinedMatches.forEach(item => {
        const div = document.createElement('div');
        div.className = "p-3 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors flex justify-between items-center";
        
        // Adjuntar el item al elemento DOM mediante una propiedad custom para que selectExcelSuggestion pueda leerlo
        div.dataset.itemJson = JSON.stringify(item);
        div.onclick = () => selectExcelSuggestion(JSON.parse(div.dataset.itemJson));
        
        const badgeClass = item.sheet === 'Computadores' 
            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' 
            : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400';
        
        const sourceBadge = item.isLocal 
            ? '<span class="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded ml-1">Excel</span>' 
            : '<span class="text-[9px] bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-450 px-1 py-0.5 rounded ml-1 font-bold">Nube</span>';
            
        div.innerHTML = `
            <div>
                <div class="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                    ${item.funcionario ? escapeHTML(item.funcionario) : 'Sin Funcionario asignado'}
                    ${sourceBadge}
                </div>
                <div class="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">S/N: ${escapeHTML(item.serie)} | Inv: ${item.inventario ? escapeHTML(item.inventario) : 'S/N'}</div>
            </div>
            <div class="text-right text-[10px]">
                <span class="px-2 py-0.5 rounded-full font-semibold ${badgeClass}">${item.tipo ? escapeHTML(item.tipo) : 'Equipo'}</span>
                <div class="text-slate-400 dark:text-slate-500 mt-1">${escapeHTML(item.marca || '')} ${escapeHTML(item.modelo || '')}</div>
            </div>
        `;
        dropdown.appendChild(div);
    });
    
    dropdown.classList.remove('hidden');
}

// Rellenar automáticamente los datos del formulario al seleccionar una sugerencia (recibe el objeto item directamente)
function selectExcelSuggestion(item) {
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
    
    // 3. Buscar todos los equipos asignados a este funcionario en el catastro Excel
    const targetFunc = (item.funcionario || '').trim().toLowerCase();
    const relatedEquipments = loadedAllEquipments.filter(e => 
        (e.funcionario || '').trim().toLowerCase() === targetFunc
    );
    
    // 4. Limpiar tabla de equipamiento
    const container = document.getElementById('equipment-rows');
    container.innerHTML = '';
    
    const finalEquipments = relatedEquipments.length > 0 ? relatedEquipments : [item];
    const addedSeries = new Set();
    
    // 5. Agregar todos los equipos encontrados
    finalEquipments.forEach(eqItem => {
        const serialKey = (eqItem.serie || '').trim().toUpperCase();
        if (serialKey && addedSeries.has(serialKey)) return;
        if (serialKey) addedSeries.add(serialKey);
        
        const splitItems = splitEquipmentIfCombined({
            tipo: eqItem.tipo,
            marca: eqItem.marca,
            modelo: eqItem.modelo,
            serie: eqItem.serie,
            inventario: eqItem.inventario,
            observacion: ''
        });
        
        splitItems.forEach(splitItem => {
            addEquipmentRow(splitItem);
        });
    });
    
    // Sincronizar checkboxes de categoría
    syncEquipmentCategoriesFromRows();
    
    // Limpiar barra de búsqueda y ocultar dropdown
    document.getElementById('excel-autocomplete-input').value = '';
    document.getElementById('excel-suggestions-dropdown').classList.add('hidden');
    
    showToast(`Se auto-rellenaron ${addedSeries.size} equipos para el funcionario.`, "success");
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
                        <span class="text-slate-700 dark:text-slate-300 truncate max-w-[200px]" title="${escapeHTML(dept.name)}">${escapeHTML(dept.name)}</span>
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
                        <span class="font-bold text-slate-700 dark:text-slate-300 block">${escapeHTML(t.name)}</span>
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

        // =======================================================================
        // RENDERIZAR GRÁFICOS INTERACTIVOS (CHART.JS)
        // =======================================================================
        const isDark = document.documentElement.classList.contains('dark');
        const textColor = isDark ? '#94a3b8' : '#475569';
        const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(71, 85, 105, 0.08)';

        // A. Gráfico de Barras - Departamentos (Horizontal)
        if (chartDeptsInstance) chartDeptsInstance.destroy();
        
        const canvasDepts = document.getElementById('chart-depts');
        if (canvasDepts && topDepts.length > 0) {
            chartDeptsInstance = new Chart(canvasDepts.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: topDepts.map(d => d.name),
                    datasets: [
                        {
                            label: 'Catastrados',
                            data: topDepts.map(d => d.catastrado),
                            backgroundColor: 'rgba(79, 70, 229, 0.85)',
                            borderColor: '#4f46e5',
                            borderWidth: 1.5,
                            borderRadius: 6
                        },
                        {
                            label: 'Pendientes',
                            data: topDepts.map(d => d.total - d.catastrado),
                            backgroundColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(241, 245, 249, 0.9)',
                            borderColor: isDark ? '#475569' : '#cbd5e1',
                            borderWidth: 1.5,
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: textColor, boxWidth: 12, font: { family: 'Inter', size: 11 } }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'monospace', size: 10 } }
                        },
                        y: {
                            stacked: true,
                            grid: { display: false },
                            ticks: { color: textColor, font: { family: 'Inter', size: 9, weight: '500' } }
                        }
                    }
                }
            });
        }

        // B. Gráfico de Dona - Distribución de Tipos
        if (chartTypesInstance) chartTypesInstance.destroy();
        
        const canvasTypes = document.getElementById('chart-types');
        if (canvasTypes && sortedTypes.length > 0) {
            chartTypesInstance = new Chart(canvasTypes.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: sortedTypes.map(t => t.name),
                    datasets: [{
                        data: sortedTypes.map(t => t.total),
                        backgroundColor: [
                            'rgba(79, 70, 229, 0.85)',  // Indigo
                            'rgba(59, 130, 246, 0.85)',  // Blue
                            'rgba(139, 92, 246, 0.85)',  // Violet
                            'rgba(16, 185, 129, 0.85)',  // Emerald
                            'rgba(245, 158, 11, 0.85)',  // Amber
                            'rgba(244, 63, 94, 0.85)'    // Rose
                        ],
                        borderColor: isDark ? '#0f172a' : '#ffffff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: textColor, boxWidth: 12, font: { family: 'Inter', size: 11 } }
                        }
                    },
                    cutout: '65%'
                }
            });
        }
    }
    
    // Ejecutar detección de duplicados y discrepancias
    detectDuplicatesAndInconsistencies();
}

// Algoritmo de distancia de Levenshtein para medir similitud de nombres
function levenshteinDistance(s1, s2) {
    s1 = (s1 || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    s2 = (s2 || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (s1 === s2) return 0;
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;
    
    const matrix = [];
    for (let i = 0; i <= s2.length; i++) matrix[i] = [i];
    for (let j = 0; j <= s1.length; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= s2.length; i++) {
        for (let j = 1; j <= s1.length; j++) {
            if (s2[i-1] === s1[j-1]) {
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i-1][j-1] + 1, // sustitución
                    matrix[i][j-1] + 1,   // inserción
                    matrix[i-1][j] + 1    // eliminación
                );
            }
        }
    }
    return matrix[s2.length][s1.length];
}

// Lógica de detección de inconsistencias de usuarios y duplicados de equipamiento
function detectDuplicatesAndInconsistencies() {
    const duplicateUsersContainer = document.getElementById('duplicate-users-container');
    const duplicateEquipContainer = document.getElementById('duplicate-equip-container');
    
    if (!duplicateUsersContainer || !duplicateEquipContainer) return;
    
    duplicateUsersContainer.innerHTML = '';
    duplicateEquipContainer.innerHTML = '';
    
    let userAlerts = [];
    let equipAlerts = [];
    
    // --- 1. INCONSISTENCIAS DE USUARIOS ---
    const rutToNames = new Map(); // rutKey -> { namesInSubmissions: Set, namesInExcel: Set }
    
    // Recolectar nombres asociados a RUTs desde submissions (formularios)
    submissions.forEach(sub => {
        const rawRut = sub.funcionario && sub.funcionario.rut;
        if (!rawRut) return;
        const rutKey = formatRut(rawRut);
        if (!rutToNames.has(rutKey)) {
            rutToNames.set(rutKey, { namesInSubmissions: new Set(), namesInExcel: new Set() });
        }
        if (sub.funcionario.nombre) {
            rutToNames.get(rutKey).namesInSubmissions.add(sub.funcionario.nombre.trim());
        }
    });
    
    // Recolectar nombres asociados a RUTs desde Excel (si coinciden con RUTs conocidos)
    const nameToRutMap = new Map();
    submissions.forEach(sub => {
        if (sub.funcionario && sub.funcionario.nombre && sub.funcionario.rut) {
            nameToRutMap.set(sub.funcionario.nombre.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), formatRut(sub.funcionario.rut));
        }
    });
    
    loadedAllEquipments.forEach(eq => {
        if (!eq.funcionario) return;
        const normExcelName = eq.funcionario.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const rutKey = nameToRutMap.get(normExcelName);
        if (rutKey) {
            if (!rutToNames.has(rutKey)) {
                rutToNames.set(rutKey, { namesInSubmissions: new Set(), namesInExcel: new Set() });
            }
            rutToNames.get(rutKey).namesInExcel.add(eq.funcionario.trim());
        }
    });
    
    // A. Detectar discrepancias de nombre para el mismo RUT (Excel vs Formularios)
    rutToNames.forEach((data, rut) => {
        const subsNames = Array.from(data.namesInSubmissions);
        const excelNames = Array.from(data.namesInExcel);
        
        if (subsNames.length > 0 && excelNames.length > 0) {
            const subName = subsNames[0];
            const excelName = excelNames[0];
            
            // Si el nombre no coincide exactamente (ignorando acentos y mayúsculas)
            const normSub = subName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const normExcel = excelName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            if (normSub !== normExcel) {
                userAlerts.push({
                    type: 'discrepancy',
                    title: `Discrepancia de Nombre (RUT ${escapeHTML(rut)})`,
                    desc: `En Formularios: <strong>"${escapeHTML(subName)}"</strong> <br>En Excel Catastro: <strong>"${escapeHTML(excelName)}"</strong>`,
                    severity: 'amber'
                });
            }
        }
    });
    
    // B. Detectar Nombres muy similares pero con RUTs diferentes (posibles errores de tipeo de RUT)
    const uniqueFuncs = [];
    const seenRuts = new Set();
    
    submissions.forEach(sub => {
        if (sub.funcionario && sub.funcionario.rut && sub.funcionario.nombre) {
            const normalizedRut = formatRut(sub.funcionario.rut);
            if (!seenRuts.has(normalizedRut)) {
                seenRuts.add(normalizedRut);
                uniqueFuncs.push({
                    nombre: sub.funcionario.nombre.trim(),
                    rut: normalizedRut
                });
            }
        }
    });
    
    for (let i = 0; i < uniqueFuncs.length; i++) {
        for (let j = i + 1; j < uniqueFuncs.length; j++) {
            const f1 = uniqueFuncs[i];
            const f2 = uniqueFuncs[j];
            
            const dist = levenshteinDistance(f1.nombre, f2.nombre);
            if (dist > 0 && dist <= 2) {
                userAlerts.push({
                    type: 'similar_names',
                    title: `Nombres similares con RUTs diferentes`,
                    desc: `• <strong>"${escapeHTML(f1.nombre)}"</strong> con RUT: ${escapeHTML(f1.rut)}<br>• <strong>"${escapeHTML(f2.nombre)}"</strong> con RUT: ${escapeHTML(f2.rut)}`,
                    severity: 'rose'
                });
            }
        }
    }
    
    // --- 2. CONFLICTOS DE EQUIPAMIENTO ---
    const serieToAssignments = new Map(); // serie -> Array de { source, ownerName, detail }
    
    // Equipamiento en formularios activos
    submissions.forEach(sub => {
        if (sub.equipamiento) {
            sub.equipamiento.forEach(eq => {
                const sKey = (eq.serie || '').trim().toUpperCase();
                if (!sKey || sKey === 'S/N' || sKey === 'SIN SERIE' || sKey === '-') return;
                
                if (!serieToAssignments.has(sKey)) {
                    serieToAssignments.set(sKey, []);
                }
                serieToAssignments.get(sKey).push({
                    source: 'Formulario',
                    ownerName: sub.funcionario.nombre,
                    detail: `Ticket: ${sub.ticket || 'S/N'} (${sub.tipo_solicitud})`
                });
            });
        }
    });
    
    // Equipamiento en Excel catastrado
    loadedAllEquipments.forEach(eq => {
        const sKey = (eq.serie || '').trim().toUpperCase();
        if (!sKey || sKey === 'S/N' || sKey === 'SIN SERIE' || sKey === '-') return;
        
        if (eq.funcionario && eq.funcionario.trim().length > 0) {
            if (!serieToAssignments.has(sKey)) {
                serieToAssignments.set(sKey, []);
            }
            serieToAssignments.get(sKey).push({
                source: 'Excel',
                ownerName: eq.funcionario,
                detail: `Inventario Excel (${eq.tipo || 'Equipo'})`
            });
        }
    });
    
    // Detectar conflictos por número de serie
    serieToAssignments.forEach((assigns, serie) => {
        const uniqueOwners = [];
        assigns.forEach(a => {
            const normName = a.ownerName.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (!uniqueOwners.some(o => o.normName === normName)) {
                uniqueOwners.push({ normName, name: a.ownerName, detail: a.detail, source: a.source });
            }
        });
        
        if (uniqueOwners.length > 1) {
            const formAssigns = assigns.filter(a => a.source === 'Formulario');
            
            // Si hay más de un propietario único en formularios diferentes
            if (formAssigns.length > 1 && formAssigns.some((val, index, array) => val.ownerName !== array[0].ownerName)) {
                const descDetails = assigns.map(a => `• <strong>${escapeHTML(a.ownerName)}</strong> en ${escapeHTML(a.detail)}`).join('<br>');
                equipAlerts.push({
                    type: 'duplicate_form',
                    title: `Serie duplicada en múltiples Formularios`,
                    desc: `N° Serie: <strong>${escapeHTML(serie)}</strong> asignada a:<br>${descDetails}`,
                    severity: 'rose'
                });
            } else {
                // Si la discrepancia es entre Excel y Formularios
                const descDetails = assigns.map(a => `• <strong>${escapeHTML(a.ownerName)}</strong> en ${escapeHTML(a.detail)}`).join('<br>');
                equipAlerts.push({
                    type: 'excel_discrepancy',
                    title: `Discrepancia Catastro vs Formularios`,
                    desc: `N° Serie: <strong>${escapeHTML(serie)}</strong> asignada a:<br>${descDetails}`,
                    severity: 'amber'
                });
            }
        }
    });
    
    // --- 3. RENDERIZAR INCONSISTENCIAS DE USUARIOS ---
    if (userAlerts.length === 0) {
        duplicateUsersContainer.innerHTML = `
            <div class="flex items-center gap-2 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-450 border border-emerald-100 dark:border-emerald-900/50 text-xs font-semibold">
                <i data-lucide="check-circle-2" class="w-4.5 h-4.5 text-emerald-500"></i>
                Sin inconsistencias de usuarios detectadas.
            </div>
        `;
    } else {
        userAlerts.forEach(alert => {
            const div = document.createElement('div');
            const bgClass = alert.severity === 'rose' ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-350' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-350';
            const icon = alert.severity === 'rose' ? 'alert-octagon' : 'alert-circle';
            
            div.className = `p-3 rounded-2xl border text-xs leading-relaxed ${bgClass}`;
            div.innerHTML = `
                <div class="font-bold flex items-center gap-1.5 mb-1 text-[13px]">
                    <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
                    ${alert.title}
                </div>
                <div>${alert.desc}</div>
            `;
            duplicateUsersContainer.appendChild(div);
        });
    }
    
    // --- 4. RENDERIZAR ALERTAS DE EQUIPOS ---
    if (equipAlerts.length === 0) {
        duplicateEquipContainer.innerHTML = `
            <div class="flex items-center gap-2 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-450 border border-emerald-100 dark:border-emerald-900/50 text-xs font-semibold">
                <i data-lucide="check-circle-2" class="w-4.5 h-4.5 text-emerald-500"></i>
                Sin conflictos de números de serie detectados.
            </div>
        `;
    } else {
        equipAlerts.forEach(alert => {
            const div = document.createElement('div');
            const bgClass = alert.severity === 'rose' ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-350' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-350';
            const icon = alert.severity === 'rose' ? 'alert-octagon' : 'alert-circle';
            
            div.className = `p-3 rounded-2xl border text-xs leading-relaxed ${bgClass}`;
            div.innerHTML = `
                <div class="font-bold flex items-center gap-1.5 mb-1 text-[13px]">
                    <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
                    ${alert.title}
                </div>
                <div>${alert.desc}</div>
            `;
            duplicateEquipContainer.appendChild(div);
        });
    }
    
    lucide.createIcons();
}

// =======================================================================
// NUEVAS FUNCIONES DE HISTORIAL, PREVISUALIZACIÓN, PDF Y VALIDACIONES
// =======================================================================

// Exportar un registro a PDF usando html2pdf.js local
function exportSubmissionToPDF(id) {
    const s = submissions.find(sub => sub.id === id);
    if (!s) {
        showToast("Registro no encontrado.", "error");
        return;
    }
    
    // Cargar datos en el formulario y sincronizar la plantilla de impresión
    viewAndEditForm(id);
    syncPrintTemplate();
    
    const element = document.getElementById('print-only-container');
    if (!element) {
        showToast("Error: No se encontró el contenedor de impresión.", "error");
        return;
    }
    
    // Hacer visible temporalmente el print-only-container eliminando hidden y forzando block
    element.classList.remove('hidden');
    element.classList.add('block');
    
    // Opciones de configuración de html2pdf.js
    const opt = {
        margin:       0,
        filename:     `RG-02-IT-140.03-004_V5_Ticket-${s.ticket || 'SN'}_${s.funcionario.nombre.replace(/\s+/g, '_')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, 
            useCORS: true, 
            logging: false,
            letterRendering: true,
            scrollX: 0,
            scrollY: 0
        },
        jsPDF:        { 
            unit: 'mm', 
            format: [216, 330], // Tamaño Oficio Chileno (216mm x 330mm)
            orientation: 'portrait' 
        },
        pagebreak:    { mode: ['css', 'legacy'] }
    };
    
    showToast("Generando documento PDF...", "success");
    
    // Renderizar y guardar PDF
    html2pdf().set(opt).from(element).save().then(() => {
        // Restaurar estado de oculto
        element.classList.add('hidden');
        element.classList.remove('block');
        showToast("PDF descargado correctamente.", "success");
    }).catch(err => {
        console.error("Error al generar PDF con html2pdf.js:", err);
        element.classList.add('hidden');
        element.classList.remove('block');
        showToast("Error al exportar a PDF.", "error");
    });
}

function exportActiveSubmissionToPDF() {
    if (activeSubmissionId) {
        exportSubmissionToPDF(activeSubmissionId);
    } else {
        showToast("Primero guarde el registro para poder exportarlo a PDF.", "error");
    }
}

// Modal de Previsualización
function openPreviewModal() {
    // Sincronizar datos del formulario a la plantilla de impresión
    syncPrintTemplate();
    
    const printContainer = document.getElementById('print-only-container');
    const previewContainer = document.getElementById('preview-frame-container');
    const modal = document.getElementById('preview-modal');
    
    if (!printContainer || !previewContainer || !modal) return;
    
    // Limpiar el frame anterior
    previewContainer.innerHTML = '';
    
    // Clonar el contenido del contenedor de impresión
    const clone = printContainer.cloneNode(true);
    
    // Quitar la clase hidden y print:block del contenedor clonado para que se muestre en pantalla
    clone.id = 'preview-cloned-container';
    clone.classList.remove('hidden', 'print:block');
    clone.classList.add('block', 'w-full', 'flex', 'flex-col', 'items-center', 'gap-6');
    
    // Copiar las firmas dibujadas en los canvases clonados
    const originalImgIds = ['print-sig-tic-img', 'print-sig-emisor-img', 'print-sig-receptor-img'];
    originalImgIds.forEach(id => {
        const originalImg = printContainer.querySelector(`#${id}`);
        const clonedImg = clone.querySelector(`#${id}`);
        if (originalImg && clonedImg) {
            clonedImg.src = originalImg.src;
            if (originalImg.classList.contains('hidden')) {
                clonedImg.classList.add('hidden');
            } else {
                clonedImg.classList.remove('hidden');
            }
        }
    });
    
    // Inyectar el clon en el viewport del modal
    previewContainer.appendChild(clone);
    
    // Mostrar el modal
    modal.classList.remove('hidden');
    
    // Re-inicializar iconos Lucide en el modal
    lucide.createIcons();
}

function closePreviewModal() {
    const modal = document.getElementById('preview-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function triggerPDFExportFromPreview() {
    closePreviewModal();
    if (activeSubmissionId) {
        exportSubmissionToPDF(activeSubmissionId);
    } else {
        showToast("Guarde el formulario antes de exportarlo como PDF.", "error");
    }
}

function triggerPrintFromPreview() {
    closePreviewModal();
    triggerPrintMode();
}

// Historial y Sugerencias de Trazabilidad
function showHistorySuggestions(query) {
    const dropdown = document.getElementById('history-suggestions-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    if (!query || query.trim().length < 1) {
        dropdown.classList.add('hidden');
        return;
    }
    
    const term = query.toLowerCase().trim();
    
    // Recopilar números de serie únicos
    const matches = new Map(); // serie -> info
    
    // 1. Buscar en registros locales (submissions)
    submissions.forEach(sub => {
        if (sub.equipamiento) {
            sub.equipamiento.forEach(eq => {
                if (eq.serie && eq.serie.toLowerCase().includes(term)) {
                    matches.set(eq.serie.toUpperCase(), {
                        serie: eq.serie.toUpperCase(),
                        tipo: eq.tipo,
                        marca: eq.marca,
                        modelo: eq.modelo,
                        funcionario: sub.funcionario.nombre,
                        origen: 'Historial'
                    });
                }
            });
        }
    });
    
    // 2. Buscar en planilla Excel catastrada
    loadedAllEquipments.forEach(item => {
        if (item.serie && item.serie.toLowerCase().includes(term)) {
            if (!matches.has(item.serie.toUpperCase())) {
                matches.set(item.serie.toUpperCase(), {
                    serie: item.serie.toUpperCase(),
                    tipo: item.tipo,
                    marca: item.marca,
                    modelo: item.modelo,
                    funcionario: item.funcionario,
                    origen: 'Catastro Excel'
                });
            }
        }
    });
    
    const matchesArr = Array.from(matches.values()).slice(0, 8);
    
    if (matchesArr.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-center text-slate-450">No se encontraron números de serie.</div>';
        dropdown.classList.remove('hidden');
        return;
    }
    
    matchesArr.forEach(item => {
        const div = document.createElement('div');
        div.className = "p-3 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors flex justify-between items-center";
        div.onclick = () => selectHistoryEquipment(item.serie);
        
        div.innerHTML = `
            <div>
                <div class="font-bold text-slate-850 dark:text-slate-200 font-mono">S/N: ${escapeHTML(item.serie)}</div>
                <div class="text-[10px] text-slate-450 dark:text-slate-500 mt-0.5">${escapeHTML(item.marca || '')} ${escapeHTML(item.modelo || '')}</div>
            </div>
            <div class="text-right text-[10px]">
                <span class="px-2 py-0.5 rounded-full font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400">${item.tipo ? escapeHTML(item.tipo) : 'Equipo'}</span>
                <div class="text-slate-450 dark:text-slate-500 mt-1">Ref: ${escapeHTML(item.origen)}</div>
            </div>
        `;
        dropdown.appendChild(div);
    });
    dropdown.classList.remove('hidden');
}

function selectHistoryEquipment(serie) {
    const input = document.getElementById('history-search-input');
    if (input) input.value = serie;
    
    const dropdown = document.getElementById('history-suggestions-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
    
    renderHistoryTimeline(serie);
}

function resetHistoryTab() {
    const input = document.getElementById('history-search-input');
    if (input) input.value = '';
    
    const dropdown = document.getElementById('history-suggestions-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
    
    document.getElementById('history-results').classList.add('hidden');
    document.getElementById('history-empty-state').classList.remove('hidden');
}

function renderHistoryTimeline(serie) {
    const term = serie.trim().toUpperCase();
    const timeline = document.getElementById('history-timeline');
    const eqInfo = document.getElementById('history-eq-info');
    const results = document.getElementById('history-results');
    const emptyState = document.getElementById('history-empty-state');
    
    if (!timeline || !eqInfo || !results || !emptyState) return;
    
    // Encontrar todas las transacciones locales para este N° de Serie
    const moves = [];
    submissions.forEach(sub => {
        if (sub.equipamiento) {
            sub.equipamiento.forEach(eq => {
                if (eq.serie && eq.serie.trim().toUpperCase() === term) {
                    moves.push({
                        subId: sub.id,
                        fecha: sub.fecha,
                        ticket: sub.ticket,
                        tipo_solicitud: sub.tipo_solicitud,
                        propiedad: sub.propiedad_equipamiento,
                        funcionario: sub.funcionario.nombre,
                        depto: sub.funcionario.depto,
                        cargo: sub.funcionario.cargo,
                        traspaso: sub.traspaso,
                        observacion: eq.observacion,
                        eqInfo: eq
                    });
                }
            });
        }
    });
    
    // Ordenar movimientos por fecha (más reciente arriba)
    moves.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    // Intentar buscar en la base del Excel catastrado para rellenar la ficha general
    const excelMatch = loadedAllEquipments.find(e => e.serie && e.serie.trim().toUpperCase() === term);
    
    let eqMarca = 'Desconocida';
    let eqModelo = 'Desconocido';
    let eqTipo = 'Equipo';
    let eqInventario = 'S/N';
    let eqPropiedad = 'En Arriendo';
    let eqUbicacionExcel = '';
    let eqFuncionarioExcel = '';
    
    if (moves.length > 0) {
        const lastMove = moves[0];
        eqMarca = lastMove.eqInfo.marca || eqMarca;
        eqModelo = lastMove.eqInfo.modelo || eqModelo;
        eqTipo = lastMove.eqInfo.tipo || eqTipo;
        eqInventario = lastMove.eqInfo.inventario || eqInventario;
        eqPropiedad = lastMove.propiedad || eqPropiedad;
    }
    
    if (excelMatch) {
        eqMarca = excelMatch.marca || eqMarca;
        eqModelo = excelMatch.modelo || eqModelo;
        eqTipo = excelMatch.tipo || eqTipo;
        eqInventario = excelMatch.inventario || eqInventario;
        eqPropiedad = excelMatch.propiedad || eqPropiedad;
        eqUbicacionExcel = excelMatch.depto || '';
        eqFuncionarioExcel = excelMatch.funcionario || '';
    }
    
    if (moves.length === 0 && !excelMatch) {
        showToast("No se encontraron registros ni catastro para el número de serie ingresado.", "error");
        resetHistoryTab();
        return;
    }
    
    emptyState.classList.add('hidden');
    results.classList.remove('hidden');
    
    const badgeClass = eqPropiedad.includes('Arriendo') 
        ? 'bg-amber-50 dark:bg-amber-955/40 text-amber-700 dark:text-amber-400' 
        : 'bg-emerald-50 dark:bg-emerald-955/40 text-emerald-700 dark:text-emerald-450';
        
    let excelBadgeText = '';
    if (excelMatch) {
        const estLower = String(excelMatch.estado || '').toLowerCase();
        if (estLower.includes('catastrado')) {
            excelBadgeText = `<span class="px-2 py-0.5 rounded bg-emerald-500 text-white font-bold text-[9px] uppercase tracking-wide shadow-sm flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>Catastrado en Planilla</span>`;
        } else {
            excelBadgeText = `<span class="px-2 py-0.5 rounded bg-slate-400 text-white font-bold text-[9px] uppercase tracking-wide">Disponible en Planilla</span>`;
        }
    }
    
    eqInfo.innerHTML = `
        <div class="space-y-2">
            <div class="flex items-center gap-3">
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-650 dark:text-indigo-400 flex items-center gap-1.5"><i data-lucide="laptop" class="w-4 h-4"></i> ${escapeHTML(eqTipo)}</span>
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold ${badgeClass}">${escapeHTML(eqPropiedad)}</span>
                ${excelBadgeText}
            </div>
            <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">${escapeHTML(eqMarca)} ${escapeHTML(eqModelo)}</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-xs text-slate-500 dark:text-slate-455 font-medium">
                <div><strong>N° Serie:</strong> <span class="font-mono text-indigo-600 dark:text-indigo-400 font-bold">${escapeHTML(term)}</span></div>
                <div><strong>N° Inventario:</strong> <span class="font-mono">${escapeHTML(eqInventario || 'Sin Inventario')}</span></div>
                ${eqFuncionarioExcel ? `<div><strong>Titular Catastral:</strong> ${escapeHTML(eqFuncionarioExcel)}</div>` : ''}
                ${eqUbicacionExcel ? `<div><strong>Ubicación Catastral:</strong> ${escapeHTML(eqUbicacionExcel)}</div>` : ''}
            </div>
        </div>
        <div class="bg-indigo-50/50 dark:bg-indigo-950/20 p-4 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30 text-center max-w-xs w-full">
            <span class="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider block">Movimientos Registrados</span>
            <span class="text-3xl font-extrabold text-indigo-650 dark:text-indigo-400 block mt-1">${moves.length}</span>
        </div>
    `;
    
    timeline.innerHTML = '';
    
    if (moves.length === 0) {
        timeline.innerHTML = `
            <div class="text-slate-450 dark:text-slate-500 text-xs py-4">
                El equipo se encuentra registrado en el Catastro Excel, pero no ha tenido transacciones de Asignación, Traspaso o Devolución firmadas en el sistema.
            </div>
        `;
    } else {
        moves.forEach(m => {
            const itemDiv = document.createElement('div');
            itemDiv.className = "timeline-item pl-4";
            
            let colorMarker = 'asignacion';
            let title = '';
            let contentHtml = '';
            
            if (m.tipo_solicitud === 'Asignacion') {
                colorMarker = 'asignacion';
                title = `Asignación de Equipo (Entrega)`;
                contentHtml = `
                    <p class="text-slate-650 dark:text-slate-350 text-xs">Asignado al funcionario <strong>${escapeHTML(m.funcionario)}</strong> (${escapeHTML(m.cargo)}) del departamento <strong>${escapeHTML(m.depto)}</strong>.</p>
                `;
            } else if (m.tipo_solicitud === 'Traspaso') {
                colorMarker = 'traspaso';
                const emisor = m.traspaso ? escapeHTML(m.traspaso.emisor_nombre) : 'Emisor no registrado';
                const receptor = m.traspaso ? escapeHTML(m.traspaso.receptor_nombre) : 'Receptor no registrado';
                const obs = m.traspaso && m.traspaso.observacion ? `<div class="mt-2 p-2 bg-amber-500/5 rounded border border-amber-500/10 text-amber-800 dark:text-amber-350 italic text-[11px]">Obs: "${escapeHTML(m.traspaso.observacion)}"</div>` : '';
                title = `Traspaso de Equipamiento`;
                contentHtml = `
                    <p class="text-slate-650 dark:text-slate-350 text-xs">
                        Traspaso de <strong>${emisor}</strong> a <strong>${receptor}</strong>.<br>
                        Firmante del traspaso: <strong>${escapeHTML(m.funcionario)}</strong>.
                    </p>
                    ${obs}
                `;
            } else {
                colorMarker = 'devolucion';
                title = `Devolución de Equipo`;
                contentHtml = `
                    <p class="text-slate-650 dark:text-slate-350 text-xs">Devuelto por el funcionario <strong>${escapeHTML(m.funcionario)}</strong> del departamento <strong>${escapeHTML(m.depto)}</strong>.</p>
                `;
            }
            
            itemDiv.innerHTML = `
                <div class="timeline-marker ${colorMarker}"></div>
                <div class="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 rounded-2xl shadow-sm space-y-2 hover:shadow-md transition-shadow">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                        <span class="text-xs font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5"><i data-lucide="clock" class="w-3.5 h-3.5 text-indigo-500"></i> ${escapeHTML(m.fecha)}</span>
                        <div class="flex items-center gap-2">
                            <span class="font-mono text-[10px] text-indigo-650 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md">Ticket: ${escapeHTML(m.ticket)}</span>
                            <button onclick="viewAndEditForm('${escapeHTML(m.subId)}')" class="text-[10px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-bold underline transition-colors">Ver Documento</button>
                        </div>
                    </div>
                    <h4 class="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">${title}</h4>
                    <div class="mt-1">${contentHtml}</div>
                    ${m.observacion ? `<p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Nota: "${escapeHTML(m.observacion)}"</p>` : ''}
                </div>
            `;
            timeline.appendChild(itemDiv);
        });
    }
    
    lucide.createIcons();
}

// Validaciones en Formulario
function setupInputValidationListeners() {
    const fields = [
        { id: 'func-nombre', minLength: 3 },
        { id: 'func-cargo', minLength: 2 },
        { id: 'func-depto', minLength: 3 }
    ];

    fields.forEach(field => {
        const el = document.getElementById(field.id);
        if (el) {
            el.addEventListener('blur', () => validateField(el, field.minLength));
            el.addEventListener('input', () => {
                if (el.value.trim().length >= field.minLength) {
                    validateField(el, field.minLength);
                }
            });
        }
    });
}

function validateField(el, minLength) {
    const val = el.value.trim();
    if (val.length < minLength) {
        el.classList.remove('border-slate-200', 'dark:border-slate-700', 'border-emerald-500', 'dark:border-emerald-500', 'focus:ring-emerald-500');
        el.classList.add('border-rose-500', 'dark:border-rose-500', 'focus:ring-rose-500');
        return false;
    } else {
        el.classList.remove('border-slate-200', 'dark:border-slate-700', 'border-rose-500', 'dark:border-rose-500', 'focus:ring-rose-500');
        el.classList.add('border-emerald-500', 'dark:border-emerald-500', 'focus:ring-emerald-500');
        return true;
    }
}

function clearValidationStyles() {
    const fields = ['func-nombre', 'func-cargo', 'func-depto'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('border-emerald-500', 'dark:border-emerald-500', 'border-rose-500', 'dark:border-rose-500', 'focus:ring-emerald-500', 'focus:ring-rose-500');
            el.classList.add('border-slate-200', 'dark:border-slate-700');
        }
    });
    
    ['tic', 'emisor', 'receptor'].forEach(id => {
        const canvas = document.getElementById(`canvas-${id}`);
        if (canvas) {
            const container = canvas.parentElement;
            container.classList.remove('animate-pulse-error', 'border-rose-500', 'dark:border-rose-500');
        }
    });
}

function highlightUnsignedCanvas(id) {
    const canvas = document.getElementById(`canvas-${id}`);
    if (canvas) {
        const container = canvas.parentElement;
        container.classList.remove('border-slate-200', 'dark:border-slate-700', 'hover:border-indigo-500');
        container.classList.add('border-rose-500', 'dark:border-rose-500', 'animate-pulse-error');
        
        const stopHighlight = () => {
            container.classList.remove('animate-pulse-error', 'border-rose-500', 'dark:border-rose-500');
            container.classList.add('border-slate-200', 'dark:border-slate-700', 'hover:border-indigo-500');
            canvas.removeEventListener('mousedown', stopHighlight);
            canvas.removeEventListener('touchstart', stopHighlight);
        };
        canvas.addEventListener('mousedown', stopHighlight);
        canvas.addEventListener('touchstart', stopHighlight);
        
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Ocultar dropdown de autocompletado si se hace clic fuera
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('history-suggestions-dropdown');
    const input = document.getElementById('history-search-input');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
});

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

window.exportSubmissionToPDF = exportSubmissionToPDF;
window.exportActiveSubmissionToPDF = exportActiveSubmissionToPDF;
window.openPreviewModal = openPreviewModal;
window.closePreviewModal = closePreviewModal;
window.triggerPDFExportFromPreview = triggerPDFExportFromPreview;
window.triggerPrintFromPreview = triggerPrintFromPreview;
window.showHistorySuggestions = showHistorySuggestions;
window.selectHistoryEquipment = selectHistoryEquipment;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
