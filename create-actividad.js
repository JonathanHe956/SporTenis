import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS ActividadTienda (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255),
        id_usuario INT,
        accion VARCHAR(255) NOT NULL,
        detalles TEXT,
        fecha_hora DATETIME NOT NULL,
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id)
      )
    `);
    console.log("Tabla ActividadTienda creada exitosamente.");
  } catch (error) {
    console.error("Error creando la tabla:", error);
  }
  
  await connection.end();
}

main();
