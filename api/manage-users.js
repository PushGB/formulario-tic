// api/manage-users.js — Vercel Serverless Function
// La SUPABASE_SERVICE_ROLE_KEY SOLO existe aqui (server-side).
// NUNCA se expone al frontend.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY    = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // SIN prefijo VITE_ = solo server

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('Variables de entorno faltantes:', { SUPABASE_URL: !!SUPABASE_URL, SERVICE_KEY: !!SERVICE_KEY, ANON_KEY: !!ANON_KEY });
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' });
  }

  try {
    // 1. Verificar sesión del llamante
    const authHeader = req.headers['authorization'] || '';
    const userToken = authHeader.replace('Bearer ', '').trim();

    if (!userToken) {
      return res.status(401).json({ error: 'No autorizado: se requiere sesión activa.' });
    }

    // Cliente con el JWT del usuario (verifica identidad)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return res.status(401).json({ error: 'Token de sesión inválido o expirado.' });
    }

    // 2. Verificar que el llamante tiene rol 'admin' (server-side)
    const { data: roleData, error: roleError } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData || roleData.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado: solo administradores.' });
    }

    // 3. Cliente con service_role — tiene permisos totales (solo existe aquí)
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { action, email, password, role } = req.body;

    // ── LISTAR USUARIOS ──────────────────────────────────────
    if (action === 'list') {
      const { data: users, error } = await adminClient
        .from('user_roles')
        .select('email, role, created_at')
        .order('created_at', { ascending: true });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, users });
    }

    // ── CREAR USUARIO ─────────────────────────────────────────
    if (action === 'create') {
      if (!email || !password || !role) {
        return res.status(400).json({ error: 'Se requieren email, password y role.' });
      }
      if (!['admin', 'tecnico'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido. Debe ser "admin" o "tecnico".' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password,
        email_confirm: true,
        user_metadata: { role },
      });

      if (createError) return res.status(400).json({ error: createError.message });

      // Upsert en user_roles (respaldo por si el trigger no lo hace)
      await adminClient.from('user_roles').upsert({
        user_id: newUser.user.id,
        email: email.toLowerCase().trim(),
        role,
      }, { onConflict: 'user_id' });

      return res.status(200).json({
        success: true,
        message: `Usuario ${email} creado con rol ${role}.`,
        user_id: newUser.user.id,
      });
    }

    // ── ELIMINAR USUARIO ──────────────────────────────────────
    if (action === 'delete') {
      if (!email) return res.status(400).json({ error: 'Se requiere email.' });

      if (email.toLowerCase() === user.email?.toLowerCase()) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
      }

      const { data: target } = await adminClient
        .from('user_roles')
        .select('user_id, role')
        .eq('email', email.toLowerCase())
        .single();

      if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

      // Proteger último admin
      if (target.role === 'admin') {
        const { count } = await adminClient
          .from('user_roles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin');
        if ((count ?? 0) <= 1) {
          return res.status(400).json({ error: 'No se puede eliminar el único administrador.' });
        }
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(target.user_id);
      if (deleteError) return res.status(400).json({ error: deleteError.message });

      return res.status(200).json({ success: true, message: `Usuario ${email} eliminado.` });
    }

    // ── CAMBIAR CONTRASEÑA ────────────────────────────────────
    if (action === 'update-password') {
      if (!email || !password) return res.status(400).json({ error: 'Se requieren email y password.' });
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

      const { data: target } = await adminClient
        .from('user_roles')
        .select('user_id')
        .eq('email', email.toLowerCase())
        .single();

      if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });

      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        target.user_id, { password }
      );

      if (updateError) return res.status(400).json({ error: updateError.message });
      return res.status(200).json({ success: true, message: `Contraseña actualizada para ${email}.` });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });

  } catch (err) {
    console.error('Error en /api/manage-users:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
