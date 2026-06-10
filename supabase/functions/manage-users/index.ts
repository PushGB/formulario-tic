import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // 1. Verificar que el llamante está autenticado y es ADMIN
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'No autorizado: se requiere token de sesión.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userToken = authHeader.replace('Bearer ', '');

    // Cliente con el token del usuario (para verificar su identidad)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Token de sesión inválido o expirado.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verificar rol admin en user_roles (server-side, seguro)
    const { data: roleData, error: roleError } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData || roleData.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Acceso denegado: solo administradores pueden gestionar usuarios.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Cliente admin con service_role (solo existe en el servidor)
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3. Procesar la acción solicitada
    const body = await req.json();
    const { action, email, password, role } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: 'Parámetro "action" requerido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- ACCIÓN: crear usuario ----
    if (action === 'create') {
      if (!email || !password || !role) {
        return new Response(JSON.stringify({ error: 'Se requieren email, password y role.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!['admin', 'tecnico'].includes(role)) {
        return new Response(JSON.stringify({ error: 'Rol inválido. Debe ser "admin" o "tecnico".' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password,
        email_confirm: true,
        user_metadata: { role },
      });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Insertar en user_roles explícitamente (por si el trigger falla)
      const { error: roleInsertError } = await adminClient
        .from('user_roles')
        .upsert({
          user_id: newUser.user.id,
          email: email.toLowerCase().trim(),
          role,
        }, { onConflict: 'user_id' });

      if (roleInsertError) {
        console.error('Advertencia: usuario creado pero error al insertar rol:', roleInsertError.message);
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Usuario ${email} creado con rol ${role}.`,
        user_id: newUser.user.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- ACCIÓN: eliminar usuario ----
    if (action === 'delete') {
      if (!email) {
        return new Response(JSON.stringify({ error: 'Se requiere email.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // No permitir auto-eliminación
      if (email.toLowerCase() === user.email?.toLowerCase()) {
        return new Response(JSON.stringify({ error: 'No puedes eliminar tu propia cuenta.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Buscar user_id por email en user_roles
      const { data: targetRole } = await adminClient
        .from('user_roles')
        .select('user_id, role')
        .eq('email', email.toLowerCase())
        .single();

      if (!targetRole) {
        return new Response(JSON.stringify({ error: 'Usuario no encontrado.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Proteger: no eliminar el último admin
      if (targetRole.role === 'admin') {
        const { count } = await adminClient
          .from('user_roles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin');

        if ((count ?? 0) <= 1) {
          return new Response(JSON.stringify({ error: 'No se puede eliminar el único administrador del sistema.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetRole.user_id);
      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // El CASCADE en user_roles borra el registro automáticamente
      return new Response(JSON.stringify({
        success: true,
        message: `Usuario ${email} eliminado.`,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- ACCIÓN: cambiar contraseña ----
    if (action === 'update-password') {
      if (!email || !password) {
        return new Response(JSON.stringify({ error: 'Se requieren email y password.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: targetRole } = await adminClient
        .from('user_roles')
        .select('user_id')
        .eq('email', email.toLowerCase())
        .single();

      if (!targetRole) {
        return new Response(JSON.stringify({ error: 'Usuario no encontrado.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        targetRole.user_id,
        { password }
      );

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Contraseña actualizada para ${email}.`,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---- ACCIÓN: listar usuarios ----
    if (action === 'list') {
      const { data: users, error: listError } = await adminClient
        .from('user_roles')
        .select('email, role, created_at')
        .order('created_at', { ascending: true });

      if (listError) {
        return new Response(JSON.stringify({ error: listError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, users }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Acción desconocida: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Error en manage-users:', err);
    return new Response(JSON.stringify({ error: 'Error interno del servidor.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
