import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute('ALTER TABLE Proveedores ADD COLUMN contacto VARCHAR(255)');
    console.log("Columna contacto agregada.");
  } catch (e) {
    console.log("contacto:", e.message);
  }

  try {
    await connection.execute('ALTER TABLE Proveedores ADD COLUMN correo VARCHAR(255)');
    console.log("Columna correo agregada.");
  } catch (e) {
    console.log("correo:", e.message);
  }

  try {
    await connection.execute('ALTER TABLE Proveedores ADD COLUMN telefono VARCHAR(50)');
    console.log("Columna telefono agregada.");
  } catch (e) {
    console.log("telefono:", e.message);
  }

  try {
    await connection.execute('ALTER TABLE Proveedores ADD COLUMN direccion TEXT');
    console.log("Columna direccion agregada.");
  } catch (e) {
    console.log("direccion:", e.message);
  }
  
  await connection.end();
}

main();
