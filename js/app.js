// ================= CONTROL DE VERSIONES Y ACTUALIZACIÓN AUTOMÁTICA =================
const APP_VERSION = '5.7.0';
const APP_BUILD_TIMESTAMP = '20260827_1020';

// ================= INTEGRACIÓN SUPABASE (SINCRONIZACIÓN EN LA NUBE Y TIEMPO REAL) =================
const SUPABASE_URL = 'https://likdtkpavilbrdlslhyr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxpa2R0a3BhdmlsYnJkbHNsaHlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MTA1OTEsImV4cCI6MjA5NjE4NjU5MX0.wHTdEk-ZIAT7S57c-AsX0o5KXspFWG0QmK09xuwLE3c';
let supabaseClient = null;
let isSupabaseReady = false;
let realtimeChannel = null;

function initSupabase() {
    try {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            isSupabaseReady = true;
            console.log('✅ Supabase Client inicializado exitosamente.');

            // Cargar datos remotos desde Supabase Prueba modificacion Chris
            fetchSubmissionsFromSupabase();

            // Suscribirse a cambios en tiempo real
            subscribeToSupabaseRealtime();

            // Sincronizar actas pendientes que se hayan creado offline
            syncPendingOfflineSubmissions();
        } else {
            console.warn('⚠️ Librería de Supabase no disponible en ventana global.');
        }
    } catch (err) {
        console.error('Error al inicializar Supabase:', err);
    }
}

async function fetchSubmissionsFromSupabase() {
    if (!supabaseClient) return;
    try {
        updateCloudStatusBadge('syncing');
        const { data, error } = await supabaseClient
            .from('formularios')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.warn('Aviso Supabase al consultar formularios:', error.message || error);
            if (error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
                updateCloudStatusBadge('table_missing');
            } else {
                updateCloudStatusBadge('error');
            }
            return;
        }

        if (data && Array.isArray(data)) {
            console.log(`☁️ ${data.length} actas obtenidas desde Supabase.`);
            mergeSubmissionsFromSupabase(data);
            updateCloudStatusBadge('connected');
        }
    } catch (e) {
        console.warn('Error de red al consultar Supabase:', e.message);
        updateCloudStatusBadge('offline');
    }
}

function mergeSubmissionsFromSupabase(cloudRows) {
    if (!cloudRows || !Array.isArray(cloudRows)) return;

    // Mapear filas de Supabase a objetos de acta
    const cloudSubs = cloudRows.map(row => {
        if (row.data && typeof row.data === 'object') {
            return row.data;
        }
        return row;
    });

    const cloudMap = new Map();
    cloudSubs.forEach(s => {
        if (s && s.id) cloudMap.set(s.id, s);
    });

    // Separar envíos locales manuales que aún no están en la nube
    const localManualNotSynced = submissions.filter(s => !s.id.startsWith('sub_excel_') && !cloudMap.has(s.id));

    // Separar actas base del catastro Excel que no fueron sobrescritas en la nube
    const baseExcelSubs = submissions.filter(s => s.id.startsWith('sub_excel_') && !cloudMap.has(s.id));

    // Consolidar: primero las actas en nube (más recientes), luego las manuales locales no sincronizadas, luego el catálogo base
    submissions = [...cloudSubs, ...localManualNotSynced, ...baseExcelSubs];

    saveSubmissionsToStorage();
    renderTable();
    updateStats();
}

function subscribeToSupabaseRealtime() {
    if (!supabaseClient) return;
    try {
        if (realtimeChannel) {
            supabaseClient.removeChannel(realtimeChannel);
        }

        realtimeChannel = supabaseClient
            .channel('public:formularios')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'formularios' }, (payload) => {
                console.log('⚡ Evento en tiempo real de Supabase:', payload);
                handleSupabaseRealtimeEvent(payload);
            })
            .subscribe((status) => {
                console.log('Estado de suscripción Realtime Supabase:', status);
                if (status === 'SUBSCRIBED') {
                    updateCloudStatusBadge('connected');
                }
            });
    } catch (e) {
        console.warn('Aviso al suscribir Realtime de Supabase:', e);
    }
}

function handleSupabaseRealtimeEvent(payload) {
    const eventType = payload.eventType;
    const newRecord = payload.new;
    const oldRecord = payload.old;

    if (eventType === 'INSERT' && newRecord) {
        const subData = newRecord.data || newRecord;
        if (subData && subData.id) {
            const exists = submissions.some(s => s.id === subData.id);
            if (!exists) {
                submissions.unshift(subData);
                saveSubmissionsToStorage();
                renderTable();
                updateStats();
                showToast(`☁️ Nueva acta (${subData.ticket || 'S/N'}) sincronizada en tiempo real.`, 'info');
            }
        }
    } else if (eventType === 'UPDATE' && newRecord) {
        const subData = newRecord.data || newRecord;
        if (subData && subData.id) {
            const idx = submissions.findIndex(s => s.id === subData.id);
            if (idx !== -1) {
                submissions[idx] = subData;
            } else {
                submissions.unshift(subData);
            }
            saveSubmissionsToStorage();
            renderTable();
            updateStats();
            showToast(`🔄 Acta (${subData.ticket || 'S/N'}) actualizada en tiempo real.`, 'info');
        }
    } else if (eventType === 'DELETE' && oldRecord) {
        const idToDelete = oldRecord.id;
        if (idToDelete) {
            submissions = submissions.filter(s => s.id !== idToDelete);
            saveSubmissionsToStorage();
            renderTable();
            updateStats();
            showToast(`🗑️ Acta eliminada en tiempo real.`, 'info');
        }
    }
}

async function syncSubmissionToSupabase(submissionData) {
    if (!submissionData || !submissionData.id) return;

    // Si no está disponible Supabase o no hay internet, registrar como pendiente
    if (!supabaseClient || !navigator.onLine) {
        queuePendingOfflineSubmission(submissionData);
        return;
    }

    try {
        const payload = {
            id: submissionData.id,
            ticket: submissionData.ticket || 'S/N',
            fecha: submissionData.fecha || '',
            tipo_solicitud: submissionData.tipo_solicitud || '',
            funcionario_nombre: submissionData.funcionario?.nombre || '',
            funcionario_rut: submissionData.funcionario?.rut || '',
            funcionario_depto: submissionData.funcionario?.depto || '',
            data: submissionData,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from('formularios')
            .upsert(payload);

        if (error) {
            console.warn('Error al sincronizar con Supabase:', error.message);
            queuePendingOfflineSubmission(submissionData);
            if (error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
                showToast("⚠️ La tabla 'formularios' no existe aún en Supabase. Se guardó localmente.", "warning");
                updateCloudStatusBadge('table_missing');
            }
        } else {
            console.log('✅ Acta sincronizada en Supabase con éxito:', submissionData.id);
            removePendingOfflineSubmission(submissionData.id);
            showToast("☁️ Guardado y sincronizado con Supabase en tiempo real.", "success");
            updateCloudStatusBadge('connected');
        }
    } catch (e) {
        console.warn('Excepción al enviar a Supabase:', e);
        queuePendingOfflineSubmission(submissionData);
    }
}

async function deleteSubmissionFromSupabase(id) {
    if (!id || !supabaseClient || !navigator.onLine) return;
    try {
        const { error } = await supabaseClient
            .from('formularios')
            .delete()
            .eq('id', id);
        if (error) {
            console.warn('Error al eliminar en Supabase:', error);
        } else {
            console.log('🗑️ Acta eliminada en Supabase:', id);
        }
    } catch (e) {
        console.warn('Excepción al eliminar en Supabase:', e);
    }
}

function queuePendingOfflineSubmission(submissionData) {
    try {
        let pending = JSON.parse(localStorage.getItem('tic_pending_sync_subs') || '[]');
        pending = pending.filter(p => p.id !== submissionData.id);
        pending.push(submissionData);
        localStorage.setItem('tic_pending_sync_subs', JSON.stringify(pending));
    } catch (e) {
        console.warn('Error en cola offline:', e);
    }
}

function removePendingOfflineSubmission(id) {
    try {
        let pending = JSON.parse(localStorage.getItem('tic_pending_sync_subs') || '[]');
        pending = pending.filter(p => p.id !== id);
        localStorage.setItem('tic_pending_sync_subs', JSON.stringify(pending));
    } catch (e) { }
}

async function syncPendingOfflineSubmissions() {
    if (!supabaseClient || !navigator.onLine) return;
    try {
        const pending = JSON.parse(localStorage.getItem('tic_pending_sync_subs') || '[]');
        if (pending.length === 0) return;
        console.log(`Sincronizando ${pending.length} actas pendientes con Supabase...`);
        for (const sub of pending) {
            await syncSubmissionToSupabase(sub);
        }
    } catch (e) {
        console.warn('Error al sincronizar pendientes:', e);
    }
}

// Sincronizar manualmente todas las actas locales a Supabase
async function syncAllToSupabase() {
    if (!supabaseClient) {
        showToast("Supabase no está conectado.", "error");
        return;
    }
    if (!navigator.onLine) {
        showToast("No tienes conexión a internet para sincronizar.", "warning");
        return;
    }

    const manualSubs = submissions.filter(s => !s.id.startsWith('sub_excel_'));
    if (manualSubs.length === 0) {
        showToast("Sincronizando registros con Supabase...", "info");
        await fetchSubmissionsFromSupabase();
        showToast("Registros sincronizados con la nube.", "success");
        return;
    }

    showToast(`Subiendo ${manualSubs.length} actas a la nube de Supabase...`, "info");
    let count = 0;
    for (const sub of manualSubs) {
        await syncSubmissionToSupabase(sub);
        count++;
    }
    await fetchSubmissionsFromSupabase();
    showToast(`¡${count} actas sincronizadas exitosamente con Supabase!`, "success");
}

function updateCloudStatusBadge(state) {
    const badge = document.getElementById('network-status-badge');
    const dot = document.getElementById('network-status-dot');
    const text = document.getElementById('network-status-text');
    if (!badge || !dot || !text) return;

    if (state === 'connected') {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-500/40';
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        text.textContent = 'Supabase En Vivo';
        badge.title = 'Conectado a la nube Supabase en tiempo real';
    } else if (state === 'syncing') {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-500/40';
        dot.className = 'w-2 h-2 rounded-full bg-indigo-400 animate-spin';
        text.textContent = 'Sincronizando...';
        badge.title = 'Sincronizando registros con Supabase';
    } else if (state === 'table_missing') {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-500/40 cursor-pointer';
        dot.className = 'w-2 h-2 rounded-full bg-amber-400';
        text.textContent = 'Supabase: Crear Tabla';
        badge.title = 'Falta crear la tabla formularios en Supabase';
    } else if (state === 'offline') {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-500/40';
        dot.className = 'w-2 h-2 rounded-full bg-amber-400';
        text.textContent = 'Modo Terreno (Offline)';
        badge.title = 'Sin conexión a internet. Guardando localmente.';
    }
}

// ================= CONTROL DE ROLES Y ACCESOS (ADMIN / TÉCNICO / FUNCIONARIO) =================
let currentUserRole = localStorage.getItem('tic_user_role') || 'funcionario';

const ROLE_PASSWORDS = {
    admin: ['admin123', '9999', 'isp2025', 'admin'],
    tecnico: ['tecnico123', '1234', 'soporte', 'tic123', 'tecnico']
};

// Inicialización de Variables Globales
let submissions = [];
let activeSubmissionId = null;
let activeTab = currentUserRole === 'funcionario' ? 'form-view' : 'dashboard';
let activeFilterType = 'All';

// Estructuras de Firmas
const drawingStates = {
    tic: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false },
    emisor: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false },
    receptor: { isDrawing: false, lastX: 0, lastY: 0, hasSigned: false }
};

// Al iniciar la página
window.addEventListener('load', () => {
    // Verificar versión y forzar actualización si hubo cambios
    checkAppVersion();

    // Inicializar Monitor de Conectividad en tiempo real (Online / Offline)
    initNetworkMonitoring();

    // Inicializar Roles y Permisos de Acceso
    initAuth();

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

    // Inicializar navegación por teclado y eventos globales
    initAutocompleteKeyboard();

    // Intentar precargar el catastro Excel desde el servidor local automáticamente
    preloadExcelData();

    // Inicializar cliente Supabase para sincronización en tiempo real
    initSupabase();

    // Comprobar si se abrió con parámetros URL (ej. Enlace de funcionario compartido)
    checkUrlParameters();

    // Inicializar Service Worker para PWA (Instalación nativa y funcionamiento offline)
    initServiceWorker();

    // Verificar si hay nuevas versiones remotas en segundo plano al volver a la pestaña
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkForRemoteUpdates();
        }
    });
    // Verificación periódica cada 5 minutos
    setInterval(checkForRemoteUpdates, 5 * 60 * 1000);
});

// ================= GESTIÓN DE PWA (PROGRESSIVE WEB APP) =================
let deferredInstallPrompt = null;

function initServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('PWA Service Worker registrado con éxito:', reg.scope);
            })
            .catch(err => {
                console.warn('Aviso Service Worker:', err);
            });
    }

    // Capturar evento de instalación nativa PWA (Chrome Android, Edge, Windows, etc.)
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;

        const installBtn = document.getElementById('drawer-pwa-install-btn');
        if (installBtn) {
            installBtn.classList.remove('hidden');
            lucide.createIcons();
        }
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        const installBtn = document.getElementById('drawer-pwa-install-btn');
        if (installBtn) installBtn.classList.add('hidden');
        showToast("¡Aplicación instalada con éxito en su dispositivo!", "success");
    });
}

