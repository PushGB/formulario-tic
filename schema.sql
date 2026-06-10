-- =======================================================================
-- ESQUEMA DE BASE DE DATOS PARA EL FORMULARIO TIC (SUPABASE POSTGRESQL)
-- RESET COMPLETO Y MÁXIMA SEGURIDAD RLS
-- =======================================================================

-- 0. LIMPIEZA TOTAL DE ELEMENTOS ANTERIORES
DROP VIEW IF EXISTS public.solicitudes_tic_secure CASCADE;
DROP TABLE IF EXISTS public.solicitudes_tic CASCADE;
DROP TABLE IF EXISTS public.catastro_equipos CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.auditoria_solicitudes CASCADE;

DROP FUNCTION IF EXISTS public.encrypt_rut(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.decrypt_rut(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.is_tecnico() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.trg_encrypt_solicitudes_rut() CASCADE;
DROP FUNCTION IF EXISTS public.trg_auditar_solicitudes() CASCADE;

-- Re-crear extensión de encriptación pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. CREAR LA TABLA DE SOLICITUDES (solicitudes_tic)
CREATE TABLE public.solicitudes_tic (
    id TEXT PRIMARY KEY,
    fecha DATE NOT NULL,
    ticket TEXT DEFAULT 'S/N',
    
    -- Datos del funcionario receptor
    funcionario_nombre TEXT NOT NULL,
    funcionario_rut TEXT NOT NULL,
    funcionario_cargo TEXT NOT NULL,
    funcionario_depto TEXT NOT NULL,
    
    -- Tipo y propiedad de la solicitud
    tipo_solicitud TEXT NOT NULL,
    propiedad_equipamiento TEXT NOT NULL,
    
    -- Categorías y otros detalles (Sección 2)
    equipamiento_categorias JSONB NOT NULL DEFAULT '[]'::jsonb,
    otros_detalles TEXT,
    
    -- Datos específicos de traspaso (Sección 3)
    traspaso_emisor_nombre TEXT,
    traspaso_emisor_depto TEXT,
    traspaso_receptor_nombre TEXT,
    traspaso_receptor_depto TEXT,
    traspaso_observacion TEXT,
    
    -- Detalle de los equipos (Sección 4)
    equipamiento JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Comentarios y accesorios
    accesorios TEXT,
    observaciones_generales TEXT,
    
    -- Firmas (Modo y Base64)
    firmas_tic_mode TEXT NOT NULL DEFAULT 'digital',
    firmas_emisor_mode TEXT NOT NULL DEFAULT 'digital',
    firmas_receptor_mode TEXT NOT NULL DEFAULT 'digital',
    firma_tic TEXT,      -- Contiene la firma en formato Base64 PNG
    firma_emisor TEXT,   -- Contiene la firma en formato Base64 PNG
    firma_receptor TEXT, -- Contiene la firma en formato Base64 PNG
    
    -- Auditoría
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CREAR LA TABLA DE CATASTRO DE EQUIPOS (catastro_equipos)
CREATE TABLE public.catastro_equipos (
    id SERIAL PRIMARY KEY,
    n TEXT,
    inventario TEXT,
    serie TEXT UNIQUE NOT NULL,
    tipo TEXT,
    marca TEXT,
    modelo TEXT,
    propiedad TEXT,
    funcionario TEXT,
    mail TEXT,
    depto TEXT,
    estado TEXT DEFAULT 'Disponible',
    observaciones TEXT,
    sheet TEXT, -- 'Computadores' o 'Impresoras-Scanner'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CREAR LA TABLA DE ROLES (user_roles)
CREATE TABLE public.user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'tecnico')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CREAR LA TABLA DE AUDITORÍA (auditoria_solicitudes)
CREATE TABLE public.auditoria_solicitudes (
    id SERIAL PRIMARY KEY,
    solicitud_id TEXT NOT NULL,
    accion TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    usuario TEXT, -- correo de Supabase Auth
    detalle JSONB, -- datos nuevos/antiguos
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======================================================================
-- 5. HABILITAR ROW LEVEL SECURITY (RLS)
-- =======================================================================
ALTER TABLE public.solicitudes_tic ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catastro_equipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_solicitudes ENABLE ROW LEVEL SECURITY;

-- =======================================================================
-- 6. POLÍTICAS RLS ROBUSTAS UTILIZANDO ROLES EXPLÍCITOS DE SUPABASE
-- =======================================================================

-- solicitudes_tic: Acceso total para la API del cliente (anon y authenticated) y service_role
CREATE POLICY "Acceso total solicitudes" ON public.solicitudes_tic 
FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- catastro_equipos: Acceso total para la API del cliente (anon y authenticated) y service_role
CREATE POLICY "Acceso total catastro" ON public.catastro_equipos 
FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- user_roles: Lectura exclusiva para usuarios autenticados
CREATE POLICY "Permitir lectura de roles a autenticados" ON public.user_roles 
FOR SELECT TO authenticated USING (true);

-- auditoria_solicitudes: Lectura solo para administradores autenticados
CREATE POLICY "Permitir lectura de auditoría a administradores" ON public.auditoria_solicitudes 
FOR SELECT TO authenticated USING (public.is_admin());

-- =======================================================================
-- 7. FUNCIONES DE ROLES (SECURITY DEFINER)
-- =======================================================================
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_tecnico() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'tecnico'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Trigger para registrar rol al crear usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE 
      WHEN NEW.email LIKE '%admin%' THEN 'admin'
      ELSE 'tecnico'
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =======================================================================
-- 8. FUNCIONES DE ENCRIPTACIÓN (SECURITY INVOKER - PREVIENE ADVERTENCIAS)
-- =======================================================================
CREATE OR REPLACE FUNCTION public.encrypt_rut(rut TEXT) RETURNS TEXT AS $$
BEGIN
    IF rut IS NULL OR rut = '' THEN
        RETURN NULL;
    END IF;
    RETURN encode(pgp_sym_encrypt(rut, 'ClaveSecretaTIC2026'), 'base64');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION public.decrypt_rut(enc_rut TEXT) RETURNS TEXT AS $$
BEGIN
    IF enc_rut IS NULL OR enc_rut = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        RETURN pgp_sym_decrypt(decode(enc_rut, 'base64'), 'ClaveSecretaTIC2026');
    EXCEPTION WHEN OTHERS THEN
        RETURN enc_rut;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- =======================================================================
-- 9. TRIGGERS Y VISTAS DE ENCRIPTACIÓN/AUDITORÍA
-- =======================================================================

-- Trigger encriptador de RUT
CREATE OR REPLACE FUNCTION public.trg_encrypt_solicitudes_rut() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.funcionario_rut IS NOT NULL THEN
        IF NEW.funcionario_rut ~ '^[0-9kK\.-]+$' THEN
            NEW.funcionario_rut = public.encrypt_rut(NEW.funcionario_rut);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER solicitudes_encrypt_rut
BEFORE INSERT OR UPDATE ON public.solicitudes_tic
FOR EACH ROW EXECUTE FUNCTION public.trg_encrypt_solicitudes_rut();

-- Trigger de Auditoría
CREATE OR REPLACE FUNCTION public.trg_auditar_solicitudes() RETURNS TRIGGER AS $$
DECLARE
    user_email TEXT;
BEGIN
    user_email := auth.email();
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.auditoria_solicitudes (solicitud_id, accion, usuario, detalle)
        VALUES (NEW.id, TG_OP, user_email, jsonb_build_object('nuevo', to_jsonb(NEW)));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.auditoria_solicitudes (solicitud_id, accion, usuario, detalle)
        VALUES (NEW.id, TG_OP, user_email, jsonb_build_object('antiguo', to_jsonb(OLD), 'nuevo', to_jsonb(NEW)));
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.auditoria_solicitudes (solicitud_id, accion, usuario, detalle)
        VALUES (OLD.id, TG_OP, user_email, jsonb_build_object('antiguo', to_jsonb(OLD)));
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER solicitudes_auditoria
AFTER INSERT OR UPDATE OR DELETE ON public.solicitudes_tic
FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_solicitudes();

-- Vista Desencriptable segura
CREATE OR REPLACE VIEW public.solicitudes_tic_secure 
WITH (security_invoker = true) AS
SELECT 
    id,
    fecha,
    ticket,
    funcionario_nombre,
    public.decrypt_rut(funcionario_rut) AS funcionario_rut,
    funcionario_cargo,
    funcionario_depto,
    tipo_solicitud,
    propiedad_equipamiento,
    equipamiento_categorias,
    otros_detalles,
    traspaso_emisor_nombre,
    traspaso_emisor_depto,
    traspaso_receptor_nombre,
    traspaso_receptor_depto,
    traspaso_observacion,
    equipamiento,
    accesorios,
    observaciones_generales,
    firmas_tic_mode,
    firmas_emisor_mode,
    firmas_receptor_mode,
    firma_tic,
    firma_emisor,
    firma_receptor,
    created_at
FROM public.solicitudes_tic;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic_secure TO anon, authenticated, service_role;

-- =======================================================================
-- 10. BUCKET DE STORAGE PARA FIRMAS
-- =======================================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('firmas', 'firmas', true) 
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de Storage
DROP POLICY IF EXISTS "Permitir subida de firmas a todos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir lectura de firmas a todos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir borrado de firmas a todos" ON storage.objects;

CREATE POLICY "Permitir subida de firmas a todos" ON storage.objects 
FOR INSERT TO anon, authenticated, service_role WITH CHECK (bucket_id = 'firmas');

CREATE POLICY "Permitir lectura de firmas a todos" ON storage.objects 
FOR SELECT TO anon, authenticated, service_role USING (bucket_id = 'firmas');

CREATE POLICY "Permitir borrado de firmas a todos" ON storage.objects 
FOR DELETE TO anon, authenticated, service_role USING (bucket_id = 'firmas');

-- =======================================================================
-- 11. RESTRICCIONES DE EJECUCIÓN DIRECTA
-- =======================================================================
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
REVOKE EXECUTE ON FUNCTION public.is_tecnico() FROM public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public;
REVOKE EXECUTE ON FUNCTION public.trg_auditar_solicitudes() FROM public;
REVOKE EXECUTE ON FUNCTION public.trg_encrypt_solicitudes_rut() FROM public;
REVOKE EXECUTE ON FUNCTION public.encrypt_rut(TEXT) FROM public;
REVOKE EXECUTE ON FUNCTION public.decrypt_rut(TEXT) FROM public;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tecnico() TO authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_rut(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_rut(TEXT) TO anon, authenticated, service_role;
