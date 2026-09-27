
import { db } from './src/db/db';
import { PedidosCompra, Productos, Modelos, Marcas, Categorias, Proveedores } from './src/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

async function main() {
  try {
    const res = await db.select().from(PedidosCompra)
      .leftJoin(Productos, eq(PedidosCompra.id_producto, Productos.id))
      .leftJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
      .leftJoin(Marcas, eq(Modelos.id_marca, Marcas.id))
      .leftJoin(Categorias, eq(Modelos.id_categoria, Categorias.id))
      .leftJoin(Proveedores, sql\COALESCE(\, \) = \\)
      .orderBy(desc(PedidosCompra.fecha_creacion));
    console.log('Success!', res.length);
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.cause) console.error('CAUSE:', err.cause);
  }
  process.exit(0);
}
main();

