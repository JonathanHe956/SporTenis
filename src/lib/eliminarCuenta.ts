// "Borrar mi cuenta" desde el perfil del cliente. No se borran los registros: pedidos, facturas y pagos
// los necesita el ERP (y las llaves foráneas no dejan borrarlos). En una sola transacción:
//   - se borra lo personal que no es historial: direcciones, favoritos, carrito, preferencias, tickets
//     de soporte y sesiones;
//   - si tiene saldo en el monedero se retira (queda en cero con un movimiento "Retiro") y el
//     administrador recibe una notificación para devolvérselo: las recargas no guardan con qué se
//     pagaron, así que la devolución la hace el equipo;
//   - el usuario y su ficha de cliente se anonimizan ("Cliente eliminado", correo eliminado-<id>@…invalid)
//     y quedan inactivos, así ya no se puede iniciar sesión;
//   - las copias de la dirección en pedidos y pagos de Mercado Pago se reemplazan por un texto genérico;
//   - el correo queda libre para registrarse de nuevo como una cuenta nueva.
// Al terminar se le manda al cliente (a su correo de antes) la confirmación con el saldo a devolver.
// Se bloquea mientras tenga un pedido en curso o un pago de Mercado Pago pendiente.
import { randomBytes } from 'node:crypto';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/db';
import {
  Carritos,
  CheckoutsMercadoPago,
  Clientes,
  DetalleCarritos,
  Direcciones,
  Favoritos,
  Monederos,
  MovimientosMonedero,
  Notificaciones,
  PreferenciasCliente,
  Sesiones,
  Tickets,
  Usuarios,
  Ventas,
} from '../db/schema';
import { avisarCuentaEliminada } from './avisosCorreo';
import { esTablaInexistente } from './dbErrores';
import { NOTIF_DEVOLUCION_MONEDERO } from './notificaciones';
import { hashPassword } from './password';

export class CuentaError extends Error {}

export const NOMBRE_ELIMINADO = 'Cliente eliminado';
export const DIRECCION_ELIMINADA = 'Dirección eliminada a petición del cliente';

/** Correo de reemplazo: único por tabla y en un dominio reservado que nunca recibe correo. */
export const correoEliminado = (id: number): string => `eliminado-${id}@sportenis.invalid`;

// Pedidos que todavía se van a surtir o cancelar
const ESTADOS_EN_CURSO = ['Procesando', 'Confirmada'];
// La preferencia de Mercado Pago vence en 1 hora; un pago más viejo sin confirmar ya no llega
const VENTANA_PAGO_MP_MS = 2 * 60 * 60 * 1000;

const pesos = (monto: number): string => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);

/** Por qué no se puede eliminar la cuenta todavía, o null si sí se puede. */
export function motivoParaNoEliminar(estado: { pedidosEnCurso: number; pagosPendientes: number }): string | null {
  if (estado.pedidosEnCurso > 0) {
    const n = estado.pedidosEnCurso;
    return `Tienes ${n === 1 ? 'un pedido en curso' : `${n} pedidos en curso`}. Podrás eliminar tu cuenta cuando ${n === 1 ? 'se entregue o lo canceles' : 'se entreguen o los canceles'}.`;
  }
  if (estado.pagosPendientes > 0) {
    return 'Tienes un pago con Mercado Pago en proceso. Espera a que se confirme o se cancele para eliminar tu cuenta.';
  }
  return null;
}