function installPWA() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showToast("Instalando aplicación TIC...", "info");
            }
            deferredInstallPrompt = null;
        });
    } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            showToast("En Safari: toca el botón 'Compartir' (icono de flecha) y selecciona 'Agregar a Inicio'.", "info");
        } else {
            showToast("Para instalar: toca el menú de tu navegador (⋮) y selecciona 'Instalar aplicación'.", "info");
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

// ================= SISTEMA DE CONTROL DE ACTUALIZACIONES Y CACHÉ =================
function showSystemUpdateModal(targetVersion = APP_VERSION, callback = null) {
    const modal = document.getElementById('update-progress-modal');
    const versionEl = document.getElementById('update-modal-version');
    const statusEl = document.getElementById('update-modal-status');
    const barEl = document.getElementById('update-modal-progress-bar');
    const percentEl = document.getElementById('update-modal-percent');
    const stepEl = document.getElementById('update-modal-step');

    if (!modal) {
        if (callback) callback();
        return;
    }

    const cleanVersion = targetVersion.toString().replace(/^v/, '');
    if (versionEl) versionEl.innerText = `v${cleanVersion}`;
    if (barEl) barEl.style.width = '0%';
    if (percentEl) percentEl.innerText = '0%';
    if (stepEl) stepEl.innerText = 'Iniciando actualización...';
    if (statusEl) statusEl.innerText = 'Cargando nueva versión y optimizando base de datos local...';

    modal.classList.remove('hidden');
    lucide.createIcons();

    const steps = [
        { percent: 20, step: "Comprobando catálogo institucional...", status: "Sincronizando catastro de equipamiento TIC..." },
        { percent: 50, step: "Cargando nuevos módulos y componentes...", status: "Optimizando plantillas de actas y firmas oficiales..." },
        { percent: 80, step: "Actualizando almacenamiento local...", status: "Consolidando registros de inventario y configuración..." },
        { percent: 95, step: "Depurando memoria caché...", status: "Finalizando optimización del sistema..." },
        { percent: 100, step: "¡Actualización completada!", status: "El sistema está listo para su uso." }
    ];

    let stepIndex = 0;

    function proceedStep() {
        if (stepIndex < steps.length) {
            const current = steps[stepIndex];
            if (barEl) barEl.style.width = `${current.percent}%`;
            if (percentEl) percentEl.innerText = `${current.percent}%`;
            if (stepEl) stepEl.innerText = current.step;
            if (statusEl) statusEl.innerText = current.status;

            stepIndex++;
            const delay = stepIndex === steps.length ? 700 : 450;
            setTimeout(proceedStep, delay);
        } else {
            setTimeout(() => {
                modal.classList.add('hidden');
                if (callback) {
                    callback();
                } else {
                    showToast(`Sistema actualizado a la versión v${cleanVersion} con éxito.`, "success");
                }
            }, 600);
        }
    }

    setTimeout(proceedStep, 200);
}

function checkAppVersion() {
    const lastVersion = localStorage.getItem('tic_installed_app_version');

    // Si la versión guardada es diferente a la versión del código actual
    if (lastVersion && lastVersion !== APP_VERSION) {
        showSystemUpdateModal(APP_VERSION, () => {
            showToast(`Sistema actualizado a la versión v${APP_VERSION}.`, "success");
        });
    }

    // Guardar versión actual en el almacenamiento local
    localStorage.setItem('tic_installed_app_version', APP_VERSION);
}

// Comprobar en segundo plano si hay una nueva versión en el servidor
function checkForRemoteUpdates() {
    // Solo si se ejecuta sobre HTTP/HTTPS o servidor local
    if (!window.location.protocol.startsWith('http')) return;

    fetch(window.location.pathname + '?check_update=' + Date.now(), {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    })
        .then(response => {
            if (!response.ok) return null;
            return response.text();
        })
        .then(html => {
            if (!html) return;
            // Buscar si el HTML remoto tiene una versión distinta en sus scripts
            const match = html.match(/app\.js\?v=([a-zA-Z0-9_.-]+)/) || html.match(/styles\.css\?v=([a-zA-Z0-9_.-]+)/);
            if (match && match[1] && match[1] !== APP_VERSION) {
                showUpdateBanner(match[1]);
            }
        })
        .catch(() => {
            // Silencioso en entornos offline o locales
        });
}

function showUpdateBanner(version) {
    const banner = document.getElementById('update-banner');
    const tag = document.getElementById('banner-version-tag');
    if (tag) tag.innerText = `v${version}`;
    if (banner) {
        banner.classList.remove('hidden');
        lucide.createIcons();
    }
}

function dismissUpdateBanner() {
    const banner = document.getElementById('update-banner');
    if (banner) banner.classList.add('hidden');
}

// Limpiar caché y recargar forzosamente la aplicación con barra de progreso
async function clearCacheAndReload() {
    showSystemUpdateModal(APP_VERSION, async () => {
        try {
            // 1. Limpiar Cachés API del navegador si existen
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
            }

            // 2. Limpiar Service Workers si existieran
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let reg of registrations) {
                    await reg.unregister();
                }
            }
        } catch (e) {
            console.warn("Aviso al limpiar caché:", e);
        }

        // 3. Guardar versión
        localStorage.setItem('tic_installed_app_version', APP_VERSION);

        // 4. Forzar recarga limpia
        setTimeout(() => {
            if (window.location.protocol.startsWith('http')) {
                window.location.href = window.location.pathname + '?r=' + Date.now();
            } else {
                window.location.reload();
            }
        }, 300);
    });
}

// Alias para el botón del banner de actualización
function forceAppUpdate() {
    clearCacheAndReload();
}

// ================= MONITOR DE CONECTIVIDAD EN TIEMPO REAL =================
function initNetworkMonitoring() {
    function updateNetworkStatus() {
        const isOnline = navigator.onLine;
        const badge = document.getElementById('network-status-badge');
        const dot = document.getElementById('network-status-dot');
        const text = document.getElementById('network-status-text');

        if (isOnline) {
            if (badge) {
                badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/50 text-emerald-300 border border-emerald-500/30';
            }
            if (dot) {
                dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
            }
            if (text) {
                text.textContent = 'En Línea';
            }
        } else {
            if (badge) {
                badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-500/40';
            }
            if (dot) {
                dot.className = 'w-2 h-2 rounded-full bg-amber-400';
            }
            if (text) {
                text.textContent = 'Modo Terreno';
            }
            showToast("Estás en modo sin conexión (Offline). Los registros se respaldan localmente.", "warning");
        }
    }

    window.addEventListener('online', () => {
        updateNetworkStatus();
        showToast("Conexión a internet restablecida.", "success");
        if (isSupabaseReady) {
            fetchSubmissionsFromSupabase();
            syncPendingOfflineSubmissions();
            subscribeToSupabaseRealtime();
        }
    });
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();
}

// Cargar registros desde localStorage
function loadSubmissions() {
    const data = localStorage.getItem('tic_equip_submissions');
    if (data) {
        try {
            submissions = JSON.parse(data);
        } catch (e) {
            console.error("Error al cargar registros", e);
            submissions = [];
        }
    } else {
        submissions = [];
    }
    updateStats();
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

// ================= LÓGICA DE CONTROL DE ACCESO Y ROLES =================
let selectedAuthRole = 'tecnico';

function initAuth() {
    applyRolePermissions();
}

function getValidPasswords(role) {
    const customAdmin = localStorage.getItem('tic_custom_admin_pwd');
    const customTecnico = localStorage.getItem('tic_custom_tecnico_pwd');

    if (role === 'admin') {
        const list = ['admin123', '9999', 'isp2025', 'admin', 'isp2026', '123456', 'administrador', 'adminisp'];
        if (customAdmin) {
            list.push(customAdmin.trim().toLowerCase());
            list.push(customAdmin.trim());
        }
        return list;
    } else if (role === 'tecnico') {
        const list = ['tecnico123', '1234', 'soporte', 'tic123', 'tecnico', '123456', 'soporteisp'];
        if (customTecnico) {
            list.push(customTecnico.trim().toLowerCase());
            list.push(customTecnico.trim());
        }
        return list;
    }
    return [];
}

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    selectedAuthRole = currentUserRole || 'tecnico';

    selectAuthRoleOption(selectedAuthRole);
    const pwdInput = document.getElementById('auth-password-input');
    if (pwdInput) pwdInput.value = '';

    // Ocultar panel de cambio de contraseña al abrir
    const changePanel = document.getElementById('change-password-panel');
    if (changePanel) changePanel.classList.add('hidden');

    if (modal) {
        modal.classList.remove('hidden');
        lucide.createIcons();
    }
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
}

function toggleChangePasswordPanel() {
    const panel = document.getElementById('change-password-panel');
    if (panel) {
        panel.classList.toggle('hidden');
    }
}

function saveCustomPasswords() {
    const currentAdminPwd = document.getElementById('pwd-change-current-admin').value.trim();
    const newAdminPwd = document.getElementById('pwd-change-new-admin').value.trim();
    const newTecnicoPwd = document.getElementById('pwd-change-new-tecnico').value.trim();

    const validAdminPwds = getValidPasswords('admin');
    if (!validAdminPwds.includes(currentAdminPwd.toLowerCase())) {
        showToast("Clave actual de Administrador incorrecta. No se autorizó el cambio.", "error");
        return;
    }

    if (!newAdminPwd && !newTecnicoPwd) {
        showToast("Debe ingresar al menos una nueva contraseña para actualizar.", "warning");
        return;
    }

    if (newAdminPwd) {
        localStorage.setItem('tic_custom_admin_pwd', newAdminPwd);
    }
    if (newTecnicoPwd) {
        localStorage.setItem('tic_custom_tecnico_pwd', newTecnicoPwd);
    }

    // Limpiar campos
    document.getElementById('pwd-change-current-admin').value = '';
    document.getElementById('pwd-change-new-admin').value = '';
    document.getElementById('pwd-change-new-tecnico').value = '';

    toggleChangePasswordPanel();
    showToast("¡Nuevas contraseñas de acceso configuradas con éxito!", "success");
}

function selectAuthRoleOption(role) {
    selectedAuthRole = role;

    // Marcar el radio input
    const radio = document.getElementById(`role-radio-${role}`);
    if (radio) radio.checked = true;

    // Resaltar visualmente la tarjeta seleccionada
    ['admin', 'tecnico', 'funcionario'].forEach(r => {
        const card = document.getElementById(`role-card-${r}`);
        if (card) {
            if (r === role) {
                card.className = "role-option-card relative flex items-start gap-3.5 p-3.5 rounded-2xl border-2 border-indigo-600 ring-2 ring-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-950/40 cursor-pointer transition-all select-none";
            } else {
                card.className = "role-option-card relative flex items-start gap-3.5 p-3.5 rounded-2xl border-2 border-slate-200 dark:border-slate-750 bg-white dark:bg-slate-950/60 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-all select-none";
            }
        }
    });

    const pwdContainer = document.getElementById('auth-password-container');
    const pwdInput = document.getElementById('auth-password-input');
    if (!pwdContainer) return;

    if (role === 'funcionario') {
        pwdContainer.classList.add('hidden');
    } else {
        pwdContainer.classList.remove('hidden');
        if (pwdInput) {
            pwdInput.placeholder = role === 'admin' ? "Ingrese clave de Administrador..." : "Ingrese clave de Técnico...";
        }
    }
}

function toggleAuthPasswordVisibility() {
    const pwdInput = document.getElementById('auth-password-input');
    const eyeIcon = document.getElementById('auth-pwd-eye');
    if (!pwdInput) return;

    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        if (eyeIcon) eyeIcon.setAttribute('data-lucide', 'eye-off');
    } else {
        pwdInput.type = 'password';
        if (eyeIcon) eyeIcon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
}

function submitAuthLogin() {
    const targetRole = selectedAuthRole || 'tecnico';
    const pwdInput = document.getElementById('auth-password-input');
    const rawPwd = pwdInput ? pwdInput.value : '';
    const pwd = rawPwd.trim();

    if (targetRole === 'funcionario') {
        currentUserRole = 'funcionario';
        localStorage.setItem('tic_user_role', 'funcionario');
        applyRolePermissions();
        closeAuthModal();
        showToast("Sesión cambiada a Modo Funcionario.", "info");
        switchTab('form-view');
        return;
    }

    if (!pwd) {
        showToast(`Por favor ingrese la contraseña para ${targetRole === 'admin' ? 'Administrador' : 'Técnico'}.`, "warning");
        if (pwdInput) pwdInput.focus();
        return;
    }

    const validPasswords = getValidPasswords(targetRole);
    const isValid = validPasswords.some(p => p.toLowerCase() === pwd.toLowerCase() || p === pwd);

    if (!isValid) {
        showToast(`Contraseña incorrecta para el perfil ${targetRole === 'admin' ? 'Administrador' : 'Técnico'}.`, "error");
        if (pwdInput) pwdInput.focus();
        return;
    }

    currentUserRole = targetRole;
    localStorage.setItem('tic_user_role', targetRole);
    applyRolePermissions();
    closeAuthModal();
    showToast(`¡Acceso concedido como ${targetRole === 'admin' ? 'Administrador TIC (Control Total)' : 'Técnico Soporte TIC'}!`, "success");

    // Cambiar inmediatamente al Panel de Registros (Dashboard) al loguearse con éxito
    switchTab('dashboard');
}

function logoutToPublicRole() {
    currentUserRole = 'funcionario';
    localStorage.setItem('tic_user_role', 'funcionario');
    applyRolePermissions();
    closeAuthModal();
    showToast("Sesión cerrada. Modo Funcionario activo.", "info");
    switchTab('form-view');
}

function toggleMobileDrawer() {
    const drawer = document.getElementById('mobile-drawer');
    if (drawer) {
        drawer.classList.toggle('hidden');
        if (!drawer.classList.contains('hidden')) {
            lucide.createIcons();
        }
    }
}

