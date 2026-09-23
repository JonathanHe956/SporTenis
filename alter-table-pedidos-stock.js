import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");

  try {
    // 1. Asegurar tabla MovimientosInventario
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
    console.log("✅ Tabla MovimientosInventario verificada.");

    // 2. Verificar columnas en PedidosCompra
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PedidosCompra'
    `);
    const colNames = columns.map(c => c.COLUMN_NAME);

    if (!colNames.includes('stock_anterior')) {
      await connection.execute(`ALTER TABLE PedidosCompra ADD COLUMN stock_anterior INT NULL`);
      console.log("✅ Columna stock_anterior agregada a PedidosCompra.");
    } else {
      console.log("ℹ️ Columna stock_anterior ya existe.");
    }

    if (!colNames.includes('stock_posterior')) {
      await connection.execute(`ALTER TABLE PedidosCompra ADD COLUMN stock_posterior INT NULL`);
      console.log("✅ Columna stock_posterior agregada a PedidosCompra.");
    } else {
      console.log("ℹ️ Columna stock_posterior ya existe.");
    }

    // 3. Inicializar valores para pedidos existentes con stock_anterior NULL
    await connection.execute(`
      UPDATE PedidosCompra p
      JOIN Productos prod ON p.id_producto = prod.id
      SET p.stock_anterior = prod.stock
      WHERE p.stock_anterior IS NULL
    `);
    
    // Si algún pedido ya está completado pero no tiene stock_posterior, calcularlo
    await connection.execute(`
      UPDATE PedidosCompra
      SET stock_posterior = stock_anterior + cantidad
      WHERE estado = 'Completado' AND stock_posterior IS NULL
    `);
    console.log("✅ Datos existentes actualizados con éxito.");

  } catch (error) {
    console.error("❌ Error:", error.message);
  }

  await connection.end();
  console.log("Conexión finalizada.");
}

main();
