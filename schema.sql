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