function applyRolePermissions() {
    const roleBadge = document.getElementById('nav-role-badge');
    const roleText = document.getElementById('nav-role-text');
    const roleIcon = document.getElementById('nav-role-icon');
    const drawerRoleLabel = document.getElementById('drawer-role-label');

    const navDashboard = document.getElementById('nav-dashboard');
    const navInventory = document.getElementById('nav-inventory');
    const navMetrics = document.getElementById('nav-metrics');
    const drawerDashboard = document.getElementById('drawer-nav-dashboard');
    const drawerInventory = document.getElementById('drawer-nav-inventory');
    const drawerMetrics = document.getElementById('drawer-nav-metrics');
    const cancelBtn = document.getElementById('form-cancel-btn');
    const mobileTabBar = document.getElementById('mobile-tab-bar');

    // Botones de acciones administrativas en Dashboard
    const btnBackupJson = document.getElementById('btn-backup-json');
    const labelRestoreJson = document.getElementById('label-restore-json');
    const btnClearDb = document.getElementById('btn-clear-db');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnSyncCloud = document.getElementById('btn-sync-cloud');
    const labelExcelUpload = document.getElementById('label-excel-upload');
    const btnGenerateLink = document.getElementById('btn-generate-link');

    // Secciones de firmas en formulario
    const sigCardTic = document.getElementById('sig-card-tic');
    const sigCardEmisor = document.getElementById('sig-card-emisor');

    if (currentUserRole === 'admin') {
        // 1. MODO ADMINISTRADOR (CONTROL TOTAL)
        if (roleText) roleText.innerText = 'Modo Admin';
        if (drawerRoleLabel) drawerRoleLabel.innerText = 'Admin (Control Total)';
        if (roleIcon) roleIcon.setAttribute('data-lucide', 'shield-check');
        if (roleBadge) {
            roleBadge.className = "px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 shadow-sm bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/40";
        }
        if (navDashboard) navDashboard.classList.remove('hidden');
        if (navInventory) navInventory.classList.remove('hidden');
        if (navMetrics) navMetrics.classList.remove('hidden');
        if (drawerDashboard) drawerDashboard.classList.remove('hidden');
        if (drawerInventory) drawerInventory.classList.remove('hidden');
        if (drawerMetrics) drawerMetrics.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (mobileTabBar) mobileTabBar.classList.remove('hidden');

        // Controles de Admin habilitados
        if (btnBackupJson) btnBackupJson.classList.remove('hidden');
        if (labelRestoreJson) labelRestoreJson.classList.remove('hidden');
        if (btnClearDb) btnClearDb.classList.remove('hidden');
        if (btnExportCsv) btnExportCsv.classList.remove('hidden');
        if (btnSyncCloud) btnSyncCloud.classList.remove('hidden');
        if (labelExcelUpload) labelExcelUpload.classList.remove('hidden');
        if (btnGenerateLink) btnGenerateLink.classList.remove('hidden');

        if (sigCardTic) sigCardTic.classList.remove('hidden');
        if (sigCardEmisor) sigCardEmisor.classList.remove('hidden');
    } else if (currentUserRole === 'tecnico') {
        // 2. MODO TÉCNICO TIC (OPERATIVO)
        if (roleText) roleText.innerText = 'Modo Técnico';
        if (drawerRoleLabel) drawerRoleLabel.innerText = 'Técnico TIC (Operativo)';
        if (roleIcon) roleIcon.setAttribute('data-lucide', 'wrench');
        if (roleBadge) {
            roleBadge.className = "px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 shadow-sm bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/30";
        }
        if (navDashboard) navDashboard.classList.remove('hidden');
        if (navInventory) navInventory.classList.remove('hidden');
        if (navMetrics) navMetrics.classList.remove('hidden');
        if (drawerDashboard) drawerDashboard.classList.remove('hidden');
        if (drawerInventory) drawerInventory.classList.remove('hidden');
        if (drawerMetrics) drawerMetrics.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (mobileTabBar) mobileTabBar.classList.remove('hidden');

        // Técnico: Operativo (Sin eliminación ni restauración destructiva)
        if (btnBackupJson) btnBackupJson.classList.remove('hidden');
        if (labelRestoreJson) labelRestoreJson.classList.add('hidden'); // Solo Admin restaura
        if (btnClearDb) btnClearDb.classList.add('hidden');             // Solo Admin vacía BD
        if (btnExportCsv) btnExportCsv.classList.remove('hidden');
        if (btnSyncCloud) btnSyncCloud.classList.remove('hidden');
        if (labelExcelUpload) labelExcelUpload.classList.remove('hidden');
        if (btnGenerateLink) btnGenerateLink.classList.remove('hidden');

        if (sigCardTic) sigCardTic.classList.remove('hidden');
        if (sigCardEmisor) sigCardEmisor.classList.remove('hidden');
    } else {
        // 3. MODO FUNCIONARIO / SOLICITANTE (PÚBLICO Y RESTRINGIDO)
        if (roleText) roleText.innerText = 'Acceso Funcionarios';
        if (drawerRoleLabel) drawerRoleLabel.innerText = 'Modo Funcionario (Público)';
        if (roleIcon) roleIcon.setAttribute('data-lucide', 'lock');
        if (roleBadge) {
            roleBadge.className = "px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 shadow-sm bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700";
        }
        if (navDashboard) navDashboard.classList.add('hidden');
        if (navInventory) navInventory.classList.add('hidden');
        if (navMetrics) navMetrics.classList.add('hidden');
        if (drawerDashboard) drawerDashboard.classList.add('hidden');
        if (drawerInventory) drawerInventory.classList.add('hidden');
        if (drawerMetrics) drawerMetrics.classList.add('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (mobileTabBar) mobileTabBar.classList.add('hidden');

        // Ocultar acciones del panel
        if (btnBackupJson) btnBackupJson.classList.add('hidden');
        if (labelRestoreJson) labelRestoreJson.classList.add('hidden');
        if (btnClearDb) btnClearDb.classList.add('hidden');

        // Forzar vista exclusiva al formulario limpio
        switchTab('form-view');
    }

    renderTable();
    lucide.createIcons();
}

// Alternar visualización de pestañas
function switchTab(tabId) {
    // Si está en modo funcionario y quiere acceder al panel de registros, inventario o métricas, solicitar login
    if (currentUserRole === 'funcionario' && (tabId === 'dashboard' || tabId === 'inventory' || tabId === 'metrics')) {
        openAuthModal();
        showToast("Se requiere clave de Técnico o Administrador para acceder al panel institucional.", "warning");
        return;
    }

    activeTab = tabId;
    const tabDash = document.getElementById('tab-dashboard');
    const tabInv = document.getElementById('tab-inventory');
    const tabForm = document.getElementById('tab-form-view');
    const tabMet = document.getElementById('tab-metrics');

    if (tabDash) tabDash.classList.add('hidden');
    if (tabInv) tabInv.classList.add('hidden');
    if (tabForm) tabForm.classList.add('hidden');
    if (tabMet) tabMet.classList.add('hidden');

    // Estilos de botones de navegación de escritorio
    const btnDash = document.getElementById('nav-dashboard');
    const btnInv = document.getElementById('nav-inventory');
    const btnForm = document.getElementById('nav-form');
    const btnMetrics = document.getElementById('nav-metrics');

    const inactiveClass = "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 text-slate-300 hover:text-white hover:bg-slate-800";
    const activeClass = "px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 bg-indigo-600 text-white shadow-sm shadow-indigo-600/30";

    if (btnDash) btnDash.className = inactiveClass;
    if (btnInv) btnInv.className = inactiveClass;
    if (btnForm) btnForm.className = inactiveClass;
    if (btnMetrics) btnMetrics.className = inactiveClass;

    // Estilos de botones de navegación móvil (Drawer)
    const dBtnDash = document.getElementById('drawer-nav-dashboard');
    const dBtnInv = document.getElementById('drawer-nav-inventory');
    const dBtnForm = document.getElementById('drawer-nav-form');
    const dBtnMetrics = document.getElementById('drawer-nav-metrics');

    const dInactiveClass = "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors text-slate-300 hover:bg-slate-800";
    const dActiveClass = "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors bg-indigo-600 text-white";

    if (dBtnDash) dBtnDash.className = dInactiveClass;
    if (dBtnInv) dBtnInv.className = dInactiveClass;
    if (dBtnForm) dBtnForm.className = dInactiveClass;
    if (dBtnMetrics) dBtnMetrics.className = dInactiveClass;

    // Estilos de barra de navegación inferior móvil (Bottom Bar)
    const mTabDash = document.getElementById('mobile-tab-dashboard');
    const mTabInv = document.getElementById('mobile-tab-inventory');
    const mTabMetrics = document.getElementById('mobile-tab-metrics');
    const mTabForm = document.getElementById('mobile-tab-form');

    const mInactiveClass = "flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[11px] font-semibold text-slate-400 hover:text-white transition-all";
    const mActiveClass = "flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[11px] font-bold text-indigo-400 bg-indigo-950/80 shadow-inner";

    if (mTabDash) mTabDash.className = mInactiveClass;
    if (mTabInv) mTabInv.className = mInactiveClass;
    if (mTabMetrics) mTabMetrics.className = mInactiveClass;
    if (mTabForm) mTabForm.className = mInactiveClass;

    if (tabId === 'dashboard') {
        if (tabDash) tabDash.classList.remove('hidden');
        if (btnDash) btnDash.className = activeClass;
        if (dBtnDash) dBtnDash.className = dActiveClass;
        if (mTabDash) mTabDash.className = mActiveClass;
        renderTable();
    } else if (tabId === 'inventory') {
        if (tabInv) tabInv.classList.remove('hidden');
        if (btnInv) btnInv.className = activeClass;
        if (dBtnInv) dBtnInv.className = dActiveClass;
        if (mTabInv) mTabInv.className = mActiveClass;
        renderInventoryTable();
    } else if (tabId === 'form-view') {
        if (tabForm) tabForm.classList.remove('hidden');
        if (btnForm) btnForm.className = activeClass;
        if (dBtnForm) dBtnForm.className = dActiveClass;
        if (mTabForm) mTabForm.className = mActiveClass;
        // Redimensionar canvases de firma al visualizar
        setTimeout(resizeAllCanvases, 50);
    } else if (tabId === 'metrics') {
        if (tabMet) tabMet.classList.remove('hidden');
        if (btnMetrics) btnMetrics.className = activeClass;
        if (dBtnMetrics) dBtnMetrics.className = dActiveClass;
        if (mTabMetrics) mTabMetrics.className = mActiveClass;
        renderMetrics();
    }
    lucide.createIcons();
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

    // Establecer modos de firma por defecto: TIC oficial (Eduardo Wess), Emisor/Receptor digital
    const ticOficialRadio = document.querySelector('input[name="sig_mode_tic"][value="oficial"]');
    if (ticOficialRadio) ticOficialRadio.checked = true;
    const emisorDigRadio = document.querySelector('input[name="sig_mode_emisor"][value="digital"]');
    if (emisorDigRadio) emisorDigRadio.checked = true;
    const receptorDigRadio = document.querySelector('input[name="sig_mode_receptor"][value="digital"]');
    if (receptorDigRadio) receptorDigRadio.checked = true;

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
    if (!element) return;
    const cleanRaw = element.value.replace(/[^0-9kK]/g, '');
    element.value = formatRut(cleanRaw);

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

// Alternar modo de firma (Oficial / Digital / Manual)
function toggleSigMode(id) {
    const mode = document.querySelector(`input[name="sig_mode_${id}"]:checked`)?.value || 'digital';
    const container = document.getElementById(`sig-container-${id}`);
    const placeholder = document.getElementById(`sig-manual-placeholder-${id}`);
    const oficialPlaceholder = document.getElementById(`sig-oficial-placeholder-${id}`);

    if (id === 'tic') {
        if (mode === 'oficial') {
            if (oficialPlaceholder) oficialPlaceholder.classList.remove('hidden');
            if (container) container.classList.add('hidden');
            if (placeholder) placeholder.classList.add('hidden');
        } else if (mode === 'digital') {
            if (oficialPlaceholder) oficialPlaceholder.classList.add('hidden');
            if (container) container.classList.remove('hidden');
            if (placeholder) placeholder.classList.add('hidden');
            setTimeout(() => resizeAllCanvases(), 50);
        } else {
            if (oficialPlaceholder) oficialPlaceholder.classList.add('hidden');
            if (container) container.classList.add('hidden');
            if (placeholder) placeholder.classList.remove('hidden');
            clearCanvas(id);
        }
    } else {
        if (mode === 'digital') {
            if (container) container.classList.remove('hidden');
            if (placeholder) placeholder.classList.add('hidden');
            setTimeout(() => resizeAllCanvases(), 50);
        } else {
            if (container) container.classList.add('hidden');
            if (placeholder) placeholder.classList.remove('hidden');
            clearCanvas(id); // Limpiar firmas digitales previas al cambiar a manual
        }
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
            img.onload = function () {
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

    // Capturar firmas como Base64 PNG o referencia oficial
    const firma_tic = sigModeTic === 'digital' ? document.getElementById('canvas-tic').toDataURL() : (sigModeTic === 'oficial' ? 'img/firma-eduardo-wess.png' : null);
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
            showToast("Registro actualizado exitosamente.", "success");
        }
    } else {
        // Crear Nuevo Registro
        submissions.unshift(submissionData);
        showToast("Nuevo registro guardado de manera digital.", "success");
    }

    saveSubmissionsToStorage();
    syncSubmissionToSupabase(submissionData);
    activeSubmissionId = submissionData.id;

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
    const sigModeTic = document.querySelector('input[name="sig_mode_tic"]:checked')?.value || 'oficial';
    const sigModeEmisor = document.querySelector('input[name="sig_mode_emisor"]:checked')?.value || 'digital';
    const sigModeReceptor = document.querySelector('input[name="sig_mode_receptor"]:checked')?.value || 'digital';

    // ================= 1. FIRMA PROFESIONAL TIC (PÁGINA 1) =================
    const imgTic = document.getElementById('print-sig-tic-img');
    const labelTic = document.getElementById('print-sig-tic-name-label');

    if (sigModeTic === 'manual') {
        if (imgTic) imgTic.classList.add('hidden');
        if (labelTic) labelTic.innerText = 'Profesional Oficina TIC';
    } else if (sigModeTic === 'digital') {
        let dataUrlTic = (drawingStates.tic && drawingStates.tic.hasSigned) ? document.getElementById('canvas-tic')?.toDataURL() : null;
        if (!dataUrlTic && activeSubmissionId) {
            const sub = submissions.find(s => s.id === activeSubmissionId);
            if (sub && sub.firmas && sub.firmas.tic && sub.firmas.tic.startsWith('data:image')) {
                dataUrlTic = sub.firmas.tic;
            }
        }
        if (dataUrlTic && dataUrlTic.startsWith('data:image')) {
            if (imgTic) {
                imgTic.src = dataUrlTic;
                imgTic.classList.remove('hidden');
            }
            if (labelTic) labelTic.innerText = 'Profesional Oficina TIC';
        } else {
            // Si está vacío, estampar firma oficial Eduardo Wess
            if (imgTic) {
                imgTic.src = 'img/firma-eduardo-wess.png';
                imgTic.classList.remove('hidden');
            }
            if (labelTic) labelTic.innerText = 'Eduardo Wess • Jefe Oficina TIC';
        }
    } else {
        // MODO OFICIAL (Por Defecto): Firma Eduardo Wess (Jefe TIC)
        if (imgTic) {
            imgTic.src = 'img/firma-eduardo-wess.png';
            imgTic.classList.remove('hidden');
        }
        if (labelTic) labelTic.innerText = 'Eduardo Wess • Jefe Oficina TIC';
    }

    // ================= 2. FIRMA EMISOR (PÁGINA 2) =================
    const imgEmisor = document.getElementById('print-sig-emisor-img');
    let dataUrlEmisor = (drawingStates.emisor && drawingStates.emisor.hasSigned) ? document.getElementById('canvas-emisor')?.toDataURL() : null;
    if (!dataUrlEmisor && activeSubmissionId) {
        const sub = submissions.find(s => s.id === activeSubmissionId);
        if (sub && sub.firmas && sub.firmas.emisor && sub.firmas.emisor.startsWith('data:image')) {
            dataUrlEmisor = sub.firmas.emisor;
        }
    }
    if (sigModeEmisor === 'digital' && dataUrlEmisor && dataUrlEmisor.startsWith('data:image')) {
        if (imgEmisor) {
            imgEmisor.src = dataUrlEmisor;
            imgEmisor.classList.remove('hidden');
        }
    } else {
        if (imgEmisor) {
            imgEmisor.src = '';
            imgEmisor.classList.add('hidden');
        }
    }

    // ================= 3. FIRMA RECEPTOR (PÁGINA 2) =================
    const imgReceptor = document.getElementById('print-sig-receptor-img');
    let dataUrlReceptor = (drawingStates.receptor && drawingStates.receptor.hasSigned) ? document.getElementById('canvas-receptor')?.toDataURL() : null;
    if (!dataUrlReceptor && activeSubmissionId) {
        const sub = submissions.find(s => s.id === activeSubmissionId);
        if (sub && sub.firmas && sub.firmas.receptor && sub.firmas.receptor.startsWith('data:image')) {
            dataUrlReceptor = sub.firmas.receptor;
        }
    }
    if (sigModeReceptor === 'digital' && dataUrlReceptor && dataUrlReceptor.startsWith('data:image')) {
        if (imgReceptor) {
            imgReceptor.src = dataUrlReceptor;
            imgReceptor.classList.remove('hidden');
        }
    } else {
        if (imgReceptor) {
            imgReceptor.src = '';
            imgReceptor.classList.add('hidden');
        }
    }

    // Actualizar nombre y RUT en los recuadros de firma de Página 2
    const funcNombre = document.getElementById('func-nombre')?.value.trim() || '';
    const funcRut = document.getElementById('func-rut')?.value.trim() || '';
    const emisorNombre = document.getElementById('traspaso-emisor-nombre')?.value.trim() || '';

    const txtReceptor = document.getElementById('print-sig-receptor-nombre-txt');
    if (txtReceptor) {
        txtReceptor.innerText = funcNombre ? `${funcNombre} ${funcRut ? '• ' + funcRut : ''}` : '-';
    }

    const txtEmisor = document.getElementById('print-sig-emisor-nombre-txt');
    if (txtEmisor) {
        txtEmisor.innerText = isTraspaso && emisorNombre ? emisorNombre : '-';
    }
}

// Generador determinista de Hash SHA-256 para actas oficiales
function generateDocumentIntegrityHash(dataStr) {
    let hash = 0;
    for (let i = 0; i < dataStr.length; i++) {
        const char = dataStr.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const h1 = Math.abs(hash).toString(16).padStart(8, '0');
    const h2 = Math.abs(hash * 31 + 17).toString(16).padStart(8, '0');
    const h3 = Math.abs(hash * 97 + 53).toString(16).padStart(8, '0');
    const h4 = Math.abs(hash * 139 + 79).toString(16).padStart(8, '0');
    const h5 = Math.abs(hash * 251 + 101).toString(16).padStart(8, '0');
    const h6 = Math.abs(hash * 383 + 173).toString(16).padStart(8, '0');
    const h7 = Math.abs(hash * 499 + 211).toString(16).padStart(8, '0');
    const h8 = Math.abs(hash * 613 + 307).toString(16).padStart(8, '0');
    return (h1 + h2 + h3 + h4 + h5 + h6 + h7 + h8).toUpperCase();
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

// Variables de paginación del Dashboard
let dashboardCurrentPage = 1;
let dashboardPerPage = 25;

function changeDashboardPerPage(val) {
    dashboardPerPage = val === 'all' ? 'all' : parseInt(val, 10);
    dashboardCurrentPage = 1;
    renderTable();
}

function goToDashboardPage(target) {
    if (target === 'prev') {
        if (dashboardCurrentPage > 1) dashboardCurrentPage--;
    } else if (target === 'next') {
        dashboardCurrentPage++;
    } else if (typeof target === 'number') {
        dashboardCurrentPage = target;
    }
    renderTable();
}

function renderDashboardPagination(totalPages) {
    const prevBtn = document.getElementById('dashboard-prev-btn');
    const nextBtn = document.getElementById('dashboard-next-btn');
    const numbersContainer = document.getElementById('dashboard-page-numbers');

    if (prevBtn) prevBtn.disabled = dashboardCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = dashboardCurrentPage >= totalPages || totalPages === 0;

    if (numbersContainer) {
        numbersContainer.innerHTML = '';
        if (totalPages <= 1) return;

        let startPage = Math.max(1, dashboardCurrentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        if (startPage > 1) {
            const btn1 = document.createElement('button');
            btn1.className = 'w-8 h-8 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400';
            btn1.textContent = '1';
            btn1.onclick = () => goToDashboardPage(1);
            numbersContainer.appendChild(btn1);

            if (startPage > 2) {
                const dots = document.createElement('span');
                dots.className = 'px-1 text-slate-400 text-xs';
                dots.textContent = '...';
                numbersContainer.appendChild(dots);
            }
        }

        for (let p = startPage; p <= endPage; p++) {
            const btn = document.createElement('button');
            if (p === dashboardCurrentPage) {
                btn.className = 'w-8 h-8 rounded-lg text-xs font-bold bg-indigo-600 text-white shadow-sm';
            } else {
                btn.className = 'w-8 h-8 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400';
            }
            btn.textContent = p;
            btn.onclick = () => goToDashboardPage(p);
            numbersContainer.appendChild(btn);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const dots = document.createElement('span');
                dots.className = 'px-1 text-slate-400 text-xs';
                dots.textContent = '...';
                numbersContainer.appendChild(dots);
            }
            const btnLast = document.createElement('button');
            btnLast.className = 'w-8 h-8 rounded-lg text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400';
            btnLast.textContent = totalPages;
            btnLast.onclick = () => goToDashboardPage(totalPages);
            numbersContainer.appendChild(btnLast);
        }
    }
}

// Renderizar la tabla del Dashboard con Filtros de Búsqueda, de Tipo y Paginación
function renderTable() {
    const searchInput = document.getElementById('search-input');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const tbody = document.getElementById('submissions-list');
    const cardsContainer = document.getElementById('submissions-mobile-cards');
    const emptyState = document.getElementById('empty-state');
    const paginationBar = document.getElementById('dashboard-pagination-bar');

    if (tbody) tbody.innerHTML = '';
    if (cardsContainer) cardsContainer.innerHTML = '';

    const filtered = submissions.filter(s => {
        // Filtro por Tipo de Solicitud (Categoría de Botón)
        if (activeFilterType !== 'All' && s.tipo_solicitud !== activeFilterType) {
            return false;
        }

        // Filtro por Texto de Búsqueda
        const matchNombre = (s.funcionario && s.funcionario.nombre || '').toLowerCase().includes(search);
        const matchRut = (s.funcionario && s.funcionario.rut || '').toLowerCase().includes(search);
        const matchDepto = (s.funcionario && s.funcionario.depto || '').toLowerCase().includes(search);
        const matchTicket = (s.ticket || '').toLowerCase().includes(search);
        const matchTipo = (s.tipo_solicitud || '').toLowerCase().includes(search);
        const matchSerie = s.equipamiento && s.equipamiento.some(e => (e.serie || '').toLowerCase().includes(search));
        const matchModelo = s.equipamiento && s.equipamiento.some(e => (e.modelo || '').toLowerCase().includes(search));
        return matchNombre || matchRut || matchDepto || matchTicket || matchTipo || matchSerie || matchModelo;
    });

    if (filtered.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (paginationBar) paginationBar.classList.add('hidden');
    } else {
        if (emptyState) emptyState.classList.add('hidden');
        if (paginationBar) paginationBar.classList.remove('hidden');

        // Paginación
        const totalItems = filtered.length;
        let perPage = dashboardPerPage === 'all' ? totalItems : dashboardPerPage;
        const totalPages = Math.ceil(totalItems / perPage) || 1;

        if (dashboardCurrentPage > totalPages) dashboardCurrentPage = totalPages;
        if (dashboardCurrentPage < 1) dashboardCurrentPage = 1;

        const startIndex = (dashboardCurrentPage - 1) * perPage;
        const endIndex = dashboardPerPage === 'all' ? totalItems : Math.min(startIndex + perPage, totalItems);
        const paginated = filtered.slice(startIndex, endIndex);

        // Actualizar resumen de conteo
        const summary = document.getElementById('dashboard-count-summary');
        if (summary) {
            summary.textContent = `Mostrando ${totalItems === 0 ? 0 : startIndex + 1} a ${endIndex} de ${totalItems} solicitudes`;
        }

        // Renderizar controles de página
        renderDashboardPagination(totalPages);

        paginated.forEach(s => {
            let badgesSolicitud = '';
            let badgeBgClass = 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400';
            if (s.tipo_solicitud === 'Asignacion') {
                badgesSolicitud = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-450"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Asignación</span>';
                badgeBgClass = 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200/50';
            } else if (s.tipo_solicitud === 'Traspaso') {
                badgesSolicitud = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-450"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Traspaso</span>';
                badgeBgClass = 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/50';
            } else {
                badgesSolicitud = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-455"><span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>Devolución</span>';
                badgeBgClass = 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200/50';
            }

            // Formatear resumen de equipos
            const eqSummary = s.equipamiento && s.equipamiento.length > 0
                ? s.equipamiento.map(e => `${e.tipo} (${e.marca || ''} ${e.modelo || ''})`).join(', ')
                : 'Sin equipos especificados';

            // 1. RENDER PARA ESCRITORIO (Tabla)
            if (tbody) {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-100 dark:border-slate-800/60";
                tr.innerHTML = `
                    <td class="py-4 px-6 font-medium text-slate-900 dark:text-slate-100">${s.fecha}</td>
                    <td class="py-4 px-6 font-mono text-xs text-indigo-650 dark:text-indigo-400 font-semibold">${s.ticket}</td>
                    <td class="py-4 px-6">
                        <div class="font-medium text-slate-850 dark:text-slate-200">${s.funcionario.nombre}</div>
                        <div class="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">${s.funcionario.rut || ''} ${s.funcionario.depto ? '• ' + s.funcionario.depto : ''}</div>
                    </td>
                    <td class="py-4 px-6">${badgesSolicitud}</td>
                    <td class="py-4 px-6 max-w-xs truncate text-slate-500 dark:text-slate-450" title="${eqSummary}">${eqSummary}</td>
                    <td class="py-4 px-6 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="viewAndEditForm('${s.id}')" class="p-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors" title="Ver / Editar Registro">
                                <i data-lucide="edit" class="w-4.5 h-4.5"></i>
                            </button>
                            <button onclick="generateOfficerLink('${s.id}')" class="p-2 text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/50 transition-colors" title="Generar / Copiar Link para Funcionario">
                                <i data-lucide="link" class="w-4.5 h-4.5"></i>
                            </button>
                            <button onclick="cloneSubmission('${s.id}')" class="p-2 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors" title="Duplicar / Clonar en Nueva Solicitud">
                                <i data-lucide="copy" class="w-4.5 h-4.5"></i>
                            </button>
                            ${currentUserRole === 'admin' ? `
                            <button onclick="deleteSubmission('${s.id}')" class="p-2 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors" title="Eliminar Registro (Solo Admin)">
                                <i data-lucide="trash-2" class="w-4.5 h-4.5"></i>
                            </button>` : ''}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            }

            // 2. RENDER PARA MÓVIL / TABLET (Tarjetas Táctiles con Menú Emergente)
            if (cardsContainer) {
                const card = document.createElement('div');
                card.className = "p-4 sm:p-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-all cursor-pointer active:scale-[0.99] border-b border-slate-100 dark:border-slate-800/80";
                card.onclick = (e) => {
                    openMobileActions(s.id);
                };
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-3">
                        <div class="space-y-1 min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeBgClass}">${s.tipo_solicitud}</span>
                                <span class="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-md">${s.ticket}</span>
                                <span class="text-xs text-slate-400 dark:text-slate-500 font-medium">${s.fecha}</span>
                            </div>
                            <h4 class="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight mt-1 truncate">${s.funcionario.nombre}</h4>
                            <p class="text-xs text-slate-400 dark:text-slate-500 font-mono">${s.funcionario.rut || 'S/R'} • <span class="text-slate-500 dark:text-slate-400">${s.funcionario.depto || 'Sin Depto'}</span></p>
                        </div>
                        
                        <!-- Botón de 3 Puntos para Menú de Acciones -->
                        <button type="button" class="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950 transition-colors shrink-0 shadow-sm" title="Opciones del Registro">
                            <i data-lucide="more-vertical" class="w-5 h-5"></i>
                        </button>
                    </div>
                    
                    <!-- Resumen de Equipos en Tarjeta Móvil -->
                    <div class="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span class="inline-flex items-center gap-1.5 truncate max-w-[80%]">
                            <i data-lucide="laptop" class="w-4 h-4 text-slate-400 shrink-0"></i>
                            <span class="truncate">${eqSummary}</span>
                        </span>
                        <span class="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">Tocar para opciones</span>
                    </div>
                `;
                cardsContainer.appendChild(card);
            }
        });
    }
    lucide.createIcons();
}

// Abrir Menú / Ventana Emergente de Acciones Móviles (Action Sheet)
function openMobileActions(id) {
    const sub = submissions.find(s => s.id === id);
    if (!sub) return;

    const modal = document.getElementById('mobile-action-modal');
    if (!modal) return;

    // Rellenar datos en la cabecera del modal
    document.getElementById('m-action-nombre').innerText = sub.funcionario.nombre;
    document.getElementById('m-action-rut').innerText = `${sub.funcionario.rut} • ${sub.funcionario.depto || 'Sin Depto'}`;
    document.getElementById('m-action-ticket').innerText = sub.ticket;

    const badgeEl = document.getElementById('m-action-badge');
    badgeEl.innerText = sub.tipo_solicitud;
    if (sub.tipo_solicitud === 'Asignacion') {
        badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400';
    } else if (sub.tipo_solicitud === 'Traspaso') {
        badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400';
    } else {
        badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400';
    }

    const eqSummary = sub.equipamiento.map(e => `${e.tipo} (${e.marca} ${e.modelo})`).join(', ') || 'Sin equipamiento especificado';
    document.getElementById('m-action-equipos').innerText = eqSummary;

    // Configurar listeners de los botones táctiles
    document.getElementById('m-btn-edit').onclick = () => {
        closeMobileActions();
        viewAndEditForm(id);
    };
    document.getElementById('m-btn-link').onclick = () => {
        closeMobileActions();
        generateOfficerLink(id);
    };
    document.getElementById('m-btn-clone').onclick = () => {
        closeMobileActions();
        cloneSubmission(id);
    };
    document.getElementById('m-btn-print').onclick = () => {
        closeMobileActions();
        printDirectSubmission(id);
    };
    const mDelete = document.getElementById('m-btn-delete');
    if (mDelete) {
        if (currentUserRole === 'admin') {
            mDelete.classList.remove('hidden');
            mDelete.onclick = () => {
                closeMobileActions();
                deleteSubmission(id);
            };
        } else {
            mDelete.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');
    lucide.createIcons();
}

// Cerrar Menú de Acciones Móviles
function closeMobileActions() {
    const modal = document.getElementById('mobile-action-modal');
    if (modal) modal.classList.add('hidden');
}

// Imprimir directamente un registro desde el panel móvil o tabla
function printDirectSubmission(id) {
    viewAndEditForm(id);
    setTimeout(() => {
        triggerPrintMode();
    }, 400);
}

// Duplicar / Clonar un registro existente para acelerar nuevas solicitudes similares
function cloneSubmission(id) {
    const original = submissions.find(s => s.id === id);
    if (!original) return;

    // Abrir formulario nuevo
    openNewForm();

    // Rellenar fecha actual hoy y ticket
    document.getElementById('form-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('form-ticket').value = original.ticket === 'S/N' ? '' : original.ticket;

    // Funcionario
    document.getElementById('func-nombre').value = original.funcionario.nombre || '';
    document.getElementById('func-rut').value = original.funcionario.rut || '';
    handleRutInput(document.getElementById('func-rut'));
    document.getElementById('func-cargo').value = original.funcionario.cargo || '';
    document.getElementById('func-depto').value = original.funcionario.depto || '';

    // Tipo de solicitud y propiedad
    const radioSol = document.querySelector(`input[name="solicitud_tipo"][value="${original.tipo_solicitud}"]`);
    if (radioSol) radioSol.checked = true;
    toggleTraspasoSection();

    const radioProp = document.querySelector(`input[name="propiedad_tipo"][value="${original.propiedad_equipamiento}"]`);
    if (radioProp) radioProp.checked = true;

    // Categorías de equipamiento
    document.querySelectorAll('input[name="eq_cat"]').forEach(cb => {
        cb.checked = (original.equipamiento_categorias || []).includes(cb.value);
    });
    document.getElementById('eq_otros_detalles').value = original.otros_detalles || '';

    // Traspaso si aplica
    if (original.tipo_solicitud === 'Traspaso' && original.traspaso) {
        document.getElementById('traspaso-emisor-nombre').value = original.traspaso.emisor_nombre || '';
        document.getElementById('traspaso-emisor-depto').value = original.traspaso.emisor_depto || '';
        document.getElementById('traspaso-receptor-nombre').value = original.traspaso.receptor_nombre || '';
        document.getElementById('traspaso-receptor-depto').value = original.traspaso.receptor_depto || '';
        document.getElementById('traspaso-observacion').value = original.traspaso.observacion || '';
    }

    // Equipos
    const container = document.getElementById('equipment-rows');
    container.innerHTML = '';
    if (original.equipamiento && original.equipamiento.length > 0) {
        original.equipamiento.forEach(eq => {
            addEquipmentRow({
                tipo: eq.tipo || '',
                marca: eq.marca || '',
                modelo: eq.modelo || '',
                serie: eq.serie || '',
                inventario: eq.inventario || '',
                observacion: eq.observacion || ''
            });
        });
    } else {
        addEquipmentRow();
    }

    // Accesorios y Observaciones
    document.getElementById('form-accesorios').value = original.accesorios || '';
    document.getElementById('form-observaciones').value = original.observaciones_generales || '';

    showToast("Formulario duplicado exitosamente. Listo para editar y firmar.", "info");
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

    // Rellenar sección 2
    document.querySelector(`input[name="solicitud_tipo"][value="${s.tipo_solicitud}"]`).checked = true;
    toggleTraspasoSection();

    document.querySelector(`input[name="propiedad_tipo"][value="${s.propiedad_equipamiento}"]`).checked = true;

    // Checkboxes categorías
    document.querySelectorAll('input[name="eq_cat"]').forEach(cb => {
        cb.checked = (s.equipamiento_categorias || []).includes(cb.value);
    });
    document.getElementById('eq_otros_detalles').value = s.otros_detalles || '';

    // Rellenar sección 3 (Traspaso)
    if (s.tipo_solicitud === 'Traspaso' && s.traspaso) {
        document.getElementById('traspaso-emisor-nombre').value = s.traspaso.emisor_nombre || '';
        document.getElementById('traspaso-emisor-depto').value = s.traspaso.emisor_depto || '';
        document.getElementById('traspaso-receptor-nombre').value = s.traspaso.receptor_nombre || '';
        document.getElementById('traspaso-receptor-depto').value = s.traspaso.receptor_depto || '';
        document.getElementById('traspaso-observacion').value = s.traspaso.observacion || '';
    }

    // Rellenar sección 4 (Tabla de equipos)
    const eqContainer = document.getElementById('equipment-rows');
    eqContainer.innerHTML = '';
    if (s.equipamiento && s.equipamiento.length > 0) {
        s.equipamiento.forEach(eq => {
            addEquipmentRow(eq);
        });
    } else {
        addEquipmentRow();
    }

    // Rellenar sección 5
    document.getElementById('form-accesorios').value = s.accesorios || '';
    document.getElementById('form-observaciones').value = s.observaciones_generales || '';

    // Rellenar modos de firma (Oficial / Digital / Manual)
    const sigModes = s.firmas || {};
    let ticTargetMode = 'oficial';
    if (sigModes.tic_mode) {
        ticTargetMode = sigModes.tic_mode;
    } else if (sigModes.tic && sigModes.tic.startsWith('data:image')) {
        ticTargetMode = 'digital';
    } else {
        ticTargetMode = 'oficial';
    }

    const ticRadio = document.querySelector(`input[name="sig_mode_tic"][value="${ticTargetMode}"]`) || document.querySelector('input[name="sig_mode_tic"][value="oficial"]');
    if (ticRadio) ticRadio.checked = true;

    const emisorRadio = document.querySelector(`input[name="sig_mode_emisor"][value="${sigModes.emisor_mode || (sigModes.emisor ? 'digital' : 'manual')}"]`);
    if (emisorRadio) emisorRadio.checked = true;

    const receptorRadio = document.querySelector(`input[name="sig_mode_receptor"][value="${sigModes.receptor_mode || (sigModes.receptor ? 'digital' : 'manual')}"]`);
    if (receptorRadio) receptorRadio.checked = true;

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
            if (ticTargetMode === 'digital' && s.firmas?.tic) drawSavedSignature('tic', s.firmas.tic);
            if (sigModes.emisor_mode === 'digital' && s.firmas?.emisor) drawSavedSignature('emisor', s.firmas.emisor);
            if (sigModes.receptor_mode === 'digital' && s.firmas?.receptor) drawSavedSignature('receptor', s.firmas.receptor);
        }, 120);
    }, 120);
}

// Función para renderizar firmas almacenadas en los paneles canvas respetando devicePixelRatio
function drawSavedSignature(id, dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
        clearCanvas(id);
        return;
    }
    const canvas = document.getElementById(`canvas-${id}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (drawingStates[id]) drawingStates[id].hasSigned = true;

    const img = new Image();
    img.onload = function () {
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.width / ratio;
        const height = canvas.height / ratio;
        ctx.drawImage(img, 0, 0, width, height);
        if (drawingStates[id]) drawingStates[id].hasSigned = true;
        updateSignatureFeedback(id);
    };
    img.src = dataUrl;
}

// Modal de Confirmación Universal Basado en Promesas
function showConfirmModal(title, message, confirmText = "Confirmar", isDanger = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-message');
        const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
        const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
        const iconContainer = document.getElementById('confirm-modal-icon-container');
        const icon = document.getElementById('confirm-modal-icon');

        titleEl.innerText = title;
        msgEl.innerText = message;
        confirmBtn.innerText = confirmText;

        if (isDanger) {
            confirmBtn.className = "px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition-colors";
            iconContainer.className = "p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 shrink-0";
            icon.setAttribute('data-lucide', 'alert-triangle');
        } else {
            confirmBtn.className = "px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors";
            iconContainer.className = "p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 shrink-0";
            icon.setAttribute('data-lucide', 'help-circle');
        }
        lucide.createIcons();

        modal.classList.remove('hidden');

        const cleanup = (result) => {
            modal.classList.add('hidden');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        };

        const onConfirm = () => cleanup(true);
        const onCancel = () => cleanup(false);

        confirmBtn.addEventListener('click', onConfirm, { once: true });
        cancelBtn.addEventListener('click', onCancel, { once: true });
    });
}

// Eliminar Registro con modal moderno (Solo Admin)
async function deleteSubmission(id) {
    if (currentUserRole !== 'admin') {
        showToast("Solo los usuarios con rol de Administrador pueden eliminar registros.", "error");
        return;
    }
    const confirmed = await showConfirmModal(
        "Eliminar Registro",
        "¿Está seguro de que desea eliminar permanentemente este registro del historial local?",
        "Eliminar",
        true
    );
    if (confirmed) {
        submissions = submissions.filter(s => s.id !== id);
        if (activeSubmissionId === id) {
            activeSubmissionId = null;
        }
        saveSubmissionsToStorage();
        deleteSubmissionFromSupabase(id);
        renderTable();
        showToast("Registro eliminado del historial.", "success");
    }
}

// Limpiar Base de Datos completa (Solo Admin)
async function clearAllSubmissions() {
    if (currentUserRole !== 'admin') {
        showToast("Solo los usuarios con rol de Administrador pueden vaciar la base de datos.", "error");
        return;
    }
    if (submissions.length === 0) {
        showToast("No hay registros en la base de datos para eliminar.", "info");
        return;
    }
    const confirmed = await showConfirmModal(
        "¿Limpiar toda la Base de Datos?",
        `Estás a punto de eliminar permanentemente los ${submissions.length} registros guardados en este navegador. Te recomendamos hacer un "Respaldar JSON" antes de continuar.`,
        "Sí, vaciar base de datos",
        true
    );
    if (!confirmed) return;

    submissions = [];
    localStorage.removeItem('tic_equip_submissions');
    renderTable();
    updateStats();
    showToast("Base de datos local vaciada con éxito.", "success");
}

// Generar Link para Funcionario (Compartir formulario vía URL)
function generateOfficerLink(id = null) {
    let targetSub = null;
    if (id) {
        targetSub = submissions.find(s => s.id === id);
    } else if (activeSubmissionId) {
        targetSub = submissions.find(s => s.id === activeSubmissionId);
    }

    let shareUrl = window.location.origin + window.location.pathname;
    if (targetSub) {
        const payload = {
            id: targetSub.id,
            fecha: targetSub.fecha,
            ticket: targetSub.ticket,
            funcionario: targetSub.funcionario,
            tipo_solicitud: targetSub.tipo_solicitud,
            propiedad_equipamiento: targetSub.propiedad_equipamiento,
            equipamiento_categorias: targetSub.equipamiento_categorias,
            equipamiento: targetSub.equipamiento,
            accesorios: targetSub.accesorios,
            observaciones_generales: targetSub.observaciones_generales
        };
        try {
            const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
            shareUrl += `?data=${encoded}`;
        } catch (e) {
            shareUrl += `?ticket=${encodeURIComponent(targetSub.ticket || targetSub.id)}`;
        }
    } else {
        // Enlace para crear nueva solicitud
        shareUrl += `?new=1`;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showToast("Enlace copiado al portapapeles listo para enviar al funcionario.", "success");
        }).catch(() => {
            prompt("Copia este enlace para el funcionario:", shareUrl);
        });
    } else {
        prompt("Copia este enlace para el funcionario:", shareUrl);
    }
}

// Cargar datos desde URL si existen al iniciar
function checkUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('data')) {
        try {
            const rawData = decodeURIComponent(escape(atob(decodeURIComponent(params.get('data')))));
            const parsed = JSON.parse(rawData);
            if (parsed) {
                openNewForm();
                if (parsed.fecha) document.getElementById('form-fecha').value = parsed.fecha;
                if (parsed.ticket) document.getElementById('form-ticket').value = parsed.ticket;
                if (parsed.funcionario) {
                    document.getElementById('func-nombre').value = parsed.funcionario.nombre || '';
                    document.getElementById('func-rut').value = parsed.funcionario.rut || '';
                    handleRutInput(document.getElementById('func-rut'));
                    document.getElementById('func-cargo').value = parsed.funcionario.cargo || '';
                    document.getElementById('func-depto').value = parsed.funcionario.depto || '';
                }
                if (parsed.tipo_solicitud) {
                    const r = document.querySelector(`input[name="solicitud_tipo"][value="${parsed.tipo_solicitud}"]`);
                    if (r) { r.checked = true; toggleTraspasoSection(); }
                }
                if (parsed.propiedad_equipamiento) {
                    const p = document.querySelector(`input[name="propiedad_tipo"][value="${parsed.propiedad_equipamiento}"]`);
                    if (p) p.checked = true;
                }
                if (parsed.equipamiento && parsed.equipamiento.length > 0) {
                    const eqContainer = document.getElementById('equipment-rows');
                    eqContainer.innerHTML = '';
                    parsed.equipamiento.forEach(eq => addEquipmentRow(eq));
                }
                if (parsed.accesorios) document.getElementById('form-accesorios').value = parsed.accesorios;
                if (parsed.observaciones_generales) document.getElementById('form-observaciones').value = parsed.observaciones_generales;

                showToast("Formulario cargado automáticamente desde el enlace recibido.", "info");
            }
        } catch (e) {
            console.warn("Aviso al procesar parámetros URL:", e);
        }
    } else if (params.has('new')) {
        openNewForm();
    }
}

// Exportar Respaldo completo en formato JSON
function exportBackupJSON() {
    if (submissions.length === 0) {
        showToast("No hay registros en el historial para respaldar.", "error");
        return;
    }
    const backupData = {
        app: "Gestion_Equipamiento_TIC_ISP",
        version: "RG-02-IT-140.03-004-V5",
        fechaExportacion: new Date().toISOString(),
        totalRegistros: submissions.length,
        submissions: submissions
    };
    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `respaldo_formularios_isp_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Copia de seguridad descargada (${submissions.length} registros).`, "success");
}

// Restaurar copia de seguridad desde un archivo JSON (Solo Admin)
function importBackupJSON(event) {
    if (currentUserRole !== 'admin') {
        showToast("Solo los usuarios con rol de Administrador pueden restaurar copias de seguridad.", "error");
        event.target.value = '';
        return;
    }
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            let importedList = [];
            if (Array.isArray(parsed)) {
                importedList = parsed;
            } else if (parsed && Array.isArray(parsed.submissions)) {
                importedList = parsed.submissions;
            } else if (parsed && Array.isArray(parsed.data)) {
                importedList = parsed.data;
            }

            if (!importedList || importedList.length === 0) {
                showToast("El archivo JSON no contiene registros válidos.", "error");
                return;
            }

            const confirmed = await showConfirmModal(
                "Restaurar Copia de Seguridad",
                `Se encontraron ${importedList.length} registro(s) en el archivo. ¿Desea importarlos a su historial local?`,
                "Importar Datos",
                false
            );

            if (!confirmed) {
                event.target.value = '';
                return;
            }

            let added = 0;
            let updated = 0;
            importedList.forEach(item => {
                if (!item.id) item.id = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                const existingIdx = submissions.findIndex(s => s.id === item.id);
                if (existingIdx >= 0) {
                    submissions[existingIdx] = item;
                    updated++;
                } else {
                    submissions.push(item);
                    added++;
                }
            });

            saveSubmissionsToStorage();
            renderTable();
            showToast(`Restauración exitosa: ${added} agregados, ${updated} actualizados.`, "success");
            if (isSupabaseReady && navigator.onLine) {
                importedList.forEach(item => syncSubmissionToSupabase(item));
            }
        } catch (err) {
            console.error("Error al importar JSON", err);
            showToast("El archivo seleccionado no es un JSON válido.", "error");
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
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

// Plantillas Rápidas de Equipamiento ("Kits TIC")
function toggleKitDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('kit-dropdown-menu');
    if (menu) menu.classList.toggle('hidden');
}

function insertEquipmentKit(kitType) {
    const container = document.getElementById('equipment-rows');

    // Si sólo hay una fila vacía, la reemplazamos
    const firstRow = container.querySelector('tr');
    if (firstRow && container.children.length === 1) {
        const serieInput = firstRow.querySelector('[name="eq_serie"]');
        if (serieInput && !serieInput.value.trim()) {
            container.innerHTML = '';
        }
    }

    const kitMenu = document.getElementById('kit-dropdown-menu');
    if (kitMenu) kitMenu.classList.add('hidden');

    const accField = document.getElementById('form-accesorios');

    if (kitType === 'notebook') {
        addEquipmentRow({
            tipo: 'Notebook',
            marca: 'HP',
            modelo: 'ProBook',
            serie: '',
            inventario: '',
            observacion: 'Equipo portátil institucional'
        });
        addEquipmentRow({
            tipo: 'Monitor',
            marca: 'HP',
            modelo: '24" FHD',
            serie: '',
            inventario: '',
            observacion: 'Pantalla auxiliar'
        });
        checkEquipmentCategory('Notebook');
        checkEquipmentCategory('Monitor');
        if (!accField.value.trim()) {
            accField.value = 'Bolso de transporte original, Cargador original 65W, Cable HDMI/DisplayPort, Mouse USB óptico.';
        }
    } else if (kitType === 'pc') {
        addEquipmentRow({
            tipo: 'PC',
            marca: 'HP',
            modelo: 'ProDesk Torre',
            serie: '',
            inventario: '',
            observacion: 'Computador de escritorio'
        });
        addEquipmentRow({
            tipo: 'Monitor',
            marca: 'HP',
            modelo: '24" FHD',
            serie: '',
            inventario: '',
            observacion: 'Monitor institucional'
        });
        checkEquipmentCategory('PC');
        checkEquipmentCategory('Monitor');
        if (!accField.value.trim()) {
            accField.value = 'Cable poder x2, Cable HDMI/DisplayPort, Teclado USB institucional, Mouse USB óptico.';
        }
    } else if (kitType === 'aio') {
        addEquipmentRow({
            tipo: 'All In One',
            marca: 'HP',
            modelo: '24" All In One',
            serie: '',
            inventario: '',
            observacion: 'Equipo integrado All-In-One'
        });
        checkEquipmentCategory('All In One');
        if (!accField.value.trim()) {
            accField.value = 'Fuente de poder original, Teclado USB institucional, Mouse USB óptico.';
        }
    } else if (kitType === 'movil') {
        addEquipmentRow({
            tipo: 'Celular',
            marca: 'Samsung',
            modelo: 'Galaxy',
            serie: '',
            inventario: '',
            observacion: 'Smartphone institucional'
        });
        checkEquipmentCategory('Celular');
        checkEquipmentCategory('SIMCARD');
        if (!accField.value.trim()) {
            accField.value = 'Cargador de pared rápido, Cable USB-C a USB-C, Chip SIM Card ISP instalada y activa.';
        }
    }

    showToast("Plantilla de equipamiento cargada en la tabla.", "success");
}

function checkEquipmentCategory(catValue) {
    const cb = document.querySelector(`input[name="eq_cat"][value="${catValue}"]`);
    if (cb) cb.checked = true;
}

// ================= VISTA PREVIA OFICIAL EN VIVO =================
function triggerPrintMode() {
    openPrintPreview();
}

function openPrintPreview() {
    // 1. Sincronizar todos los datos del formulario al template de impresion
    syncPrintTemplate();

    const container = document.getElementById('print-only-container');
    const wrapper = document.getElementById('print-preview-sheets-wrapper');
    const modal = document.getElementById('print-preview-modal');

    if (!container || !wrapper || !modal) {
        proceedToPrint();
        return;
    }

    // 2. Clonar el contenido de impresion dentro del visor
    wrapper.innerHTML = container.innerHTML;

    // 3. Abrir el modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    filterPreviewPage('all');
    lucide.createIcons();
}

function closePrintPreview() {
    const modal = document.getElementById('print-preview-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}

function filterPreviewPage(page) {
    const wrapper = document.getElementById('print-preview-sheets-wrapper');
    if (!wrapper) return;
    const pages = wrapper.querySelectorAll('.print-page');

    // Resetear botones
    ['all', 'p1', 'p2'].forEach(id => {
        const btn = document.getElementById(`preview-btn-${id}`);
        if (btn) {
            btn.className = "px-2.5 py-1 rounded-lg font-semibold text-slate-400 hover:text-white transition-all";
        }
    });

    if (page === 'all') {
        pages.forEach(p => p.classList.remove('hidden'));
        const btn = document.getElementById('preview-btn-all');
        if (btn) btn.className = "px-2.5 py-1 rounded-lg font-semibold bg-indigo-600 text-white transition-all";
    } else if (page === 1) {
        if (pages[0]) pages[0].classList.remove('hidden');
        if (pages[1]) pages[1].classList.add('hidden');
        const btn = document.getElementById('preview-btn-p1');
        if (btn) btn.className = "px-2.5 py-1 rounded-lg font-semibold bg-indigo-600 text-white transition-all";
    } else if (page === 2) {
        if (pages[0]) pages[0].classList.add('hidden');
        if (pages[1]) pages[1].classList.remove('hidden');
        const btn = document.getElementById('preview-btn-p2');
        if (btn) btn.className = "px-2.5 py-1 rounded-lg font-semibold bg-indigo-600 text-white transition-all";
    }
}

function confirmPrintFromPreview() {
    closePrintPreview();
    setTimeout(() => {
        proceedToPrint();
    }, 150);
}

async function exportPdfFromPreview() {
    if (window.electronAPI && typeof window.electronAPI.savePdf === 'function') {
        try {
            syncPrintTemplate();
            const rut = document.getElementById('rut_receptor')?.value || 'ACTA';
            const folio = document.getElementById('ticket_ot')?.value || 'TIC';
            const defaultName = `Acta_TIC_${folio}_${rut}.pdf`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

            showToast('Generando archivo PDF oficial...', 'info');
            const result = await window.electronAPI.savePdf(defaultName);
            if (result.success) {
                showToast(`Acta guardada exitosamente en: ${result.filePath}`, 'success');
            }
        } catch (e) {
            console.error('Error al exportar PDF:', e);
            showToast('Error al generar PDF: ' + e.message, 'error');
        }
    } else {
        confirmPrintFromPreview();
    }
}

function closePrintGuide() {
    const modal = document.getElementById('print-guide-modal');
    if (modal) modal.classList.add('hidden');
}

function proceedToPrint() {
    const check = document.getElementById('dont-show-print-guide');
    if (check && check.checked) {
        localStorage.setItem('isp_hide_print_guide', 'true');
    }
    closePrintGuide();
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

// Normalizar nombres de personas para evitar duplicidad de actas por tildes/espacios
function normalizePersonKey(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Limpiar formato de nombre de persona
function cleanPersonName(name) {
    return String(name || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Normalizar y sanear número de serie
function normalizeSerial(serie, codArriendo, contrato) {
    let s = String(serie || '').trim();
    let ca = String(codArriendo || '').trim();
    const cStr = String(contrato || '');

    // Corregir columnas desplazadas en contratos (ej. '7', 'False', 'NO ENTREGÓ', 'N/A')
    if (s === '7' || s.toLowerCase() === 'false' || s.toLowerCase().includes('entreg') || s.toUpperCase() === 'N/A' || s === '') {
        if (ca.length > 3) {
            s = ca;
        }
    }

    // Expandir números de serie de Acer Veriton AIO si vienen recortados
    if (/^[0-9A-F]{8}$/i.test(s) && (cStr.includes('Netnow') || cStr.includes('2023'))) {
        s = 'DQVUYAL0082380' + s.toUpperCase();
    } else if (s.includes(' ')) {
        s = s.replace(/\s+/g, '');
    }

    if (s === '7' || s.toLowerCase() === 'false' || s.toUpperCase() === 'N/A' || s === '-' || !s) {
        s = 'S/N';
    }

    return s;
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
        else if (norm === 'ninventarioisp' || norm === 'ninventario') cleaned.inventario = val;
        else if (norm === 'nserie' || norm === 'serie') cleaned.serie = val;
        else if (norm === 'tipopcnotebookaio' || norm === 'tipoimpresorascannermfp' || norm === 'tipo') cleaned.tipo = val;
        else if (norm === 'marca') cleaned.marca = val;
        else if (norm === 'modelo') cleaned.modelo = val;
        else if (norm === 'propiedadarriendoisp' || norm === 'propiedad') cleaned.propiedad = val;
        else if (norm === 'funcionarioa' || norm === 'nombrefuncionario' || norm === 'funcionario' || norm === 'nombre') cleaned.funcionario = val;
        else if (norm === 'mail' || norm === 'correo') cleaned.mail = val;
        else if (norm === 'unidaddepto' || norm === 'departamento' || norm === 'unidad') cleaned.depto = val;
        else if (norm === 'estado') cleaned.estado = val;
        else if (norm === 'observaciones' || norm === 'observacion') cleaned.observaciones = val;
    }
    cleaned.sheet = sourceSheet;

    const contrato = String(row['Contrato Arriendo'] || '');
    const codArriendo = String(row['Código Arriendo'] || '').trim();

    cleaned.serie = normalizeSerial(cleaned.serie, codArriendo, contrato);

    if (cleaned.serie.startsWith('DQV')) {
        cleaned.marca = 'Acer';
        cleaned.modelo = cleaned.modelo || 'Veriton AIO';
        cleaned.tipo = 'All In One';
    }

    // Corregir cuando el email quedó en Unidad/Depto y el departamento en Ubicación física / Subdepartamento
    if (cleaned.depto && cleaned.depto.includes('@')) {
        cleaned.mail = cleaned.depto;
        const ubicacion = String(row['Ubicación física'] || row['Subdepartamento'] || row['Sección'] || '').trim();
        cleaned.depto = ubicacion || 'ISP';
    }

    cleaned.funcionario = cleanPersonName(cleaned.funcionario);
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
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            uploadedWorkbook = XLSX.read(data, { type: 'array' });

            processWorkbookData();

            showToast("Planilla Excel cargada y depurada exitosamente.", "success");

        } catch (error) {
            console.error("Error al procesar Excel:", error);
            showToast("Error al procesar el archivo Excel. Verifique que sea el formato correcto.", "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

// Cargar el catálogo de catastro optimizado (Prioridad 1: JSON instantáneo <5ms, Fallback: XLSX)
function preloadExcelData() {
    // 1. Intentar carga ultrarrápida desde data/catastro.json
    fetch('data/catastro.json')
        .then(response => {
            if (!response.ok) throw new Error("JSON no disponible, usando fallback Excel");
            return response.json();
        })
        .then(data => {
            const comps = data.computers || [];
            const prints = data.printers || [];
            loadedAllEquipments = [...comps, ...prints];

            // Si hay solicitudes en el JSON, sincronizarlas limpiamente preservando solicitudes manuales
            if (data.submissions && Array.isArray(data.submissions)) {
                const manualSubs = submissions.filter(s => !s.id.startsWith('sub_excel_'));
                const excelSubs = data.submissions;
                submissions = [...manualSubs, ...excelSubs];
                saveSubmissionsToStorage();
            }

            // Actualizar interfaz instantáneamente
            populateInventoryDeptFilter();
            renderInventoryTable();
            renderTable();
            updateStats();

            // Sincronizar actas de la nube de Supabase sobre el catálogo cargado
            if (isSupabaseReady) {
                fetchSubmissionsFromSupabase();
            }

            const badge = document.getElementById('excel-status-badge');
            if (badge) {
                badge.innerHTML = `
                    <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-450 border border-emerald-200/50 dark:border-emerald-800 text-xs font-semibold shadow-sm">
                        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        Catastro Depurado: ${comps.length} Computadores y ${prints.length} Impresoras disponibles (${submissions.length} Actas Consolidadas sin Duplicados).
                    </div>
                `;
            }
            console.log(`Catastro JSON depurado cargado: ${loadedAllEquipments.length} equipos, ${submissions.length} actas consolidadas.`);
        })
        .catch(err => {
            console.log("Cargando Catastro desde Excel institucional...", err.message);
            // 2. Fallback a Catastro_ISP_2025_PRECARGADO.xlsx
            fetch('Catastro_ISP_2025_PRECARGADO.xlsx')
                .then(response => {
                    if (!response.ok) throw new Error("No se pudo cargar el archivo Excel.");
                    return response.arrayBuffer();
                })
                .then(buffer => {
                    const data = new Uint8Array(buffer);
                    uploadedWorkbook = XLSX.read(data, { type: 'array' });
                    processWorkbookData();
                    console.log("Excel catastral procesado exitosamente.");
                })
                .catch(e => {
                    console.warn("Precarga de Catastro omitida:", e.message);
                });
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
                const serie = row['N° Serie'] || row['N° de Serie'] || row['Serie'] || row['Código Arriendo'];
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

    // 3. Procesar todas las hojas (Equipos, Computadores e Impresoras) agrupando por funcionario único
    const grouped = {};

    function getOrCreateGroup(rawName, rut, cargo, depto, propiedad) {
        const cleanName = cleanPersonName(rawName);
        const key = normalizePersonKey(cleanName);
        if (!key) return null;

        if (!grouped[key]) {
            grouped[key] = {
                id: 'sub_excel_' + key.replace(/[^a-z0-9]/g, '_'),
                nombre: cleanName,
                rut: rut || '',
                cargo: cargo || '',
                depto: depto || '',
                propiedad: propiedad || 'En Arriendo',
                equipos: []
            };
        } else {
            if (!grouped[key].rut && rut) grouped[key].rut = rut;
            if (!grouped[key].cargo && cargo) grouped[key].cargo = cargo;
            if (!grouped[key].depto && depto) grouped[key].depto = depto;
        }
        return grouped[key];
    }

    // A. Primero incorporar datos de la hoja 'Equipos' (si contiene RUT, Cargo y Departamento)
    const equiposSheet = uploadedWorkbook.Sheets['Equipos'];
    if (equiposSheet) {
        const rawEquipos = XLSX.utils.sheet_to_json(equiposSheet);
        rawEquipos.forEach(item => {
            const nombre = item['Nombre Funcionario'] || item['Nombre'];
            const serie = item['Serie'] || item['N° Serie'];
            if (!nombre) return;

            const group = getOrCreateGroup(
                nombre,
                item['Rut'] || item['RUT'],
                item['Cargo'],
                item['Departamento'] || item['Unidad'],
                item['EsInventario'] === true || String(item['EsInventario']).toLowerCase() === 'true' ? 'Propiedad ISP' : 'En Arriendo'
            );
            if (!group) return;

            if (serie && String(serie).trim().length > 0) {
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
                    if (!group.equipos.some(e => e.serie && e.serie.toLowerCase() === eq.serie.toLowerCase())) {
                        group.equipos.push(eq);
                    }
                });
            }
        });
    }

    // B. Procesar e incorporar todos los Computadores
    computers.forEach(item => {
        if (!item.funcionario) return;
        const group = getOrCreateGroup(
            item.funcionario,
            '',
            '',
            item.depto,
            (item.propiedad || '').toLowerCase().includes('arriendo') ? 'En Arriendo' : 'Propiedad ISP'
        );
        if (!group) return;

        if (item.serie && item.serie !== 'S/N') {
            const rawEq = {
                tipo: item.tipo || 'Computador',
                marca: item.marca || 'Lenovo',
                modelo: item.modelo || (item._originalRow && item._originalRow['Código Arriendo'] ? item._originalRow['Código Arriendo'] : ''),
                serie: item.serie,
                inventario: item.inventario,
                observacion: item.observaciones
            };
            const splitEqs = splitEquipmentIfCombined(rawEq);
            splitEqs.forEach(eq => {
                if (!group.equipos.some(e => e.serie && e.serie.toLowerCase() === eq.serie.toLowerCase())) {
                    group.equipos.push(eq);
                }
            });
        }
    });

    // C. Procesar e incorporar todas las Impresoras
    printers.forEach(item => {
        if (!item.funcionario) return;
        const group = getOrCreateGroup(
            item.funcionario,
            '',
            '',
            item.depto,
            (item.propiedad || '').toLowerCase().includes('arriendo') ? 'En Arriendo' : 'Propiedad ISP'
        );
        if (!group) return;

        if (item.serie && item.serie !== 'S/N') {
            const rawEq = {
                tipo: item.tipo || 'Impresora',
                marca: item.marca || 'Brother',
                modelo: item.modelo || '',
                serie: item.serie,
                inventario: item.inventario,
                observacion: item.observaciones
            };
            const splitEqs = splitEquipmentIfCombined(rawEq);
            splitEqs.forEach(eq => {
                if (!group.equipos.some(e => e.serie && e.serie.toLowerCase() === eq.serie.toLowerCase())) {
                    group.equipos.push(eq);
                }
            });
        }
    });

    let importedCount = 0;
    const excelSubmissions = Object.values(grouped).map(group => {
        const cats = [];
        group.equipos.forEach(eq => {
            const t = (eq.tipo || '').toLowerCase();
            if (t === 'pc' || t.includes('desktop') || t.includes('torre')) {
                if (!cats.includes('PC')) cats.push('PC');
            }
            if (t.includes('notebook') || t.includes('laptop')) {
                if (!cats.includes('Notebook')) cats.push('Notebook');
            }
            if (t.includes('aio') || t.includes('all in one')) {
                if (!cats.includes('All In One')) cats.push('All In One');
            }
            if (t.includes('monitor') || t.includes('pantalla')) {
                if (!cats.includes('Monitor')) cats.push('Monitor');
            }
            if (t.includes('impresora') || t.includes('scanner') || t.includes('mfp')) {
                if (!cats.includes('Impresora')) cats.push('Impresora');
            }
        });

        return {
            id: group.id,
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
            equipamiento_categorias: cats,
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
    });

    const manualSubs = submissions.filter(s => !s.id.startsWith('sub_excel_'));
    submissions = [...manualSubs, ...excelSubmissions];
    importedCount = excelSubmissions.length;

    saveSubmissionsToStorage();
    renderTable();

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

    // Poblar departamentos dinámicos y refrescar inventario y métricas
    populateInventoryDeptFilter();
    renderInventoryTable();
    renderMetrics();
}

// Variable de seguimiento para navegación por teclado
let selectedSuggestionIndex = -1;

// Mostrar sugerencias de auto-completado en base a la consulta de búsqueda
function showExcelSuggestions(query) {
    const dropdown = document.getElementById('excel-suggestions-dropdown');
    dropdown.innerHTML = '';
    selectedSuggestionIndex = -1;

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

    matches.forEach((match, matchIdx) => {
        const item = match.item;
        const div = document.createElement('div');
        div.className = "suggestion-item p-3 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors flex justify-between items-center";
        div.dataset.index = match.index;
        div.dataset.pos = matchIdx;
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

// Inicializar navegación por teclado en el buscador de Catastro y cierre de menús
function initAutocompleteKeyboard() {
    const input = document.getElementById('excel-autocomplete-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('excel-suggestions-dropdown');
            if (!dropdown || dropdown.classList.contains('hidden')) return;

            const items = dropdown.querySelectorAll('.suggestion-item');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
                highlightSuggestionItem(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedSuggestionIndex = (selectedSuggestionIndex - 1 + items.length) % items.length;
                highlightSuggestionItem(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < items.length) {
                    items[selectedSuggestionIndex].click();
                }
            } else if (e.key === 'Escape') {
                dropdown.classList.add('hidden');
                selectedSuggestionIndex = -1;
            }
        });
    }

    // Ocultar desplegables si se hace clic fuera de ellos
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('excel-suggestions-dropdown');
        const inputEl = document.getElementById('excel-autocomplete-input');
        if (dropdown && !dropdown.contains(e.target) && e.target !== inputEl) {
            dropdown.classList.add('hidden');
        }

        const kitMenu = document.getElementById('kit-dropdown-menu');
        const kitBtn = document.getElementById('kit-dropdown-btn');
        if (kitMenu && kitBtn && !kitBtn.contains(e.target) && !kitMenu.contains(e.target)) {
            kitMenu.classList.add('hidden');
        }
    });
}

function highlightSuggestionItem(items) {
    items.forEach((item, idx) => {
        if (idx === selectedSuggestionIndex) {
            item.classList.add('bg-indigo-50', 'dark:bg-indigo-950/70', 'ring-1', 'ring-indigo-500');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('bg-indigo-50', 'dark:bg-indigo-950/70', 'ring-1', 'ring-indigo-500');
        }
    });
}

// Función auxiliar para separar equipos combinados (ej. AIO / MONITOR o series con "/")
function splitEquipmentIfCombined(rawEq) {
    const tipo = String(rawEq.tipo || '').trim();
    const serie = String(rawEq.serie || '').trim();
    const marca = String(rawEq.marca || '').trim();
    const modelo = String(rawEq.modelo || '').trim();
    const inventario = String(rawEq.inventario || '').trim();
    const observacion = String(rawEq.observacion || '').trim();

    const isNA = serie.toUpperCase() === 'N/A' || serie.toUpperCase() === 'S/N' || serie.toUpperCase() === 'N/D';
    const hasSlashTipo = tipo.includes('/') && !isNA;
    const hasSlashSerie = serie.includes('/') && !isNA;

    const isCombined = hasSlashTipo || hasSlashSerie ||
        (tipo.toLowerCase().includes('aio') && (tipo.toLowerCase().includes('monitor') || tipo.toLowerCase().includes('pantalla')));

    if (!isCombined) {
        return [rawEq];
    }

    const splitTipo = hasSlashTipo ? tipo.split('/') : [tipo];
    const splitSerie = hasSlashSerie ? serie.split('/') : [serie];
    const splitMarca = marca.includes('/') && !isNA ? marca.split('/') : [marca];
    const splitModelo = modelo.includes('/') && !isNA ? modelo.split('/') : [modelo];
    const splitInventario = inventario.includes('/') && !isNA ? inventario.split('/') : [inventario];
    const splitObservacion = observacion.includes('/') && !isNA ? observacion.split('/') : [observacion];

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

// ================= MÓDULO DE INVENTARIO DE CATASTRO (+900 EQUIPOS) =================
let inventoryFilterSearch = '';
let inventoryFilterType = 'All';
let inventoryFilterDept = 'All';
let inventoryFilterStatus = 'All';
let inventoryFilterSheet = 'All';
let inventoryCurrentPage = 1;
let inventoryPerPage = 25;

// Poblar selector dinámico de departamentos en los filtros
function populateInventoryDeptFilter() {
    const deptSelect = document.getElementById('inventory-dept-filter');
    if (!deptSelect) return;

    const currentVal = deptSelect.value;
    const deptsSet = new Set();

    loadedAllEquipments.forEach(item => {
        if (item.depto && item.depto.trim().length > 0 && item.depto.trim().toUpperCase() !== 'UNDEFINED') {
            deptsSet.add(item.depto.trim());
        }
    });

    const sortedDepts = Array.from(deptsSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    let html = '<option value="All">Todos los Departamentos</option>';
    sortedDepts.forEach(d => {
        html += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`;
    });
    deptSelect.innerHTML = html;

    if (sortedDepts.includes(currentVal)) {
        deptSelect.value = currentVal;
    }
}

// Manejar búsqueda en tiempo real
function handleInventorySearch() {
    const input = document.getElementById('inventory-search-input');
    const clearBtn = document.getElementById('inventory-search-clear');
    if (!input) return;

    inventoryFilterSearch = (input.value || '').trim().toLowerCase();
    if (clearBtn) {
        if (inventoryFilterSearch.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
    inventoryCurrentPage = 1;
    renderInventoryTable();
}

function clearInventorySearch() {
    const input = document.getElementById('inventory-search-input');
    if (input) input.value = '';
    handleInventorySearch();
}

// Manejar cambios en selectores de tipo, departamento y estado
function handleInventoryFilterChange() {
    const typeSelect = document.getElementById('inventory-type-filter');
    const deptSelect = document.getElementById('inventory-dept-filter');
    const statusSelect = document.getElementById('inventory-status-filter');

    if (typeSelect) inventoryFilterType = typeSelect.value;
    if (deptSelect) inventoryFilterDept = deptSelect.value;
    if (statusSelect) inventoryFilterStatus = statusSelect.value;

    inventoryCurrentPage = 1;
    renderInventoryTable();
}

// Filtrar por origen (Computadores vs Impresoras)
function setInventorySheetFilter(sheetName) {
    inventoryFilterSheet = sheetName;

    const btnAll = document.getElementById('btn-sheet-all');
    const btnComps = document.getElementById('btn-sheet-comps');
    const btnPrinters = document.getElementById('btn-sheet-printers');

    const activeBtnClass = "px-3 py-1 rounded-xl font-bold bg-indigo-600 text-white shadow-sm transition-all";
    const inactiveBtnClass = "px-3 py-1 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all";

    if (btnAll) btnAll.className = sheetName === 'All' ? activeBtnClass : inactiveBtnClass;
    if (btnComps) btnComps.className = sheetName === 'Computadores' ? activeBtnClass : inactiveBtnClass;
    if (btnPrinters) btnPrinters.className = sheetName === 'Impresoras-Scanner' ? activeBtnClass : inactiveBtnClass;

    inventoryCurrentPage = 1;
    renderInventoryTable();
}

// Restablecer todos los filtros
function resetInventoryFilters() {
    inventoryFilterSearch = '';
    inventoryFilterType = 'All';
    inventoryFilterDept = 'All';
    inventoryFilterStatus = 'All';
    inventoryFilterSheet = 'All';
    inventoryCurrentPage = 1;

    const searchInput = document.getElementById('inventory-search-input');
    const typeSelect = document.getElementById('inventory-type-filter');
    const deptSelect = document.getElementById('inventory-dept-filter');
    const statusSelect = document.getElementById('inventory-status-filter');
    const clearBtn = document.getElementById('inventory-search-clear');

    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (typeSelect) typeSelect.value = 'All';
    if (deptSelect) deptSelect.value = 'All';
    if (statusSelect) statusSelect.value = 'All';

    setInventorySheetFilter('All');
}

// Cambiar tamaño de página
function changeInventoryPerPage(val) {
    inventoryPerPage = val === 'all' ? 'all' : (parseInt(val, 10) || 25);
    inventoryCurrentPage = 1;
    renderInventoryTable();
}

// Navegar entre páginas
function goToInventoryPage(target) {
    if (target === 'prev') {
        if (inventoryCurrentPage > 1) inventoryCurrentPage--;
    } else if (target === 'next') {
        inventoryCurrentPage++;
    } else if (typeof target === 'number') {
        inventoryCurrentPage = target;
    }
    renderInventoryTable();
}

// Asignar equipo directamente al formulario oficial
function assignEquipmentToForm(equipmentIndex) {
    const item = loadedAllEquipments[equipmentIndex];
    if (!item) return;

    openNewForm();
    selectExcelSuggestion(equipmentIndex);
    switchTab('form-view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`Datos de ${item.funcionario || 'equipo'} (${item.serie || 'S/N'}) cargados en el formulario oficial.`, "success");
}

// Copiar número de serie al portapapeles
function copySerialToClipboard(serial) {
    if (!serial) return;
    navigator.clipboard.writeText(serial).then(() => {
        showToast(`N° Serie "${serial}" copiado al portapapeles.`, "success");
    }).catch(() => {
        showToast(`Serie: ${serial}`, "info");
    });
}

// Helper para escapar HTML en cadenas de texto
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Exportar la vista actual filtrada de inventario a Excel
function exportFilteredInventory() {
    if (!loadedAllEquipments || loadedAllEquipments.length === 0) {
        showToast("No hay datos cargados en el inventario para exportar.", "warning");
        return;
    }

    // Obtener los datos filtrados actuales
    const localCatastradosSet = new Set();
    submissions.forEach(sub => {
        if (sub.equipamiento) {
            sub.equipamiento.forEach(eq => {
                if (eq.serie) localCatastradosSet.add(String(eq.serie).trim().toLowerCase());
            });
        }
    });

    const isEqCatastrado = (e) => {
        const estadoLower = String(e.estado || '').toLowerCase();
        const isCatExcel = estadoLower.includes('catastrado');
        const isCatLocal = e.serie && localCatastradosSet.has(String(e.serie).trim().toLowerCase());
        return isCatExcel || isCatLocal;
    };

    const filtered = loadedAllEquipments.filter(e => {
        if (inventoryFilterSheet !== 'All' && e.sheet !== inventoryFilterSheet) return false;

        if (inventoryFilterType !== 'All') {
            const tLower = (e.tipo || '').toLowerCase();
            const filterLower = inventoryFilterType.toLowerCase();
            if (filterLower === 'notebook' && !tLower.includes('notebook') && !tLower.includes('laptop') && !tLower.includes('ntb')) return false;
            else if (filterLower === 'aio' && !tLower.includes('aio') && !tLower.includes('all in one') && !tLower.includes('all-in-one')) return false;
            else if (filterLower === 'pc' && !tLower.includes('pc') && !tLower.includes('desktop') && !tLower.includes('torre')) return false;
            else if (filterLower === 'impresora' && !tLower.includes('impresora') && !tLower.includes('mfp')) return false;
            else if (filterLower === 'scanner' && !tLower.includes('scanner')) return false;
            else if (filterLower === 'monitor' && !tLower.includes('monitor') && !tLower.includes('pantalla')) return false;
        }

        if (inventoryFilterDept !== 'All') {
            if ((e.depto || '').toLowerCase() !== inventoryFilterDept.toLowerCase()) return false;
        }

        if (inventoryFilterStatus !== 'All') {
            const isCat = isEqCatastrado(e);
            if (inventoryFilterStatus === 'Catastrado' && !isCat) return false;
            if (inventoryFilterStatus === 'Pendiente' && isCat) return false;
            if (inventoryFilterStatus === 'Operativo' && !(e.estado || '').toLowerCase().includes('operativo')) return false;
        }

        if (inventoryFilterSearch) {
            const search = inventoryFilterSearch;
            const matchFunc = (e.funcionario || '').toLowerCase().includes(search);
            const matchSerie = (e.serie || '').toLowerCase().includes(search);
            const matchInv = (e.inventario || '').toLowerCase().includes(search);
            const matchMail = (e.mail || '').toLowerCase().includes(search);
            const matchDepto = (e.depto || '').toLowerCase().includes(search);
            const matchMarca = (e.marca || '').toLowerCase().includes(search);
            const matchModelo = (e.modelo || '').toLowerCase().includes(search);
            const matchTipo = (e.tipo || '').toLowerCase().includes(search);
            const matchContrato = e._originalRow && (e._originalRow['Contrato Arriendo'] || '').toLowerCase().includes(search);
            const matchCod = e._originalRow && (e._originalRow['Código Arriendo'] || '').toLowerCase().includes(search);
            const matchIP = e._originalRow && (e._originalRow['Dirección IP'] || '').toLowerCase().includes(search);
            const matchSubDepto = e._originalRow && (e._originalRow['Subdepartamento'] || '').toLowerCase().includes(search);
            if (!matchFunc && !matchSerie && !matchInv && !matchMail && !matchDepto && !matchMarca && !matchModelo && !matchTipo && !matchContrato && !matchCod && !matchIP && !matchSubDepto) {
                return false;
            }
        }
        return true;
    });

    if (filtered.length === 0) {
        showToast("No hay registros que coincidan con los filtros para exportar.", "warning");
        return;
    }

    const rows = filtered.map((e, idx) => {
        const isCat = isEqCatastrado(e);
        return {
            'N°': idx + 1,
            'Hoja / Origen': e.sheet,
            'Funcionario(a)': e.funcionario || 'Sin asignar',
            'Correo': e.mail || '',
            'Unidad / Departamento': e.depto || '',
            'Tipo Equipo': e.tipo || '',
            'Marca': e.marca || '',
            'Modelo': e.modelo || '',
            'N° Serie': e.serie || '',
            'N° Inventario / Código': e.inventario || (e._originalRow && e._originalRow['Código Arriendo']) || '',
            'Propiedad': e.propiedad || '',
            'Contrato': (e._originalRow && e._originalRow['Contrato Arriendo']) || '',
            'Estado Catastro': isCat ? 'CATASTRADO' : (e.estado || 'SIN REGISTRO'),
            'Observaciones': e.observaciones || ''
        };
    });

    try {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Inventario_Catastro');
        XLSX.writeFile(wb, `Catastro_ISP_2025_Filtrado_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast(`Exportados ${filtered.length} equipos a archivo Excel.`, "success");
    } catch (err) {
        console.error("Error al exportar inventario:", err);
        showToast("Error al generar archivo Excel.", "error");
    }
}

// Renderizar la tabla y tarjetas completas del Módulo de Inventario de Catastro
function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table-body');
    const mobileContainer = document.getElementById('inventory-mobile-cards');
    const emptyState = document.getElementById('inventory-empty-state');
    const paginationBar = document.getElementById('inventory-pagination-bar');

    if (!tbody && !mobileContainer) return;

    // 1. Obtener conjunto de series catastradas localmente
    const localCatastradosSet = new Set();
    submissions.forEach(sub => {
        if (sub.equipamiento) {
            sub.equipamiento.forEach(eq => {
                if (eq.serie) localCatastradosSet.add(String(eq.serie).trim().toLowerCase());
            });
        }
    });

    const isEqCatastrado = (e) => {
        const estadoLower = String(e.estado || '').toLowerCase();
        const isCatExcel = estadoLower.includes('catastrado');
        const isCatLocal = e.serie && localCatastradosSet.has(String(e.serie).trim().toLowerCase());
        return isCatExcel || isCatLocal;
    };

    // 2. Actualizar contadores superiores de KPI
    const totalComps = loadedAllEquipments.filter(e => e.sheet === 'Computadores').length;
    const totalPrinters = loadedAllEquipments.filter(e => e.sheet === 'Impresoras-Scanner').length;
    const totalCatastrados = loadedAllEquipments.filter(e => isEqCatastrado(e)).length;

    const elCountTotal = document.getElementById('inv-count-total');
    const elCountComps = document.getElementById('inv-count-comps');
    const elCountPrinters = document.getElementById('inv-count-printers');
    const elCountCat = document.getElementById('inv-count-catastrados');

    if (elCountTotal) elCountTotal.innerText = loadedAllEquipments.length;
    if (elCountComps) elCountComps.innerText = totalComps;
    if (elCountPrinters) elCountPrinters.innerText = totalPrinters;
    if (elCountCat) elCountCat.innerText = totalCatastrados;

    const chipAll = document.getElementById('count-chip-all');
    const chipComps = document.getElementById('count-chip-comps');
    const chipPrinters = document.getElementById('count-chip-printers');
    if (chipAll) chipAll.innerText = loadedAllEquipments.length;
    if (chipComps) chipComps.innerText = totalComps;
    if (chipPrinters) chipPrinters.innerText = totalPrinters;

    // 3. Aplicar filtros a loadedAllEquipments
    const filteredWithIndex = [];
    for (let i = 0; i < loadedAllEquipments.length; i++) {
        const e = loadedAllEquipments[i];

        // Filtro por hoja de origen
        if (inventoryFilterSheet !== 'All' && e.sheet !== inventoryFilterSheet) {
            continue;
        }

        // Filtro por tipo de equipo
        if (inventoryFilterType !== 'All') {
            const tLower = (e.tipo || '').toLowerCase();
            const filterLower = inventoryFilterType.toLowerCase();
            if (filterLower === 'notebook' && !tLower.includes('notebook') && !tLower.includes('laptop') && !tLower.includes('ntb')) continue;
            else if (filterLower === 'aio' && !tLower.includes('aio') && !tLower.includes('all in one') && !tLower.includes('all-in-one')) continue;
            else if (filterLower === 'pc' && !tLower.includes('pc') && !tLower.includes('desktop') && !tLower.includes('torre')) continue;
            else if (filterLower === 'impresora' && !tLower.includes('impresora') && !tLower.includes('mfp')) continue;
            else if (filterLower === 'scanner' && !tLower.includes('scanner')) continue;
            else if (filterLower === 'monitor' && !tLower.includes('monitor') && !tLower.includes('pantalla')) continue;
        }

        // Filtro por departamento
        if (inventoryFilterDept !== 'All') {
            if ((e.depto || '').toLowerCase() !== inventoryFilterDept.toLowerCase()) {
                continue;
            }
        }

        // Filtro por estado
        if (inventoryFilterStatus !== 'All') {
            const isCat = isEqCatastrado(e);
            if (inventoryFilterStatus === 'Catastrado' && !isCat) continue;
            if (inventoryFilterStatus === 'Pendiente' && isCat) continue;
            if (inventoryFilterStatus === 'Operativo' && !(e.estado || '').toLowerCase().includes('operativo')) continue;
        }

        // Filtro por búsqueda de texto
        if (inventoryFilterSearch) {
            const search = inventoryFilterSearch;
            const matchFunc = (e.funcionario || '').toLowerCase().includes(search);
            const matchSerie = (e.serie || '').toLowerCase().includes(search);
            const matchInv = (e.inventario || '').toLowerCase().includes(search);
            const matchMail = (e.mail || '').toLowerCase().includes(search);
            const matchDepto = (e.depto || '').toLowerCase().includes(search);
            const matchMarca = (e.marca || '').toLowerCase().includes(search);
            const matchModelo = (e.modelo || '').toLowerCase().includes(search);
            const matchTipo = (e.tipo || '').toLowerCase().includes(search);
            const matchContrato = e._originalRow && (e._originalRow['Contrato Arriendo'] || '').toLowerCase().includes(search);
            const matchCod = e._originalRow && (e._originalRow['Código Arriendo'] || '').toLowerCase().includes(search);
            const matchIP = e._originalRow && (e._originalRow['Dirección IP'] || '').toLowerCase().includes(search);
            const matchSubDepto = e._originalRow && (e._originalRow['Subdepartamento'] || '').toLowerCase().includes(search);
            if (!matchFunc && !matchSerie && !matchInv && !matchMail && !matchDepto && !matchMarca && !matchModelo && !matchTipo && !matchContrato && !matchCod && !matchIP && !matchSubDepto) {
                continue;
            }
        }

        filteredWithIndex.push({ originalIndex: i, item: e });
    }

    // 4. Manejo de estado vacío
    if (filteredWithIndex.length === 0) {
        if (tbody) tbody.innerHTML = '';
        if (mobileContainer) mobileContainer.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        if (paginationBar) paginationBar.classList.add('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (paginationBar) paginationBar.classList.remove('hidden');

    // 5. Calcular paginación
    const totalItems = filteredWithIndex.length;
    const pageSize = inventoryPerPage === 'all' ? totalItems : inventoryPerPage;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    if (inventoryCurrentPage > totalPages) inventoryCurrentPage = totalPages;
    if (inventoryCurrentPage < 1) inventoryCurrentPage = 1;

    const startIndex = (inventoryCurrentPage - 1) * pageSize;
    const endIndex = Math.min(totalItems, startIndex + pageSize);
    const currentPageItems = filteredWithIndex.slice(startIndex, endIndex);

    // 6. Renderizar tabla de escritorio
    if (tbody) {
        tbody.innerHTML = '';
        currentPageItems.forEach((entry, rowIdx) => {
            const item = entry.item;
            const origIdx = entry.originalIndex;
            const globalNumber = startIndex + rowIdx + 1;
            const isCat = isEqCatastrado(item);

            // Badge Tipo
            const tLower = (item.tipo || '').toLowerCase();
            let typeBadgeClass = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
            if (tLower.includes('notebook') || tLower.includes('laptop')) {
                typeBadgeClass = 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border border-blue-200/50';
            } else if (tLower.includes('aio') || tLower.includes('all in one')) {
                typeBadgeClass = 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 border border-indigo-200/50';
            } else if (tLower.includes('pc') || tLower.includes('desktop')) {
                typeBadgeClass = 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-400 border border-cyan-200/50';
            } else if (tLower.includes('impresora')) {
                typeBadgeClass = 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400 border border-violet-200/50';
            } else if (tLower.includes('scanner')) {
                typeBadgeClass = 'bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-400 border border-fuchsia-200/50';
            } else if (tLower.includes('pantalla') || tLower.includes('monitor')) {
                typeBadgeClass = 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200/50';
            }

            // Badge Estado
            let statusBadge = '';
            if (isCat) {
                statusBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>Catastrado</span>';
            } else if ((item.estado || '').toLowerCase().includes('operativo')) {
                statusBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400 border border-sky-200/50"><span class="w-1.5 h-1.5 rounded-full bg-sky-500"></span>Operativo</span>';
            } else {
                statusBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200/50"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Pendiente</span>';
            }

            const codigoInv = item.inventario || (item._originalRow && item._originalRow['Código Arriendo']) || '—';
            const contratoInfo = (item._originalRow && item._originalRow['Contrato Arriendo']) || item.propiedad || 'Arriendo';
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-100 dark:border-slate-800/60";
            tr.innerHTML = `
                <td class="py-3 px-4 font-mono text-slate-400 text-center">${globalNumber}</td>
                <td class="py-3 px-4">
                    <div class="font-bold text-slate-900 dark:text-slate-100 text-xs">${escapeHtml(item.funcionario || 'Sin Funcionario Asignado')}</div>
                    <div class="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <span class="truncate max-w-[180px]" title="${escapeHtml(item.depto || '')}">${escapeHtml(item.depto || 'Sin Depto')}</span>
                        ${item.mail ? `<span class="text-indigo-400">• ${escapeHtml(item.mail)}</span>` : ''}
                    </div>
                </td>
                <td class="py-3 px-4">
                    <span class="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${typeBadgeClass}">${escapeHtml(item.tipo || 'Equipo')}</span>
                    <div class="text-slate-500 dark:text-slate-400 font-medium text-[11px] mt-0.5">${escapeHtml(item.marca || '')} ${escapeHtml(item.modelo || '')}</div>
                </td>
                <td class="py-3 px-4">
                    <div class="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
                        <span class="font-mono font-bold text-slate-800 dark:text-slate-200 text-xs">${escapeHtml(item.serie || 'S/N')}</span>
                        ${item.serie ? `<button type="button" onclick="copySerialToClipboard('${escapeHtml(item.serie)}')" class="text-slate-400 hover:text-indigo-600 transition-colors" title="Copiar Serie"><i data-lucide="copy" class="w-3 h-3"></i></button>` : ''}
                    </div>
                </td>
                <td class="py-3 px-4 font-mono text-slate-600 dark:text-slate-400 text-xs">${escapeHtml(codigoInv)}</td>
                <td class="py-3 px-4">
                    <span class="text-xs text-slate-700 dark:text-slate-300 font-medium truncate block max-w-[160px]" title="${escapeHtml(contratoInfo)}">${escapeHtml(contratoInfo)}</span>
                </td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-center">
                    <button type="button" onclick="assignEquipmentToForm(${origIdx})" class="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] inline-flex items-center gap-1 shadow-sm transition-all hover:scale-105 active:scale-95" title="Asignar y Cargar en el Formulario Oficial">
                        <i data-lucide="file-signature" class="w-3.5 h-3.5"></i>
                        <span>Asignar</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // 7. Renderizar tarjetas móviles
    if (mobileContainer) {
        mobileContainer.innerHTML = '';
        currentPageItems.forEach((entry, rowIdx) => {
            const item = entry.item;
            const origIdx = entry.originalIndex;
            const globalNumber = startIndex + rowIdx + 1;
            const isCat = isEqCatastrado(item);

            const card = document.createElement('div');
            card.className = "p-4 space-y-2.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-100 dark:border-slate-800/60";
            card.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div class="space-y-0.5 min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-[10px] font-mono text-slate-400">#${globalNumber}</span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">${escapeHtml(item.tipo || 'Equipo')}</span>
                            ${isCat
                    ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400">Catastrado</span>'
                    : '<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400">Pendiente</span>'
                }
                        </div>
                        <h4 class="font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight truncate mt-1">${escapeHtml(item.funcionario || 'Sin Funcionario')}</h4>
                        <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate">${escapeHtml(item.depto || 'Sin Departamento')} ${item.mail ? `• ${escapeHtml(item.mail)}` : ''}</p>
                    </div>
                    <button type="button" onclick="assignEquipmentToForm(${origIdx})" class="shrink-0 px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold text-xs inline-flex items-center gap-1 shadow-sm">
                        <i data-lucide="file-signature" class="w-3.5 h-3.5"></i>
                        <span>Asignar</span>
                    </button>
                </div>
                <div class="pt-2 border-t border-slate-100 dark:border-slate-800/50 flex items-center justify-between text-xs font-mono">
                    <span class="text-slate-600 dark:text-slate-300 font-bold">S/N: ${escapeHtml(item.serie || 'S/N')}</span>
                    <span class="text-slate-400 text-[11px]">${escapeHtml(item.marca || '')} ${escapeHtml(item.modelo || '')}</span>
                </div>
            `;
            mobileContainer.appendChild(card);
        });
    }

    // 8. Actualizar barra de paginación
    const countSummary = document.getElementById('inventory-count-summary');
    if (countSummary) {
        countSummary.innerText = `Mostrando ${startIndex + 1} - ${endIndex} de ${totalItems} equipos`;
    }

    const prevBtn = document.getElementById('inventory-prev-btn');
    const nextBtn = document.getElementById('inventory-next-btn');
    if (prevBtn) prevBtn.disabled = inventoryCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = inventoryCurrentPage >= totalPages;

    const pageNumbersContainer = document.getElementById('inventory-page-numbers');
    if (pageNumbersContainer) {
        pageNumbersContainer.innerHTML = '';

        // Generar botones de páginas numéricas inteligentes (con elipsis)
        const maxButtons = 5;
        let startPage = Math.max(1, inventoryCurrentPage - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);

        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        if (startPage > 1) {
            const btn1 = document.createElement('button');
            btn1.className = "w-8 h-8 rounded-xl font-semibold text-xs transition-all text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";
            btn1.innerText = "1";
            btn1.onclick = () => goToInventoryPage(1);
            pageNumbersContainer.appendChild(btn1);

            if (startPage > 2) {
                const dots = document.createElement('span');
                dots.className = "px-1 text-slate-400";
                dots.innerText = "...";
                pageNumbersContainer.appendChild(dots);
            }
        }

        for (let p = startPage; p <= endPage; p++) {
            const btn = document.createElement('button');
            if (p === inventoryCurrentPage) {
                btn.className = "w-8 h-8 rounded-xl font-bold text-xs bg-indigo-600 text-white shadow-sm";
            } else {
                btn.className = "w-8 h-8 rounded-xl font-semibold text-xs transition-all text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";
            }
            btn.innerText = p;
            btn.onclick = () => goToInventoryPage(p);
            pageNumbersContainer.appendChild(btn);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const dots = document.createElement('span');
                dots.className = "px-1 text-slate-400";
                dots.innerText = "...";
                pageNumbersContainer.appendChild(dots);
            }
            const btnLast = document.createElement('button');
            btnLast.className = "w-8 h-8 rounded-xl font-semibold text-xs transition-all text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";
            btnLast.innerText = totalPages;
            btnLast.onclick = () => goToInventoryPage(totalPages);
            pageNumbersContainer.appendChild(btnLast);
        }
    }

    lucide.createIcons();
}

// ================= INTEGRACIÓN NATIVA CON ELECTRON =================
if (window.electronAPI) {
    console.log('⚡ Entorno de escritorio Electron detectado.');

    // Escuchar atajo de teclado o menú nativo para Imprimir
    window.electronAPI.onTriggerPrint(() => {
        triggerPrintMode();
    });

    // Escuchar atajo o menú para Exportar a PDF directamente
    window.electronAPI.onTriggerExportPdf(async () => {
        try {
            syncPrintTemplate();
            const rut = document.getElementById('rut_receptor')?.value || 'ACTA';
            const folio = document.getElementById('ticket_ot')?.value || 'TIC';
            const defaultName = `Acta_TIC_${folio}_${rut}.pdf`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

            showToast('Generando archivo PDF nativo...', 'info');
            const result = await window.electronAPI.savePdf(defaultName);
            if (result.success) {
                showToast(`Acta guardada exitosamente en: ${result.filePath}`, 'success');
            }
        } catch (e) {
            console.error('Error al exportar PDF nativo:', e);
            showToast('Error al generar PDF: ' + e.message, 'error');
        }
    });

    // Escuchar menú nativo para Acerca de / Novedades
    if (typeof window.electronAPI.onTriggerOpenAbout === 'function') {
        window.electronAPI.onTriggerOpenAbout(() => {
            openSystemInfoModal();
        });
    }

    // Escuchar menú nativo para Comprobar Actualizaciones
    if (typeof window.electronAPI.onTriggerCheckUpdate === 'function') {
        window.electronAPI.onTriggerCheckUpdate(() => {
            clearCacheAndReload();
        });
    }
}

// ================= MODAL DE INFORMACIÓN Y NOVEDADES =================
function openSystemInfoModal() {
    const modal = document.getElementById('system-info-modal');
    if (modal) {
        modal.classList.remove('hidden');
        lucide.createIcons();
    }
}

function closeSystemInfoModal() {
    const modal = document.getElementById('system-info-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}
