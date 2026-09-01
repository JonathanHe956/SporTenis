import { db, Categorias, Marcas, Modelos, Productos, Roles, Usuarios, EtapasCrm, Clientes, TiposInteraccion, Interacciones } from 'astro:db';

export default async function () {
  // ==============================
  // 1. INVENTARIO Y CATÁLOGOS E-COMMERCE
  // ==============================

  const categorias = await db.insert(Categorias).values([
    { id: 1, nombre: 'Tenis' },
    { id: 2, nombre: 'Pádel' },
    { id: 3, nombre: 'Running' },
    { id: 4, nombre: 'Ropa' },
    { id: 5, nombre: 'Accesorios' },
    { id: 6, nombre: 'Novedades' }
  ]).returning();

  const marcas = await db.insert(Marcas).values([
    { id: 1, nombre: 'SporTenis Original' },
    { id: 2, nombre: 'ProGear' },
    { id: 3, nombre: 'AeroCourt' }
  ]).returning();

  const modelos = await db.insert(Modelos).values([
    { id: 1, id_marca: 2, id_categoria: 2, nombre: 'Pala Pro Carbon', descripcion: 'Potencia y control para elevar tu juego.', precio_base: 2499 },
    { id: 2, id_marca: 3, id_categoria: 1, nombre: 'Court Air 2.0', descripcion: 'Amortiguación ligera y estabilidad.', precio_base: 1899 },
    { id: 3, id_marca: 1, id_categoria: 4, nombre: 'Player Tee', descripcion: 'Tela transpirable para el partido.', precio_base: 699 }
  ]).returning();

  await db.insert(Productos).values([
    { id: 1, id_modelo: 1, sku: 'PAL-PRO-C-NG-AM', color: 'Negro / Amarillo', precio_venta: 2499, costo: 1200, stock: 15, estado: 'activo', badge: 'Oferta', theme_class: 'product-padel' },
    { id: 2, id_modelo: 1, sku: 'PAL-PRO-C-CB-RJ', color: 'Carbono / Rojo', precio_venta: 2499, costo: 1200, stock: 8, estado: 'activo', badge: 'Oferta', theme_class: 'product-padel' },
    { id: 3, id_modelo: 2, sku: 'SHO-CA2-BL-RJ-27', talla_cm: '27.5', color: 'Blanco / Rojo', precio_venta: 1899, costo: 900, stock: 22, estado: 'activo', badge: 'Top ventas', theme_class: 'product-shoe' },
    { id: 4, id_modelo: 2, sku: 'SHO-CA2-NG-AM-28', talla_cm: '28.5', color: 'Negro / Amarillo', precio_venta: 1899, costo: 900, stock: 10, estado: 'activo', badge: 'Top ventas', theme_class: 'product-shoe' },
    { id: 5, id_modelo: 3, sku: 'TSH-PLY-BL-M', talla_cm: 'M', color: 'Blanco', precio_venta: 699, costo: 300, stock: 50, estado: 'activo', badge: 'Nuevo', theme_class: 'product-shirt' }
  ]);

  // ==============================
  // 2. DATOS CRM (Usuarios, Clientes, Interacciones)
  // ==============================

  await db.insert(Roles).values([
    { id: 1, nombre: 'Admin' },
    { id: 2, nombre: 'Vendedor' },
    { id: 3, nombre: 'Cliente' }
  ]);

  await db.insert(EtapasCrm).values([
    { id: 1, nombre: 'Prospecto' },
    { id: 2, nombre: 'Activo' },
    { id: 3, nombre: 'Frecuente' },
    { id: 4, nombre: 'Inactivo' }
  ]);

  await db.insert(TiposInteraccion).values([
    { id: 1, nombre: 'Llamada' },
    { id: 2, nombre: 'Correo' },
    { id: 3, nombre: 'Reunión' }
  ]);

  const fechaHoy = new Date();

  await db.insert(Usuarios).values([
    { id: 1, id_rol: 1, nombre: 'Admin', correo: 'admin@sportenis.com', password_hash: 'password123', estado: 'activo', fecha_creacion: fechaHoy },
    { id: 2, id_rol: 2, nombre: 'Vendedor 1', correo: 'ventas1@sportenis.com', password_hash: 'password123', estado: 'activo', fecha_creacion: fechaHoy }
  ]);

  await db.insert(Clientes).values([
    { id: 1, id_etapa_crm: 2, nombre: 'Club Valle Verde', empresa: 'Valle Verde Tenis', correo: 'contacto@valleverde.com', telefono: '555-123-4567', estado: 'Activo', fecha_registro: new Date('2024-04-12') },
    { id: 2, id_etapa_crm: 1, nombre: 'Diego Ramírez', empresa: 'Academia ProPádel', correo: 'diego@propadel.mx', telefono: '555-987-6543', estado: 'Activo', fecha_registro: fechaHoy },
    { id: 3, id_etapa_crm: 3, nombre: 'Laura Gómez', empresa: 'Liga Regional Sur', correo: 'laura.gomez@ligasur.mx', telefono: '555-456-7890', estado: 'Activo', fecha_registro: fechaHoy },
    { id: 4, id_etapa_crm: 4, nombre: 'Roberto Silva', empresa: 'Deportivo Centro', correo: 'rsilva@deportivocentro.com', telefono: '555-321-6547', estado: 'Inactivo', fecha_registro: fechaHoy },
    { id: 5, id_etapa_crm: 2, nombre: 'Andrea Navarro', empresa: 'Torneo Abierto CDMX', correo: 'andrea@abiertocdmx.com', telefono: '555-654-3210', estado: 'Activo', fecha_registro: fechaHoy }
  ]);

  await db.insert(Interacciones).values([
    { id: 1, id_cliente: 1, id_usuario: 1, id_tipo_interaccion: 1, descripcion: 'Se discutió la renovación de pelotas y raquetas para la próxima temporada del club.', fecha_hora: new Date('2025-05-15T10:30:00Z') },
    { id: 2, id_cliente: 1, id_usuario: 1, id_tipo_interaccion: 2, descripcion: 'Envío de catálogo con los nuevos modelos de Court Air 2.0.', fecha_hora: new Date('2025-05-10T14:20:00Z') },
    { id: 3, id_cliente: 1, id_usuario: 2, id_tipo_interaccion: 3, descripcion: 'Reunión en las canchas para probar las nuevas palas de carbono.', fecha_hora: new Date('2025-05-02T11:00:00Z') },
    { id: 4, id_cliente: 2, id_usuario: 1, id_tipo_interaccion: 2, descripcion: 'Envío de cotización especial para la academia de pádel (mayoreo).', fecha_hora: new Date('2025-05-14T09:00:00Z') },
    { id: 5, id_cliente: 4, id_usuario: 2, id_tipo_interaccion: 1, descripcion: 'Llamada de seguimiento por un pedido atrasado de cuerdas.', fecha_hora: new Date('2025-05-08T16:00:00Z') }
  ]);

  console.log('Base de datos inicializada con éxito (E-Commerce + CRM).');
}
