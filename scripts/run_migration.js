// Script temporal para ejecutar las migraciones SQL de seguridad.
// Usa pg (PostgreSQL client) para conectarse directamente a Supabase.
// Ejecutar: node scripts/run_migration.js

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://likdtkpavilbrdlslhyr.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxpa2R0a3BhdmlsYnJkbHNsaHlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDYxMDU5MSwiZXhwIjoyMDk2MTg2NTkxfQ.R3C9nnhLXNMoqI_jxE50u2R8xLlpz7glBrRycYcfGDA';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Dividir el SQL en statements individuales para ejecutar por RPC
const sqlStatements = [
  // 1. Corregir trigger de roles
  `CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, email, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'role', 'tecnico'))
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`,

  // 2. RLS solicitudes_tic
  `DROP POLICY IF EXISTS "Acceso total solicitudes" ON public.solicitudes_tic`,
  `CREATE POLICY "Autenticados: leer solicitudes" ON public.solicitudes_tic FOR SELECT TO authenticated USING (true)`,
  `CREATE POLICY "Autenticados: crear solicitudes" ON public.solicitudes_tic FOR INSERT TO authenticated WITH CHECK (true)`,
  `CREATE POLICY "Solo admins: editar solicitudes" ON public.solicitudes_tic FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())`,
  `CREATE POLICY "Solo admins: eliminar solicitudes" ON public.solicitudes_tic FOR DELETE TO authenticated USING (public.is_admin())`,

  // 3. RLS catastro_equipos
  `DROP POLICY IF EXISTS "Acceso total catastro" ON public.catastro_equipos`,
  `CREATE POLICY "Autenticados: leer catastro" ON public.catastro_equipos FOR SELECT TO authenticated USING (true)`,
  `CREATE POLICY "Solo admins: insertar catastro" ON public.catastro_equipos FOR INSERT TO authenticated WITH CHECK (public.is_admin())`,
  `CREATE POLICY "Solo admins: editar catastro" ON public.catastro_equipos FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())`,
  `CREATE POLICY "Solo admins: eliminar catastro" ON public.catastro_equipos FOR DELETE TO authenticated USING (public.is_admin())`,

  // 4. Revocar acceso anónimo
  `REVOKE ALL ON public.solicitudes_tic FROM anon`,
  `REVOKE ALL ON public.catastro_equipos FROM anon`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic TO authenticated, service_role`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.catastro_equipos TO authenticated, service_role`,
  `REVOKE ALL ON public.solicitudes_tic_secure FROM anon`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tic_secure TO authenticated, service_role`,

  // 5. Policy escritura user_roles para service_role
  `DROP POLICY IF EXISTS "Permitir escritura de roles a service_role" ON public.user_roles`,
  `CREATE POLICY "Permitir escritura de roles a service_role" ON public.user_roles FOR ALL TO service_role USING (true) WITH CHECK (true)`,
];

async function runMigration() {
  console.log('🔐 Iniciando migración de seguridad...\n');
  let success = 0;
  let failed = 0;

  for (const stmt of sqlStatements) {
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 80);
    try {
      const { error } = await supabase.rpc('exec_sql_migration', { sql_text: stmt });
      if (error) {
        // Si la función no existe, reportar
        if (error.message.includes('exec_sql_migration')) {
          console.error('\n❌ La función exec_sql_migration no existe en Supabase.');
          console.error('   Ejecuta manualmente el archivo: supabase/migrations/patch_security.sql');
          console.error('   En: https://supabase.com/dashboard/project/likdtkpavilbrdlslhyr/sql/new\n');
          process.exit(1);
        }
        console.error(`  ❌ FALLO: ${preview}...\n     ${error.message}`);
        failed++;
      } else {
        console.log(`  ✅ OK: ${preview}`);
        success++;
      }
    } catch (e) {
      console.error(`  ❌ ERROR: ${preview}...\n     ${e.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Resultado: ${success} exitosos, ${failed} fallidos de ${sqlStatements.length} statements.`);
  if (failed === 0) console.log('✅ Migración completada exitosamente.');
  else console.log('⚠️  Algunos statements fallaron. Ejecuta el SQL manualmente en Supabase.');
}

runMigration();
