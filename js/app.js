// ================= CONTROL DE VERSIONES Y ACTUALIZACIÓN AUTOMÁTICA =================
const APP_VERSION = '5.4.0';
const APP_BUILD_TIMESTAMP = '20260826_1030';

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
function checkAppVersion() {
    const lastVersion = localStorage.getItem('tic_installed_app_version');
    
    // Si la versión guardada es diferente a la versión del código actual
    if (lastVersion && lastVersion !== APP_VERSION) {
        showUpdateBanner(APP_VERSION);
        showToast(`Sistema actualizado a la versión v${APP_VERSION}.`, "info");
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

// Limpiar caché y recargar forzosamente la aplicación
async function clearCacheAndReload() {
    showToast("Limpiando memoria caché y recargando el sistema...", "info");

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
    }, 400);
}

// Alias para el botón del banner de actualización
function forceAppUpdate() {
    clearCacheAndReload();
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

    if (currentUserRole === 'admin') {
        if (roleText) roleText.innerText = 'Modo Admin';
        if (drawerRoleLabel) drawerRoleLabel.innerText = 'Admin (Activo)';
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
    } else if (currentUserRole === 'tecnico') {
        if (roleText) roleText.innerText = 'Modo Técnico';
        if (drawerRoleLabel) drawerRoleLabel.innerText = 'Técnico (Activo)';
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
    } else {
        // Modo Funcionario / Público
        if (roleText) roleText.innerText = 'Iniciar Sesión TIC';
        if (drawerRoleLabel) drawerRoleLabel.innerText = 'Iniciar Sesión TIC';
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

        // Modo Funcionario siempre muestra exclusivamente el formulario limpio
        switchTab('form-view');
    }

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
            showToast("Registro actualizado exitosamente.", "success");
        }
    } else {
        // Crear Nuevo Registro
        submissions.unshift(submissionData);
        showToast("Nuevo registro guardado de manera digital.", "success");
    }

    saveSubmissionsToStorage();
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
                            <button onclick="deleteSubmission('${s.id}')" class="p-2 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors" title="Eliminar Registro">
                                <i data-lucide="trash-2" class="w-4.5 h-4.5"></i>
                            </button>
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
    document.getElementById('m-btn-delete').onclick = () => {
        closeMobileActions();
        deleteSubmission(id);
    };

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

// Eliminar Registro con modal moderno
async function deleteSubmission(id) {
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
        renderTable();
        showToast("Registro eliminado del historial.", "success");
    }
}

