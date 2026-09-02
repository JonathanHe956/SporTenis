import { int, varchar, text, decimal, boolean, datetime, mysqlTable } from 'drizzle-orm/mysql-core';

export const Roles = mysqlTable('Roles', {
  id: int('id').autoincrement().primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
});

export const EtapasCrm = mysqlTable('EtapasCrm', {
  id: int('id').autoincrement().primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
});

export const TiposInteraccion = mysqlTable('TiposInteraccion', {
  id: int('id').autoincrement().primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
});

export const MetodosPago = mysqlTable('MetodosPago', {
  id: int('id').autoincrement().primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
});

export const Marcas = mysqlTable('Marcas', {
  id: int('id').autoincrement().primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
});

export const Categorias = mysqlTable('Categorias', {
  id: int('id').autoincrement().primaryKey(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
});

export const Modelos = mysqlTable('Modelos', {
  id: int('id').autoincrement().primaryKey(),
  id_marca: int('id_marca').references(() => Marcas.id).notNull(),
  id_categoria: int('id_categoria').references(() => Categorias.id).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  descripcion: text('descripcion'),
  precio_base: decimal('precio_base', { precision: 10, scale: 2 }).notNull(),
});

export const Productos = mysqlTable('Productos', {
  id: int('id').autoincrement().primaryKey(),
  id_modelo: int('id_modelo').references(() => Modelos.id).notNull(),
  sku: varchar('sku', { length: 100 }).unique().notNull(),
  talla_cm: varchar('talla_cm', { length: 50 }),
  color: varchar('color', { length: 50 }),
  precio_venta: decimal('precio_venta', { precision: 10, scale: 2 }).notNull(),
  costo: decimal('costo', { precision: 10, scale: 2 }).notNull(),
  stock: int('stock').notNull(),
  estado: varchar('estado', { length: 100 }).notNull(),
  badge: varchar('badge', { length: 100 }),
  theme_class: varchar('theme_class', { length: 100 }),
});

export const Usuarios = mysqlTable('Usuarios', {
  id: int('id').autoincrement().primaryKey(),
  id_rol: int('id_rol').references(() => Roles.id).notNull(),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  correo: varchar('correo', { length: 255 }).unique().notNull(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  estado: varchar('estado', { length: 100 }).notNull(),
  fecha_creacion: datetime('fecha_creacion').notNull(),
});

export const Clientes = mysqlTable('Clientes', {
  id: int('id').autoincrement().primaryKey(),
  id_usuario: int('id_usuario').references(() => Usuarios.id),
  id_etapa_crm: int('id_etapa_crm').references(() => EtapasCrm.id),
  nombre: varchar('nombre', { length: 255 }).notNull(),
  empresa: varchar('empresa', { length: 255 }),
  correo: varchar('correo', { length: 255 }).unique().notNull(),
  telefono: varchar('telefono', { length: 50 }),
  estado: varchar('estado', { length: 100 }).notNull(),
  fecha_registro: datetime('fecha_registro').notNull(),
});

export const Direcciones = mysqlTable('Direcciones', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  tipo_direccion: varchar('tipo_direccion', { length: 100 }).notNull(),
  calle: varchar('calle', { length: 255 }).notNull(),
  colonia: varchar('colonia', { length: 255 }),
  ciudad: varchar('ciudad', { length: 255 }).notNull(),
  estado_provincia: varchar('estado_provincia', { length: 255 }).notNull(),
  cp: varchar('cp', { length: 20 }).notNull(),
  es_principal: boolean('es_principal').notNull(),
});

export const PreferenciasCliente = mysqlTable('PreferenciasCliente', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  talla_calzado_preferida: varchar('talla_calzado_preferida', { length: 50 }),
  id_marca_favorita: int('id_marca_favorita').references(() => Marcas.id),
});

export const Favoritos = mysqlTable('Favoritos', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  id_producto: int('id_producto').references(() => Productos.id).notNull(),
});

export const Interacciones = mysqlTable('Interacciones', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  id_usuario: int('id_usuario').references(() => Usuarios.id).notNull(),
  id_tipo_interaccion: int('id_tipo_interaccion').references(() => TiposInteraccion.id).notNull(),
  descripcion: text('descripcion').notNull(),
  fecha_hora: datetime('fecha_hora').notNull(),
});

export const Evaluaciones = mysqlTable('Evaluaciones', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  id_usuario: int('id_usuario').references(() => Usuarios.id).notNull(),
  calificacion: int('calificacion').notNull(),
  comentarios: text('comentarios'),
  fecha_evaluacion: datetime('fecha_evaluacion').notNull(),
});

export const TareasSeguimiento = mysqlTable('TareasSeguimiento', {
  id: int('id').autoincrement().primaryKey(),
  id_usuario: int('id_usuario').references(() => Usuarios.id).notNull(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  descripcion: text('descripcion').notNull(),
  fecha_vencimiento: datetime('fecha_vencimiento').notNull(),
  estado: varchar('estado', { length: 100 }).notNull(),
});

export const Carritos = mysqlTable('Carritos', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id),
  session_id: varchar('session_id', { length: 255 }).unique(),
  fecha_actualizacion: datetime('fecha_actualizacion').notNull(),
});

export const DetalleCarritos = mysqlTable('DetalleCarritos', {
  id: int('id').autoincrement().primaryKey(),
  id_carrito: int('id_carrito').references(() => Carritos.id).notNull(),
  id_producto: int('id_producto').references(() => Productos.id).notNull(),
  cantidad: int('cantidad').notNull(),
});

export const Ventas = mysqlTable('Ventas', {
  id: int('id').autoincrement().primaryKey(),
  id_cliente: int('id_cliente').references(() => Clientes.id).notNull(),
  id_usuario: int('id_usuario').references(() => Usuarios.id),
  id_metodo_pago: int('id_metodo_pago').references(() => MetodosPago.id).notNull(),
  fecha_venta: datetime('fecha_venta').notNull(),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
  envio: decimal('envio', { precision: 10, scale: 2 }).notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  cupon_descuento: varchar('cupon_descuento', { length: 100 }),
});

export const DetalleVentas = mysqlTable('DetalleVentas', {
  id: int('id').autoincrement().primaryKey(),
  id_venta: int('id_venta').references(() => Ventas.id).notNull(),
  id_producto: int('id_producto').references(() => Productos.id).notNull(),
  cantidad: int('cantidad').notNull(),
  precio_unitario: decimal('precio_unitario', { precision: 10, scale: 2 }).notNull(),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
});

export const Configuraciones = mysqlTable('Configuraciones', {
  id: int('id').autoincrement().primaryKey(),
  clave: varchar('clave', { length: 255 }).unique().notNull(),
  valor: text('valor').notNull(),
  descripcion: text('descripcion'),
});

export const LogsActividad = mysqlTable('LogsActividad', {
  id: int('id').autoincrement().primaryKey(),
  id_usuario: int('id_usuario').references(() => Usuarios.id).notNull(),
  accion: varchar('accion', { length: 255 }).notNull(),
  modulo_afectado: varchar('modulo_afectado', { length: 255 }).notNull(),
  id_registro_afectado: int('id_registro_afectado'),
  fecha_hora: datetime('fecha_hora').notNull(),
});
