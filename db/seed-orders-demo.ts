import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/db.js';
import {
  Categorias, Clientes, DetalleVentas, Marcas, MetodosPago, Modelos,
  MovimientosInventario, Productos, Usuarios, Ventas,
} from '../src/db/schema.js';

const demoOrders = [
  { customer: 'Cliente Demo - Procesando', email: 'demo-orden-procesando@sportenis.test', payment: 'Demo - Tarjeta', status: 'Procesando', daysAgo: 1, quantity: 2 },
  { customer: 'Cliente Demo - Confirmada', email: 'demo-orden-confirmada@sportenis.test', payment: 'Demo - Transferencia', status: 'Confirmada', daysAgo: 3, quantity: 1 },
  { customer: 'Cliente Demo - Entregada', email: 'demo-orden-entregada@sportenis.test', payment: 'Demo - Tarjeta', status: 'Entregada', daysAgo: 8, quantity: 1 },
  { customer: 'Cliente Demo - Cancelada', email: 'demo-orden-cancelada@sportenis.test', payment: 'Demo - Efectivo', status: 'Cancelada', daysAgo: 10, quantity: 1 },
] as const;

const main = async () => {
  await db.transaction(async (tx) => {
    const existingOrders = await tx
      .select({ id: Ventas.id })
      .from(Ventas)
      .innerJoin(Clientes, eq(Ventas.id_cliente, Clientes.id))
      .where(inArray(Clientes.correo, demoOrders.map((order) => order.email)));

    if (existingOrders.length > 0) {
      throw new Error('Ya existen órdenes de demostración; no se modificó la base de datos.');
    }

    const [existingDemoProduct] = await tx
      .select({ id: Productos.id })
      .from(Productos)
      .where(eq(Productos.sku, 'DEMO-ERP-ORDENES'));

    if (existingDemoProduct) {
      throw new Error('El producto de demostración ya existe sin sus órdenes; no se modificó la base de datos.');
    }

    const [category] = await tx.select({ id: Categorias.id }).from(Categorias).limit(1);
    const [brand] = await tx.select({ id: Marcas.id }).from(Marcas).limit(1);
    const [user] = await tx.select({ id: Usuarios.id }).from(Usuarios).limit(1);

    if (!category || !brand || !user) {
      throw new Error('Faltan categorías, marcas o usuarios. Ejecuta primero el seed principal.');
    }

    const [model] = await tx.insert(Modelos).values({
      id_marca: brand.id,
      id_categoria: category.id,
      nombre: 'Modelo de demostración ERP',
      descripcion: 'Producto de prueba para el listado de órdenes.',
      precio_base: '699.00',
    }).$returningId();

    const [product] = await tx.insert(Productos).values({
      id_modelo: model.id,
      sku: 'DEMO-ERP-ORDENES',
      talla_cm: 'M',
      color: 'Negro',
      precio_venta: '699.00',
      costo: '300.00',
      stock: 98,
      stock_minimo: 0,
      estado: 'activo',
      badge: 'Demo',
      theme_class: 'product-shirt',
    }).$returningId();

    const fechaBase = new Date();
    const fechaHaceDias = (days: number) =>
      new Date(fechaBase.getTime() - days * 24 * 60 * 60 * 1000);

    for (const order of demoOrders) {
      const [customer] = await tx.insert(Clientes).values({
        nombre: order.customer,
        correo: order.email,
        estado: 'Activo',
        fecha_registro: fechaBase,
      }).$returningId();

      const [existingPayment] = await tx
        .select({ id: MetodosPago.id })
        .from(MetodosPago)
        .where(eq(MetodosPago.nombre, order.payment));
      const [payment] = existingPayment
        ? [existingPayment]
        : await tx.insert(MetodosPago).values({ nombre: order.payment }).$returningId();

      const subtotal = 699 * order.quantity;
      const envio = subtotal >= 1500 ? 0 : 99;
      const [sale] = await tx.insert(Ventas).values({
        id_cliente: customer.id,
        id_usuario: user.id,
        id_metodo_pago: payment.id,
        fecha_venta: fechaHaceDias(order.daysAgo),
        subtotal: subtotal.toFixed(2),
        envio: envio.toFixed(2),
        total: (subtotal + envio).toFixed(2),
        estado: order.status,
        fecha_entrega: order.status === 'Entregada' ? fechaHaceDias(5) : null,
      }).$returningId();

      await tx.insert(DetalleVentas).values({
        id_venta: sale.id,
        id_producto: product.id,
        cantidad: order.quantity,
        precio_unitario: '699.00',
        subtotal: subtotal.toFixed(2),
      });

      if (order.status === 'Confirmada' || order.status === 'Entregada') {
        await tx.insert(MovimientosInventario).values({
          id_producto: product.id,
          tipo: 'Salida',
          cantidad: order.quantity,
          motivo: `Venta #${sale.id}`,
          fecha: fechaHaceDias(order.daysAgo),
          id_usuario: user.id,
        });
      }
    }

    console.log(`Se crearon ${demoOrders.length} órdenes demo y un producto aislado para pruebas.`);
  });
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('No se pudieron crear las órdenes de demostración:', error);
    process.exit(1);
  });
