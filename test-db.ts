import { db } from './src/db/db';
import { Productos, Modelos, Categorias } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function test() {
  try {
    const rawProducts = await db
      .select({
        name: Modelos.nombre,
        type: Categorias.nombre,
        price: Productos.precio_venta,
        badge: Productos.badge,
        className: Productos.theme_class,
        description: Modelos.descripcion,
        color: Productos.color,
        talla: Productos.talla_cm,
        imagen: Modelos.imagen_url
      })
      .from(Productos)
      .innerJoin(Modelos, eq(Productos.id_modelo, Modelos.id))
      .innerJoin(Categorias, eq(Modelos.id_categoria, Categorias.id))
      .where(eq(Productos.estado, 'Activo'));
      
    console.log(rawProducts.length);
  } catch (e) {
    console.error(e);
  }
}

test();
