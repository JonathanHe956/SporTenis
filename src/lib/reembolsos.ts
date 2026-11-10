// A dónde regresa el dinero cuando se cancela un pedido. Lo usan la cancelación (/erp/ordenes y la
// aprobación desde un ticket), el detalle del pedido del cliente y el correo de cancelación.
//   - Monedero: el importe vuelve al saldo del cliente al instante.
//   - Tarjeta de crédito o débito: se reembolsa a la misma tarjeta (marca y últimos 4 dígitos).
//   - Mercado Pago: se devuelve con la API de Mercado Pago al medio con el que pagó.
//   - Pedido que nunca se cobró (cancelado en Procesando): no hay nada que devolver.
import { METODO_MONEDERO } from './monedero';

export type TipoReembolso = 'monedero' | 'tarjeta' | 'mercado_pago' | 'otro' | 'sin_cargo';

export interface Reembolso {
  tipo: TipoReembolso;
  monto: number;
  /** Texto para el cliente (detalle del pedido, ticket y correo). */
  mensaje: string;
  /** Texto corto para el personal que cancela la orden. */
  avisoPersonal: string;
}

const pesos = (monto: number): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);

export function describirReembolso(pago: {
  metodo: string | null;
  /** Referencia guardada con el cobro, p. ej. "Visa •••• 4242" o "Mercado Pago #123". */
  referencia: string | null;
  monto: number;
  /** El pedido llegó a cobrarse (tiene pago registrado). */
  cobrado: boolean;
}): Reembolso {
  const { metodo, referencia, monto } = pago;
  if (!pago.cobrado) {
    return {
      tipo: 'sin_cargo',
      monto: 0,
      mensaje: 'No se realizó ningún cargo por este pedido, así que no hay nada que reembolsar.',
      avisoPersonal: 'La orden no se había cobrado: no hay nada que devolver.',
    };
  }

  if (metodo === METODO_MONEDERO) {
    return {
      tipo: 'monedero',
      monto,
      mensaje: `Te regresamos ${pesos(monto)} a tu monedero SporTenis. Ya puedes usarlos en tu próxima compra.`,
      avisoPersonal: `Se regresaron ${pesos(monto)} al monedero del cliente.`,
    };
  }

  if (metodo && /tarjeta/i.test(metodo)) {
    const tarjeta = referencia ? `tu tarjeta ${referencia}` : 'la tarjeta con la que pagaste';
    return {
      tipo: 'tarjeta',
      monto,
      mensaje: `El reembolso de ${pesos(monto)} se hará a ${tarjeta}. Puede tardar de 5 a 10 días hábiles en verse reflejado, según tu banco.`,
      avisoPersonal: `El reembolso de ${pesos(monto)} va a ${referencia ? `la tarjeta ${referencia}` : 'la tarjeta del cliente'}.`,
    };
  }

  if (metodo === 'Mercado Pago') {
    return {
      tipo: 'mercado_pago',
      monto,
      mensaje: `Te devolvimos ${pesos(monto)} en Mercado Pago, al mismo medio con el que pagaste. Si pagaste con tarjeta, puede tardar unos días en reflejarse.`,
      avisoPersonal: `Se devolvieron ${pesos(monto)} en Mercado Pago.`,
    };
  }

  // Ventas capturadas por el personal con otros métodos (efectivo, transferencia…)
  const medio = metodo ? ` (${metodo})` : '';
  return {
    tipo: 'otro',
    monto,
    mensaje: `Te reembolsaremos ${pesos(monto)} por el mismo medio con el que pagaste${medio}.`,
    avisoPersonal: `Devuelve ${pesos(monto)} al cliente por el mismo medio con el que pagó${medio}.`,
  };
}
