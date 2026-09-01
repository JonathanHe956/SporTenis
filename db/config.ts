import { defineDb, defineTable, column } from 'astro:db';

// ==========================================
// 1. Catálogos del Sistema
// ==========================================

const Roles = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
  }
});

const EtapasCrm = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
  }
});

const TiposInteraccion = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
  }
});

const MetodosPago = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
  }
});

const Marcas = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
  }
});

const Categorias = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
  }
});

// ==========================================
// 2. Inventario y Calzado
// ==========================================

const Modelos = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_marca: column.number({ references: () => Marcas.columns.id }),
    id_categoria: column.number({ references: () => Categorias.columns.id }),
    nombre: column.text(),
    descripcion: column.text({ optional: true }),
    precio_base: column.number(),
  }
});

const Productos = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_modelo: column.number({ references: () => Modelos.columns.id }),
    sku: column.text({ unique: true }),
    talla_cm: column.text({ optional: true }),
    color: column.text({ optional: true }),
    precio_venta: column.number(),
    costo: column.number(),
    stock: column.number(),
    estado: column.text(),
    badge: column.text({ optional: true }), // ej. Oferta, Nuevo
    theme_class: column.text({ optional: true }), // ej. theme-padel
  }
});

// ==========================================
// 3. Usuarios y Clientes
// ==========================================

const Usuarios = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_rol: column.number({ references: () => Roles.columns.id }),
    nombre: column.text(),
    correo: column.text({ unique: true }),
    password_hash: column.text(),
    estado: column.text(),
    fecha_creacion: column.date(),
  }
});

const Clientes = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_usuario: column.number({ references: () => Usuarios.columns.id, optional: true }),
    id_etapa_crm: column.number({ references: () => EtapasCrm.columns.id, optional: true }),
    nombre: column.text(),
    empresa: column.text({ optional: true }),
    correo: column.text({ unique: true }),
    telefono: column.text({ optional: true }),
    estado: column.text(),
    fecha_registro: column.date(),
  }
});

const Direcciones = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    tipo_direccion: column.text(),
    calle: column.text(),
    colonia: column.text({ optional: true }),
    ciudad: column.text(),
    estado_provincia: column.text(),
    cp: column.text(),
    es_principal: column.boolean(),
  }
});

const PreferenciasCliente = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    talla_calzado_preferida: column.text({ optional: true }),
    id_marca_favorita: column.number({ references: () => Marcas.columns.id, optional: true }),
  }
});

const Favoritos = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    id_producto: column.number({ references: () => Productos.columns.id }),
  }
});

// ==========================================
// 4. Seguimiento CRM
// ==========================================

const Interacciones = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    id_usuario: column.number({ references: () => Usuarios.columns.id }),
    id_tipo_interaccion: column.number({ references: () => TiposInteraccion.columns.id }),
    descripcion: column.text(),
    fecha_hora: column.date(),
  }
});

const Evaluaciones = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    id_usuario: column.number({ references: () => Usuarios.columns.id }),
    calificacion: column.number(), // ej. 1 a 5
    comentarios: column.text({ optional: true }),
    fecha_evaluacion: column.date(),
  }
});

const TareasSeguimiento = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_usuario: column.number({ references: () => Usuarios.columns.id }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    descripcion: column.text(),
    fecha_vencimiento: column.date(),
    estado: column.text(),
  }
});

// ==========================================
// 5. Transacciones (Carrito y Ventas)
// ==========================================

const Carritos = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id, optional: true }),
    session_id: column.text({ unique: true, optional: true }),
    fecha_actualizacion: column.date(),
  }
});

const DetalleCarritos = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_carrito: column.number({ references: () => Carritos.columns.id }),
    id_producto: column.number({ references: () => Productos.columns.id }),
    cantidad: column.number(),
  }
});

const Ventas = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_cliente: column.number({ references: () => Clientes.columns.id }),
    id_usuario: column.number({ references: () => Usuarios.columns.id, optional: true }),
    id_metodo_pago: column.number({ references: () => MetodosPago.columns.id }),
    fecha_venta: column.date(),
    subtotal: column.number(),
    envio: column.number(),
    total: column.number(),
    cupon_descuento: column.text({ optional: true }),
  }
});

const DetalleVentas = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_venta: column.number({ references: () => Ventas.columns.id }),
    id_producto: column.number({ references: () => Productos.columns.id }),
    cantidad: column.number(),
    precio_unitario: column.number(),
    subtotal: column.number(),
  }
});

// ==========================================
// 6. Sistema y Auditoría
// ==========================================

const Configuraciones = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    clave: column.text({ unique: true }),
    valor: column.text(),
    descripcion: column.text({ optional: true }),
  }
});

const LogsActividad = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    id_usuario: column.number({ references: () => Usuarios.columns.id }),
    accion: column.text(),
    modulo_afectado: column.text(),
    id_registro_afectado: column.number({ optional: true }),
    fecha_hora: column.date(),
  }
});

// https://astro.build/db/config
export default defineDb({
  tables: {
    Roles,
    EtapasCrm,
    TiposInteraccion,
    MetodosPago,
    Marcas,
    Categorias,
    Modelos,
    Productos,
    Usuarios,
    Clientes,
    Direcciones,
    PreferenciasCliente,
    Favoritos,
    Interacciones,
    Evaluaciones,
    TareasSeguimiento,
    Carritos,
    DetalleCarritos,
    Ventas,
    DetalleVentas,
    Configuraciones,
    LogsActividad,
  }
});
