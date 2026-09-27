import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  console.log("Conectado a la base de datos.");
  
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS TransportistasLogistica (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        codigo VARCHAR(20),
        estado VARCHAR(50) DEFAULT 'Activo',
        api_key VARCHAR(255)
      )
    `);
    console.log("Tabla TransportistasLogistica creada.");
    
    const [rows] = await connection.execute('SELECT COUNT(*) as count FROM TransportistasLogistica');
    if (rows[0].count === 0) {
      await connection.execute("INSERT INTO TransportistasLogistica (nombre, codigo, api_key) VALUES ('DHL Express', 'DHL', 'dhl_api_demo_key')");
      await connection.execute("INSERT INTO TransportistasLogistica (nombre, codigo, api_key) VALUES ('FedEx Ground', 'FDX', 'fedex_demo_key')");
      await connection.execute("INSERT INTO TransportistasLogistica (nombre, codigo, api_key) VALUES ('Estafeta', 'EST', 'estafeta_demo_key')");
      console.log("Transportistas iniciales insertados.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
  
  await connection.end();
}
main();
