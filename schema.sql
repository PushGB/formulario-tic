-- =======================================================================
-- ESQUEMA DE BASE DE DATOS PARA EL FORMULARIO TIC (SUPABASE POSTGRESQL)
-- =======================================================================

-- 1. Crear la tabla de solicitudes (solicitudes_tic)
CREATE TABLE IF NOT EXISTS public.solicitudes_tic (
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

-- Habilitar RLS para solicitudes_tic
ALTER TABLE public.solicitudes_tic ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas previas si existen
DROP POLICY IF EXISTS "Permitir lectura solo a usuarios autenticados" ON public.solicitudes_tic;
DROP POLICY IF EXISTS "Permitir inserción pública de solicitudes" ON public.solicitudes_tic;
DROP POLICY IF EXISTS "Permitir actualización solo a usuarios autenticados" ON public.solicitudes_tic;
DROP POLICY IF EXISTS "Permitir borrado solo a usuarios autenticados" ON public.solicitudes_tic;
DROP POLICY IF EXISTS "Permitir lectura pública de solicitudes" ON public.solicitudes_tic;
DROP POLICY IF EXISTS "Permitir actualización pública de solicitudes" ON public.solicitudes_tic;
DROP POLICY IF EXISTS "Permitir borrado público de solicitudes" ON public.solicitudes_tic;

-- Crear políticas de acceso para solicitudes_tic
CREATE POLICY "Permitir lectura pública de solicitudes" 
ON public.solicitudes_tic FOR SELECT TO public USING (true);

CREATE POLICY "Permitir inserción pública de solicitudes" 
ON public.solicitudes_tic FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Permitir actualización pública de solicitudes" 
ON public.solicitudes_tic FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "Permitir borrado público de solicitudes" 
ON public.solicitudes_tic FOR DELETE TO public USING (true);


-- 2. Crear la tabla de catálogo de equipamiento (catastro_equipos)
CREATE TABLE IF NOT EXISTS public.catastro_equipos (
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

-- Habilitar RLS para catastro_equipos
ALTER TABLE public.catastro_equipos ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas previas si existen
DROP POLICY IF EXISTS "Permitir lectura solo a usuarios autenticados" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir inserción solo a usuarios autenticados" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir actualización solo a usuarios autenticados" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir borrado solo a usuarios autenticados" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir lectura pública de catastro" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir inserción pública de catastro" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir actualización pública de catastro" ON public.catastro_equipos;
DROP POLICY IF EXISTS "Permitir borrado público de catastro" ON public.catastro_equipos;

-- Crear políticas de acceso para catastro_equipos
CREATE POLICY "Permitir lectura pública de catastro" 
ON public.catastro_equipos FOR SELECT TO public USING (true);

CREATE POLICY "Permitir inserción pública de catastro" 
ON public.catastro_equipos FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Permitir actualización pública de catastro" 
ON public.catastro_equipos FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "Permitir borrado público de catastro" 
ON public.catastro_equipos FOR DELETE TO public USING (true);


-- 3. Habilitar Realtime para las tablas en Supabase
-- Nota: Si la publicación ya existe, esto añade las tablas a la misma.
-- En Supabase la publicación por defecto se llama 'supabase_realtime'.
BEGIN;
  -- Asegurar que la publicación existe (por si acaso)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END
  $$;

  -- Intentar añadir las tablas a la publicación
  -- (Evita duplicados controlando si ya pertenecen a la publicación)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_rel pr 
      JOIN pg_class c ON pr.prrelid = c.oid 
      JOIN pg_publication p ON pr.prpubid = p.oid 
      WHERE p.pubname = 'supabase_realtime' AND c.relname = 'solicitudes_tic'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE solicitudes_tic;
    END IF;
  END
  $$;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_rel pr 
      JOIN pg_class c ON pr.prrelid = c.oid 
      JOIN pg_publication p ON pr.prpubid = p.oid 
      WHERE p.pubname = 'supabase_realtime' AND c.relname = 'catastro_equipos'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE catastro_equipos;
    END IF;
  END
  $$;
COMMIT;

-- =======================================================================
-- 3.5. TABLA DE ROLES Y FUNCIONES DE AUTORIZACIÓN (ADMIN / TECNICO)
-- =======================================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'tecnico')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS para roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Permite a cualquier usuario autenticado leer los roles (necesario para verificar su rol en el cliente)
DROP POLICY IF EXISTS "Permitir lectura de roles a autenticados" ON public.user_roles;
CREATE POLICY "Permitir lectura de roles a autenticados" 
ON public.user_roles FOR SELECT TO authenticated USING (true);

-- Función para verificar si es administrador
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para verificar si es técnico
CREATE OR REPLACE FUNCTION public.is_tecnico() RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'tecnico'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para crear rol por defecto al registrarse
-- Por defecto, correos con la palabra 'admin' reciben rol 'admin', los demás 'tecnico'
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 4. Extensión pgcrypto y Encriptación de RUT
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Función para encriptar RUT (retorna en Base64 para almacenar en TEXT)
CREATE OR REPLACE FUNCTION public.encrypt_rut(rut TEXT) RETURNS TEXT AS $$
BEGIN
    IF rut IS NULL OR rut = '' THEN
        RETURN NULL;
    END IF;
    RETURN encode(pgp_sym_encrypt(rut, 'ClaveSecretaTIC2026'), 'base64');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para desencriptar RUT
CREATE OR REPLACE FUNCTION public.decrypt_rut(enc_rut TEXT) RETURNS TEXT AS $$
BEGIN
    IF enc_rut IS NULL OR enc_rut = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        RETURN pgp_sym_decrypt(decode(enc_rut, 'base64'), 'ClaveSecretaTIC2026');
    EXCEPTION WHEN OTHERS THEN
        -- Retornar el original si falla (p.ej. datos preexistentes en texto plano)
        RETURN enc_rut;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para encriptar automáticamente el RUT en la tabla solicitudes_tic
CREATE OR REPLACE FUNCTION public.trg_encrypt_solicitudes_rut() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.funcionario_rut IS NOT NULL THEN
        -- Encriptar solo si parece un RUT plano (contiene números/guiones/puntos y no es ya una firma encriptada PGP)
        IF NEW.funcionario_rut ~ '^[0-9kK\.-]+$' THEN
            NEW.funcionario_rut = public.encrypt_rut(NEW.funcionario_rut);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solicitudes_encrypt_rut ON public.solicitudes_tic;
CREATE OR REPLACE TRIGGER solicitudes_encrypt_rut
BEFORE INSERT OR UPDATE ON public.solicitudes_tic
FOR EACH ROW EXECUTE FUNCTION public.trg_encrypt_solicitudes_rut();


-- 5. Vista de Solicitudes Segura (Autodesencriptable)
DROP VIEW IF EXISTS public.solicitudes_tic_secure CASCADE;
CREATE OR REPLACE VIEW public.solicitudes_tic_secure AS
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

-- Permisos explícitos sobre la vista para acceso público sin login
REVOKE ALL ON public.solicitudes_tic_secure FROM public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic_secure TO public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic_secure TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic_secure TO authenticated;


-- 6. Tabla de Auditoría e Historial de Cambios
CREATE TABLE IF NOT EXISTS public.auditoria_solicitudes (
    id SERIAL PRIMARY KEY,
    solicitud_id TEXT NOT NULL,
    accion TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    usuario TEXT, -- correo de Supabase Auth
    detalle JSONB, -- datos nuevos/antiguos
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS para auditoría
ALTER TABLE public.auditoria_solicitudes ENABLE ROW LEVEL SECURITY;

-- Eliminar política previa si existe
DROP POLICY IF EXISTS "Permitir lectura de auditoría a autenticados" ON public.auditoria_solicitudes;

-- Solo usuarios autenticados con rol admin pueden ver la auditoría
CREATE POLICY "Permitir lectura de auditoría a autenticados" 
ON public.auditoria_solicitudes FOR SELECT TO authenticated USING (public.is_admin());

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS solicitudes_auditoria ON public.solicitudes_tic;
CREATE OR REPLACE TRIGGER solicitudes_auditoria
AFTER INSERT OR UPDATE OR DELETE ON public.solicitudes_tic
FOR EACH ROW EXECUTE FUNCTION public.trg_auditar_solicitudes();


-- 7. Configuración de Supabase Storage para Firmas Digitales
-- Crear el bucket de firmas (Público)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('firmas', 'firmas', true) 
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de Storage para firmas (Públicas)
DROP POLICY IF EXISTS "Permitir subida de firmas a autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir lectura de firmas a autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir borrado de firmas a autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir subida de firmas a todos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir lectura de firmas a todos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir borrado de firmas a todos" ON storage.objects;

CREATE POLICY "Permitir subida de firmas a todos" ON storage.objects 
FOR INSERT TO public WITH CHECK (bucket_id = 'firmas');

CREATE POLICY "Permitir lectura de firmas a todos" ON storage.objects 
FOR SELECT TO public USING (bucket_id = 'firmas');

CREATE POLICY "Permitir borrado de firmas a todos" ON storage.objects 
FOR DELETE TO public USING (bucket_id = 'firmas');

