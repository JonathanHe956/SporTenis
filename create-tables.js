import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS Notificaciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(100) NOT NULL,
        titulo VARCHAR(255) NOT NULL,
        mensaje TEXT NOT NULL,
        id_producto INT,
        leida BOOLEAN DEFAULT FALSE NOT NULL,
        fecha_creacion DATETIME NOT NULL,
        FOREIGN KEY (id_producto) REFERENCES Productos(id)
      )
    `);
    console.log("Tabla Notificaciones creada.");
  } catch (e) {
    console.log("Notificaciones error:", e.message);
  }

  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS PedidosCompra (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_producto INT NOT NULL,
        id_proveedor INT,
        cantidad INT NOT NULL,
        tipo VARCHAR(50) NOT NULL,
        estado VARCHAR(100) NOT NULL,
        fecha_creacion DATETIME NOT NULL,
        fecha_completado DATETIME,
        FOREIGN KEY (id_producto) REFERENCES Productos(id),
        FOREIGN KEY (id_proveedor) REFERENCES Proveedores(id)
      )
    `);
    console.log("Tabla PedidosCompra creada.");
  } catch (e) {
    console.log("PedidosCompra error:", e.message);
  }

  await connection.end();
}

main();
