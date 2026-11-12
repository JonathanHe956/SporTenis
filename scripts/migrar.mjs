// scripts/migrar.mjs  — Ejecuta migraciones SQL pendientes (manejo de comentarios y multi-sentencia)
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

const conn = await mysql.createConnection({
  ...(process.env.DATABASE_URL
    ? { uri: process.env.DATABASE_URL }
    : { host: 'localhost', port: 3306, user: 'root', password: '', database: 'sportenis_db' }),
  multipleStatements: true,
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS \`_migraciones\` (
    \`nombre\` VARCHAR(200) PRIMARY KEY,
    \`ejecutada_en\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB
`);

const [ejecutadas] = await conn.query('SELECT nombre FROM `_migraciones`');
const yaEjecutadas = new Set(ejecutadas.map(r => r.nombre));

const archivos = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

let count = 0;
for (const archivo of archivos) {
  if (yaEjecutadas.has(archivo)) {
    console.log(`  ✓ ${archivo}`);
    continue;
  }

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), 'utf8');

  try {
    // Ejecutar todo el archivo de una vez con multipleStatements=true
    await conn.query(sql);
    await conn.query('INSERT INTO `_migraciones` (nombre) VALUES (?)', [archivo]);
    console.log(`  ✅ ${archivo}`);
    count++;
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_FIELDNAME' ||
        err.message?.includes('Duplicate column') || err.message?.includes('Duplicate key')) {
      // Columna o índice ya existe → la damos por aplicada
      await conn.query('INSERT IGNORE INTO `_migraciones` (nombre) VALUES (?)', [archivo]);
      console.log(`  ✅ ${archivo} (ya aplicada parcialmente)`);
      count++;
    } else {
      console.error(`  ❌ ${archivo}: ${err.message}`);
    }
  }
}

await conn.end();
console.log(`\nListo. ${count} migración(es) aplicada(s).`);
