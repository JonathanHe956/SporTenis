import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS Auditorias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_usuario INT,
        fecha DATETIME NOT NULL,
        estado VARCHAR(50) NOT NULL,
        notas TEXT,
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id)
      )
    `);
    console.log("Tabla Auditorias creada exitosamente.");
    
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS AuditoriaDetalles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_auditoria INT NOT NULL,
        id_producto INT NOT NULL,
        stock_sistema INT NOT NULL,
        stock_fisico INT NOT NULL,
        diferencia INT NOT NULL,
        FOREIGN KEY (id_auditoria) REFERENCES Auditorias(id) ON DELETE CASCADE,
        FOREIGN KEY (id_producto) REFERENCES Productos(id)
      )
    `);
    console.log("Tabla AuditoriaDetalles creada exitosamente.");
  } catch (error) {
    console.error("Error creando las tablas:", error);
  }
  
  await connection.end();
}

main();
