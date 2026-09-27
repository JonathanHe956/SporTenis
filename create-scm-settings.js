import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS ScmSettings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nivel_scm VARCHAR(50) DEFAULT 'Inicial',
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Tabla ScmSettings creada exitosamente.");
    
    // Insert initial row if not exists
    const [rows] = await connection.execute('SELECT COUNT(*) as count FROM ScmSettings');
    if (rows[0].count === 0) {
      await connection.execute('INSERT INTO ScmSettings (nivel_scm) VALUES (?)', ['Inicial']);
      console.log("Fila inicial insertada.");
    }
  } catch (error) {
    console.error("Error creando las tablas:", error);
  }
  
  await connection.end();
}
main();