// Limpiar Base de Datos completa
async function clearAllSubmissions() {
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

// Restaurar copia de seguridad desde un archivo JSON
function importBackupJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
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

// Trigger del modo impresión con guía preventiva
function triggerPrintMode() {
    const hideGuide = localStorage.getItem('isp_hide_print_guide') === 'true';
    if (hideGuide) {
        proceedToPrint();
    } else {
        const modal = document.getElementById('print-guide-modal');
        if (modal) modal.classList.remove('hidden');
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
    
    // 3. Procesar todas las hojas (Equipos, Computadores e Impresoras) para generar las solicitudes/formularios de cada funcionario
    const grouped = {};
    
    // A. Primero incorporar datos de la hoja 'Equipos' (si contiene RUT, Cargo y Departamento)
    const equiposSheet = uploadedWorkbook.Sheets['Equipos'];
    if (equiposSheet) {
        const rawEquipos = XLSX.utils.sheet_to_json(equiposSheet);
        rawEquipos.forEach(item => {
            const nombre = item['Nombre Funcionario'] || item['Nombre'];
            const serie = item['Serie'] || item['N° Serie'];
            if (!nombre || String(nombre).trim().length === 0) return;
            const key = String(nombre).trim().toLowerCase();
            if (!grouped[key]) {
                grouped[key] = {
                    nombre: String(nombre).trim(),
                    rut: String(item['Rut'] || item['RUT'] || '').trim(),
                    cargo: String(item['Cargo'] || '').trim(),
                    depto: String(item['Departamento'] || item['Unidad'] || '').trim(),
                    propiedad: item['EsInventario'] === true || String(item['EsInventario']).toLowerCase() === 'true' ? 'Propiedad ISP' : 'En Arriendo',
                    equipos: []
                };
            }
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
                    if (!grouped[key].equipos.some(e => e.serie && e.serie.toLowerCase() === eq.serie.toLowerCase())) {
                        grouped[key].equipos.push(eq);
                    }
                });
            }
        });
    }

    // B. Procesar e incorporar todos los Computadores
    computers.forEach(item => {
        const nombre = item.funcionario;
        if (!nombre || String(nombre).trim().length === 0) return;
        const key = String(nombre).trim().toLowerCase();
        if (!grouped[key]) {
            grouped[key] = {
                nombre: String(nombre).trim(),
                rut: '',
                cargo: '',
                depto: String(item.depto || '').trim(),
                propiedad: (item.propiedad || '').toLowerCase().includes('arriendo') ? 'En Arriendo' : 'Propiedad ISP',
                equipos: []
            };
        } else {
            if (!grouped[key].depto && item.depto) grouped[key].depto = String(item.depto).trim();
        }
        if (item.serie && String(item.serie).trim().length > 0) {
            const rawEq = {
                tipo: item.tipo || 'Computador',
                marca: item.marca || 'Lenovo',
                modelo: item.modelo || (item._originalRow && item._originalRow['Código Arriendo'] ? item._originalRow['Código Arriendo'] : ''),
                serie: String(item.serie).trim(),
                inventario: String(item.inventario || (item._originalRow && item._originalRow['Código Arriendo'] ? item._originalRow['Código Arriendo'] : '')).trim(),
                observacion: String(item.observaciones || '').trim()
            };
            const splitEqs = splitEquipmentIfCombined(rawEq);
            splitEqs.forEach(eq => {
                if (!grouped[key].equipos.some(e => e.serie && e.serie.toLowerCase() === eq.serie.toLowerCase())) {
                    grouped[key].equipos.push(eq);
                }
            });
        }
    });

    // C. Procesar e incorporar todas las Impresoras
    printers.forEach(item => {
        const nombre = item.funcionario;
        if (!nombre || String(nombre).trim().length === 0) return;
        const key = String(nombre).trim().toLowerCase();
        if (!grouped[key]) {
            grouped[key] = {
                nombre: String(nombre).trim(),
                rut: '',
                cargo: '',
                depto: String(item.depto || '').trim(),
                propiedad: (item.propiedad || '').toLowerCase().includes('arriendo') ? 'En Arriendo' : 'Propiedad ISP',
                equipos: []
            };
        }
        if (item.serie && String(item.serie).trim().length > 0) {
            const rawEq = {
                tipo: item.tipo || 'Impresora',
                marca: item.marca || 'Brother',
                modelo: item.modelo || '',
                serie: String(item.serie).trim(),
                inventario: String(item.inventario || '').trim(),
                observacion: String(item.observaciones || '').trim()
            };
            const splitEqs = splitEquipmentIfCombined(rawEq);
            splitEqs.forEach(eq => {
                if (!grouped[key].equipos.some(e => e.serie && e.serie.toLowerCase() === eq.serie.toLowerCase())) {
                    grouped[key].equipos.push(eq);
                }
            });
        }
    });

    let importedCount = 0;
    Object.keys(grouped).forEach(key => {
        const group = grouped[key];
        const subId = 'sub_excel_' + key.replace(/[^a-z0-9]/g, '_');
        
        // Si ya existe la solicitud, actualizar equipamiento si faltaba
        const existingIdx = submissions.findIndex(s => s.id === subId);
        if (existingIdx !== -1) {
            if (!submissions[existingIdx].equipamiento || submissions[existingIdx].equipamiento.length === 0) {
                submissions[existingIdx].equipamiento = group.equipos;
            }
            if (!submissions[existingIdx].funcionario.depto && group.depto) {
                submissions[existingIdx].funcionario.depto = group.depto;
            }
            return;
        }
        
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
            const tipoLower = (eq.tipo || '').toLowerCase();
            
            if (tipoLower === 'pc' || tipoLower.includes('desktop') || tipoLower.includes('computador') || tipoLower.includes('torre')) {
                if (!sub.equipamiento_categorias.includes('PC')) sub.equipamiento_categorias.push('PC');
            }
            if (tipoLower.includes('notebook') || tipoLower.includes('laptop')) {
                if (!sub.equipamiento_categorias.includes('Notebook')) sub.equipamiento_categorias.push('Notebook');
            }
            if (tipoLower.includes('aio') || tipoLower.includes('all in one') || tipoLower.includes('all-in-one')) {
                if (!sub.equipamiento_categorias.includes('All In One')) sub.equipamiento_categorias.push('All In One');
            }
            if (tipoLower.includes('pantalla') || tipoLower.includes('monitor') || tipoLower.includes('display')) {
                if (!sub.equipamiento_categorias.includes('Monitor')) sub.equipamiento_categorias.push('Monitor');
            }
            if (tipoLower.includes('celular') || tipoLower.includes('movil') || tipoLower.includes('smartphone')) {
                if (!sub.equipamiento_categorias.includes('Celular')) sub.equipamiento_categorias.push('Celular');
            }
            if (tipoLower.includes('telefono')) {
                if (!sub.equipamiento_categorias.includes('Telefono IP')) sub.equipamiento_categorias.push('Telefono IP');
            }
            if (tipoLower.includes('simcard') || tipoLower.includes('chip')) {
                if (!sub.equipamiento_categorias.includes('SIMCARD')) sub.equipamiento_categorias.push('SIMCARD');
            }
            if (tipoLower.includes('bam') || tipoLower.includes('modem')) {
                if (!sub.equipamiento_categorias.includes('BAM')) sub.equipamiento_categorias.push('BAM');
            }
            if (tipoLower.includes('impresora') || tipoLower.includes('scanner') || tipoLower.includes('mfp')) {
                if (!sub.equipamiento_categorias.includes('Impresora')) sub.equipamiento_categorias.push('Impresora');
            }
        });
        
        submissions.push(sub);
        importedCount++;
    });
    
    if (importedCount > 0) {
        saveSubmissionsToStorage();
        renderTable();
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