/** Aviso para el administrador: a quién y cuánto devolver (exportado para las pruebas). */
export function notificacionDevolucion(idCliente: number, cliente: { nombre: string; correo: string }, saldo: number) {
  return {
    tipo: NOTIF_DEVOLUCION_MONEDERO,
    titulo: `💸 Devolver ${pesos(saldo)} de monedero · Cliente #${idCliente}`,
    mensaje: `${cliente.nombre} eliminó su cuenta con ${pesos(saldo)} en su monedero. Devuélvele el saldo y escríbele a ${cliente.correo} (ya le avisamos por correo que lo contactaremos).`.slice(0, 500),
    leida: false,
    fecha_creacion: new Date(),
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function pagosMercadoPagoPendientes(tx: Tx, idCliente: number): Promise<number> {
  try {
    const filas = await tx.select({ id: CheckoutsMercadoPago.id }).from(CheckoutsMercadoPago).where(and(
      eq(CheckoutsMercadoPago.id_cliente, idCliente),
      inArray(CheckoutsMercadoPago.estado, ['pendiente', 'procesando']),
      gt(CheckoutsMercadoPago.fecha_creacion, new Date(Date.now() - VENTANA_PAGO_MP_MS)),
    ));
    return filas.length;
  } catch (error) {
    if (esTablaInexistente(error)) return 0;
    throw error;
  }
}

/** Saldo del monedero que se puede devolver si el cliente elimina su cuenta (para mostrarlo en el perfil). */
export async function saldoPorDevolver(idUsuario: number): Promise<number> {
  const [fila] = await db.select({ saldo: Monederos.saldo }).from(Monederos)
    .innerJoin(Clientes, eq(Monederos.id_cliente, Clientes.id))
    .where(eq(Clientes.id_usuario, idUsuario));
  return Number(fila?.saldo ?? 0);
}

/**
 * Borra los datos personales del cliente, retira su saldo y deja su cuenta anonimizada e inactiva.
 * Lanza CuentaError si aún no se puede. Devuelve el saldo que se le devolverá.
 */
export async function eliminarCuentaCliente(idUsuario: number): Promise<{ saldoDevuelto: number }> {
  // Contraseña imposible de adivinar: la cuenta inactiva ya no entra, esto es una segunda barrera
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));

  const resultado = await db.transaction(async (tx) => {
    // Nombre y correo de antes de anonimizar: a ese correo va la confirmación
    const [usuario] = await tx.select({ nombre: Usuarios.nombre, correo: Usuarios.correo }).from(Usuarios).where(eq(Usuarios.id, idUsuario));
    if (!usuario) throw new CuentaError('No encontramos tu cuenta.');

    // Bloquear la fila del cliente evita que una compra o una recarga se cuele a media eliminación
    const [cliente] = await tx.select({ id: Clientes.id }).from(Clientes).where(eq(Clientes.id_usuario, idUsuario)).for('update');
    let saldoDevuelto = 0;

    if (cliente) {
      const id = cliente.id;
      const enCurso = await tx.select({ id: Ventas.id }).from(Ventas)
        .where(and(eq(Ventas.id_cliente, id), inArray(Ventas.estado, ESTADOS_EN_CURSO)));
      const motivo = motivoParaNoEliminar({ pedidosEnCurso: enCurso.length, pagosPendientes: await pagosMercadoPagoPendientes(tx, id) });
      if (motivo) throw new CuentaError(motivo);

      // Saldo del monedero: se retira y el administrador hace la devolución
      const [monedero] = await tx.select({ id: Monederos.id, saldo: Monederos.saldo }).from(Monederos).where(eq(Monederos.id_cliente, id)).for('update');
      saldoDevuelto = Number(monedero?.saldo ?? 0);
      if (monedero && saldoDevuelto > 0) {
        await tx.update(Monederos).set({ saldo: '0.00' }).where(eq(Monederos.id, monedero.id));
        await tx.insert(MovimientosMonedero).values({ id_monedero: monedero.id, tipo: 'Retiro', monto: saldoDevuelto.toFixed(2), fecha: new Date() });
        await tx.insert(Notificaciones).values(notificacionDevolucion(id, usuario, saldoDevuelto));
      }

      // Datos personales que no son historial
      const carritos = await tx.select({ id: Carritos.id }).from(Carritos).where(eq(Carritos.id_cliente, id));
      if (carritos.length > 0) await tx.delete(DetalleCarritos).where(inArray(DetalleCarritos.id_carrito, carritos.map((c) => c.id)));
      await tx.delete(Carritos).where(eq(Carritos.id_cliente, id));
      await tx.delete(Favoritos).where(eq(Favoritos.id_cliente, id));
      await tx.delete(PreferenciasCliente).where(eq(PreferenciasCliente.id_cliente, id));
      // Los pedidos que apuntaban a estas direcciones quedan con id_direccion en null (ON DELETE SET NULL)
      await tx.delete(Direcciones).where(eq(Direcciones.id_cliente, id));
      try {
        // Los mensajes pueden traer datos personales; se borran en cascada con el ticket
        await tx.delete(Tickets).where(eq(Tickets.id_cliente, id));
      } catch (error) {
        if (!esTablaInexistente(error)) throw error;
      }

      // Copias de la dirección (nombre, teléfono y domicilio) en el historial
      await tx.update(Ventas).set({ direccion_envio: DIRECCION_ELIMINADA }).where(eq(Ventas.id_cliente, id));
      try {
        await tx.update(CheckoutsMercadoPago).set({ direccion_envio: DIRECCION_ELIMINADA }).where(eq(CheckoutsMercadoPago.id_cliente, id));
      } catch (error) {
        if (!esTablaInexistente(error)) throw error;
      }

      await tx.update(Clientes).set({
        nombre: NOMBRE_ELIMINADO,
        empresa: null,
        correo: correoEliminado(id),
        telefono: null,
        estado: 'Inactivo',
        recibe_promociones: false,
        token_baja: null,
      }).where(eq(Clientes.id, id));
    }

    await tx.update(Usuarios).set({
      nombre: NOMBRE_ELIMINADO,
      correo: correoEliminado(idUsuario),
      password_hash: passwordHash,
      estado: 'inactivo',
    }).where(eq(Usuarios.id, idUsuario));
    await tx.delete(Sesiones).where(eq(Sesiones.id_usuario, idUsuario));

    return { usuario, saldoDevuelto };
  });

  avisarCuentaEliminada(resultado.usuario, resultado.saldoDevuelto);
  return { saldoDevuelto: resultado.saldoDevuelto };
}
