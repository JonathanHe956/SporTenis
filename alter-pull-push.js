import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    // Tabla de Notificaciones (para alertas de la campanita - PUSH y avisos PULL)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS Notificaciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(100) NOT NULL,
        titulo VARCHAR(255) NOT NULL,
        mensaje TEXT NOT NULL,
        id_producto INT,
        leida BOOLEAN DEFAULT FALSE,
        fecha_creacion DATETIME NOT NULL,
        FOREIGN KEY (id_producto) REFERENCES Productos(id) ON DELETE SET NULL
      )
    `);
    console.log("✅ Tabla Notificaciones creada o ya existe.");

    // Tabla de Pedidos de Compra (reabastecimiento)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS PedidosCompra (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_producto INT NOT NULL,
        id_proveedor INT,
        cantidad INT NOT NULL,
        tipo VARCHAR(50) NOT NULL,
        estado VARCHAR(100) NOT NULL DEFAULT 'Pendiente',
        fecha_creacion DATETIME NOT NULL,
        fecha_completado DATETIME,
        FOREIGN KEY (id_producto) REFERENCES Productos(id) ON DELETE CASCADE,
        FOREIGN KEY (id_proveedor) REFERENCES Proveedores(id) ON DELETE SET NULL
      )
    `);
    console.log("✅ Tabla PedidosCompra creada o ya existe.");

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
  
  await connection.end();
  console.log("Conexión cerrada.");
}

main();
