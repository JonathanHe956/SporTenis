import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS MovimientosInventario (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_producto INT NOT NULL,
        tipo VARCHAR(50) NOT NULL,
        cantidad INT NOT NULL,
        motivo VARCHAR(255) NOT NULL,
        fecha DATETIME NOT NULL,
        id_usuario INT,
        FOREIGN KEY (id_producto) REFERENCES Productos(id),
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id)
      )
    `);
    console.log("Tabla MovimientosInventario creada o ya existe.");
  } catch (error) {
    console.error("Error al crear la tabla MovimientosInventario:", error);
  }
  
  await connection.end();
}

main();
