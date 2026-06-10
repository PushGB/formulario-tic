-- =======================================================================
-- PATCH DE SEGURIDAD — FORMULARIO TIC
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- =======================================================================

-- -----------------------------------------------------------------------
-- 1. CORREGIR TRIGGER DE ROLES
--    Antes: asignaba 'admin' si el email contenía 'admin' (inseguro)
--    Ahora: lee el rol desde user_metadata.role (seteado al crear usuario)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'tecnico')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- -----------------------------------------------------------------------
-- 2. RLS PARA solicitudes_tic — Por rol de usuario
--    Antes: acceso total incluyendo anon (sin autenticación)
--    Ahora: requiere autenticación; técnicos solo leen/crean, admins todo
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Acceso total solicitudes" ON public.solicitudes_tic;

-- Todos los autenticados pueden leer solicitudes
CREATE POLICY "Autenticados: leer solicitudes"
  ON public.solicitudes_tic
  FOR SELECT
  TO authenticated
  USING (true);

-- Todos los autenticados pueden crear solicitudes
CREATE POLICY "Autenticados: crear solicitudes"
  ON public.solicitudes_tic
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Solo admins pueden editar solicitudes
CREATE POLICY "Solo admins: editar solicitudes"
  ON public.solicitudes_tic
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Solo admins pueden eliminar solicitudes
CREATE POLICY "Solo admins: eliminar solicitudes"
  ON public.solicitudes_tic
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- -----------------------------------------------------------------------
-- 3. RLS PARA catastro_equipos — Técnicos solo leen, admins escriben
--    Antes: acceso total incluyendo anon
--    Ahora: requiere autenticación; admins gestionan el catastro
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Acceso total catastro" ON public.catastro_equipos;

-- Todos los autenticados pueden leer catastro
CREATE POLICY "Autenticados: leer catastro"
  ON public.catastro_equipos
  FOR SELECT
  TO authenticated
  USING (true);

-- Solo admins pueden insertar en catastro
CREATE POLICY "Solo admins: insertar catastro"
  ON public.catastro_equipos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Solo admins pueden editar catastro
CREATE POLICY "Solo admins: editar catastro"
  ON public.catastro_equipos
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Solo admins pueden eliminar del catastro
CREATE POLICY "Solo admins: eliminar catastro"
  ON public.catastro_equipos
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- -----------------------------------------------------------------------
-- 4. REVOCAR ACCESO ANÓNIMO A LAS TABLAS PRINCIPALES
--    Antes: anon podía leer/escribir todo con solo la anon key
--    Ahora: debe iniciar sesión primero
-- -----------------------------------------------------------------------
REVOKE ALL ON public.solicitudes_tic FROM anon;
REVOKE ALL ON public.catastro_equipos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catastro_equipos TO authenticated, service_role;

-- -----------------------------------------------------------------------
-- 5. TAMBIÉN ACTUALIZAR LA VISTA SEGURA
-- -----------------------------------------------------------------------
REVOKE ALL ON public.solicitudes_tic_secure FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic_secure TO authenticated, service_role;

-- -----------------------------------------------------------------------
-- 6. AGREGAR POLICY DE ESCRITURA A user_roles PARA service_role
-- -----------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir escritura de roles a service_role" ON public.user_roles;
CREATE POLICY "Permitir escritura de roles a service_role"
  ON public.user_roles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------
-- VERIFICACIÓN — Ejecutar después para confirmar
-- -----------------------------------------------------------------------
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('solicitudes_tic', 'catastro_equipos', 'user_roles')
ORDER BY tablename, policyname;
