import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS Proveedores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL
      )
    `);
    console.log("Tabla Proveedores creada o ya existe.");
    
    // Insert defaults if empty
    const [rows] = await connection.execute('SELECT count(*) as count FROM Proveedores');
    if (rows[0].count === 0) {
      await connection.execute("INSERT INTO Proveedores (nombre) VALUES ('Nike Inc.'), ('Adidas AG'), ('Puma SE')");
      console.log("Proveedores por defecto agregados.");
    }

    try {
      await connection.execute('ALTER TABLE Productos ADD COLUMN id_proveedor INT');
      await connection.execute('ALTER TABLE Productos ADD CONSTRAINT fk_proveedor FOREIGN KEY (id_proveedor) REFERENCES Proveedores(id)');
      console.log("Columna id_proveedor agregada exitosamente.");
    } catch (e) {
      console.log("Columna id_proveedor ya existe o error:", e.message);
    }
    
    try {
      await connection.execute('ALTER TABLE Productos ADD COLUMN stock_minimo INT NOT NULL DEFAULT 0');
      console.log("Columna stock_minimo agregada exitosamente.");
    } catch (e) {
      console.log("Columna stock_minimo ya existe o error:", e.message);
    }
    
    try {
      await connection.execute('ALTER TABLE Productos ADD COLUMN estrategia_logistica VARCHAR(50) DEFAULT "PUSH"');
      console.log("Columna estrategia_logistica agregada exitosamente.");
    } catch (e) {
      console.log("Columna estrategia_logistica ya existe o error:", e.message);
    }
    
  } catch (error) {
    console.error("Error general:", error);
  }
  
  await connection.end();
}

main();
