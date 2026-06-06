import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// =======================================================================
// SCRIPT DE IMPORTACIÓN DE CATASTRO EXCEL A SUPABASE
// =======================================================================

// 1. Cargar y parsear archivo .env local
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: No se encontró el archivo .env en la raíz del proyecto.');
    process.exit(1);
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  envContent.split(/\r?\n/).forEach(line => {
    // Ignorar comentarios y líneas vacías
    if (line.trim().startsWith('#') || !line.includes('=')) return;
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    env[key.trim()] = value;
  });
  return env;
}

const env = loadEnv();
const supabaseUrl = env['VITE_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'] || env['VITE_SUPABASE_SERVICE_ROLE_KEY'];
const supabaseKey = serviceRoleKey || env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('tu-proyecto-nuevo')) {
  console.error('Error: Las credenciales de Supabase en el .env no están configuradas correctamente.');
  process.exit(1);
}

if (!serviceRoleKey) {
  console.warn('\x1b[33m%s\x1b[0m', 'Advertencia: No se detectó SUPABASE_SERVICE_ROLE_KEY en el archivo .env.');
  console.warn('\x1b[33m%s\x1b[0m', 'Las nuevas políticas RLS restringirán la inserción de catastro para el rol anónimo.');
  console.warn('\x1b[33m%s\x1b[0m', 'Para corregir esto, añade SUPABASE_SERVICE_ROLE_KEY a tu archivo .env o reemplaza temporalmente VITE_SUPABASE_ANON_KEY con tu clave de servicio.\n');
}

// 2. Inicializar cliente Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// Normalizar claves para que coincidan con la base de datos
function normalizeKey(key) {
  if (typeof key !== 'string') return '';
  return key.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar acentos
            .replace(/[\s\r\n\t]+/g, '')                     // quitar espacios
            .replace(/[^a-z0-9]/g, '');                      // alfanuméricos
}

// Convertir fila a formato limpio para DB
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
    estado: 'Disponible',
    observaciones: '',
    sheet: sourceSheet
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
  return cleaned;
}

// 3. Cargar y procesar Excel
async function importCatastro() {
  const excelPath = path.resolve(process.cwd(), 'Catastro_ISP_2025_PRECARGADO.xlsx');
  if (!fs.existsSync(excelPath)) {
    console.error(`Error: No se encontró el archivo Excel en: ${excelPath}`);
    process.exit(1);
  }
  
  console.log('Leyendo plantilla Excel Catastro_ISP_2025_PRECARGADO.xlsx...');
  const workbook = XLSX.readFile(excelPath);
  
  const allRows = [];
  
  // Procesar Computadores (Rango de cabecera a partir de la fila 4 -> índice de inicio 3 en sheetjs)
  const compSheet = workbook.Sheets['Computadores'];
  if (compSheet) {
    const compRows = XLSX.utils.sheet_to_json(compSheet, { range: 3 });
    const cleaned = compRows
      .filter(row => {
        const serie = row['N° Serie'] || row['N° de Serie'] || row['Serie'];
        return serie && String(serie).trim().length > 0 && !String(serie).startsWith('▶');
      })
      .map(row => cleanRowData(row, 'Computadores'));
    allRows.push(...cleaned);
    console.log(`- Encontrados ${cleaned.length} computadores en el Excel.`);
  }
  
  // Procesar Impresoras-Scanner (Rango de cabecera a partir de la fila 4)
  const printerSheet = workbook.Sheets['Impresoras-Scanner'];
  if (printerSheet) {
    const printerRows = XLSX.utils.sheet_to_json(printerSheet, { range: 3 });
    const cleaned = printerRows
      .filter(row => {
        const serie = row['N° Serie'] || row['N° de Serie'] || row['Serie'];
        return serie && String(serie).trim().length > 0 && !String(serie).startsWith('▶');
      })
      .map(row => cleanRowData(row, 'Impresoras-Scanner'));
    allRows.push(...cleaned);
    console.log(`- Encontradas ${cleaned.length} impresoras/scanners en el Excel.`);
  }
  
  // Deduplicar en memoria para evitar que un mismo lote contenga la misma serie duplicada
  const uniqueRowsMap = new Map();
  allRows.forEach(row => {
    const key = row.serie.toLowerCase().trim();
    uniqueRowsMap.set(key, row);
  });
  const uniqueRows = Array.from(uniqueRowsMap.values());
  console.log(`Deduplicación en memoria: ${uniqueRows.length} registros únicos de un total de ${allRows.length}.`);
  
  console.log(`Total de registros a importar: ${uniqueRows.length}. Iniciando subida a Supabase...`);
  
  // Dividir en lotes de 100 y subir mediante upsert
  const batchSize = 100;
  let successful = 0;
  
  for (let i = 0; i < uniqueRows.length; i += batchSize) {
    const batch = uniqueRows.slice(i, i + batchSize);
    try {
      const { error } = await supabase
        .from('catastro_equipos')
        .upsert(batch, { onConflict: 'serie' });
        
      if (error) throw error;
      
      successful += batch.length;
      console.log(`  Subido lote ${i / batchSize + 1} (${successful}/${uniqueRows.length} completados)...`);
    } catch (err) {
      console.error(`  Error al subir lote ${i / batchSize + 1}:`, err.message);
    }
  }
  
  console.log(`\nImportación finalizada. Se insertaron/actualizaron exitosamente ${successful} de ${allRows.length} equipos en la base de datos de Supabase.`);
}

importCatastro().catch(err => {
  console.error('Error durante la ejecución del script:', err);
});
