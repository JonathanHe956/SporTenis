import mysql from 'mysql2/promise';
import 'dotenv/config';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db');
  await connection.query("DELETE FROM PedidosCompra WHERE estado='Pendiente'");
  await connection.query("DELETE FROM Notificaciones WHERE tipo='pedido_auto'");
  console.log('Cleaned');
  await connection.end();
}
main();
