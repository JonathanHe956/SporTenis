import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute('ALTER TABLE Modelos ADD COLUMN imagen_url VARCHAR(255)');
    console.log("Columna imagen_url agregada exitosamente.");
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log("La columna imagen_url ya existe.");
    } else {
      console.error("Error alterando la tabla:", error);
    }
  }
  
  await connection.end();
}

main();
