-- =======================================================================
-- ESQUEMA DE BASE DE DATOS PARA EL FORMULARIO TIC (SUPABASE POSTGRESQL)
-- =======================================================================

-- 1. Crear la tabla de solicitudes
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

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.solicitudes_tic ENABLE ROW LEVEL SECURITY;

-- 2. Crear políticas de acceso (Permitir lectura y escritura a la API anon)
CREATE POLICY "Permitir lectura pública de solicitudes" 
ON public.solicitudes_tic FOR SELECT 
TO public 
USING (true);

CREATE POLICY "Permitir inserción pública de solicitudes" 
ON public.solicitudes_tic FOR INSERT 
TO public 
WITH CHECK (true);

CREATE POLICY "Permitir actualización pública de solicitudes" 
ON public.solicitudes_tic FOR UPDATE 
TO public 
USING (true)
WITH CHECK (true);

CREATE POLICY "Permitir borrado público de solicitudes" 
ON public.solicitudes_tic FOR DELETE 
TO public 
USING (true);
