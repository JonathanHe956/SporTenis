// Formas de pago de la tienda. Las tarjetas son SIMULADAS: se valida lo que se capturaría en un
// pago real, pero no se cobra nada ni se contacta a ningún banco. Mercado Pago es real (Checkout Pro,
// ver src/lib/mercadoPago.ts) y no pasa por aquí: su venta se registra al confirmar el pago con su API.
// Nunca se guarda el número completo de la tarjeta ni el CVV: solo la marca y los últimos 4 dígitos.
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { MetodosPago } from '../db/schema';
import { METODO_MONEDERO } from './monedero';

export const FORMAS_PAGO = {
  monedero: METODO_MONEDERO,
  tarjeta_credito: 'Tarjeta de crédito',
  tarjeta_debito: 'Tarjeta de débito',
  mercado_pago: 'Mercado Pago',
} as const;

export type FormaPago = keyof typeof FORMAS_PAGO;

export const esFormaPago = (valor: unknown): valor is FormaPago =>
  typeof valor === 'string' && Object.hasOwn(FORMAS_PAGO, valor);

/** Error del pago cuyo mensaje se puede mostrar al cliente; 402 = el pago fue rechazado. */
export class PagoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PagoError';
    this.status = status;
  }
}

// ── Tarjetas ─────────────────────────────────────────────────────────

export type MarcaTarjeta = 'Visa' | 'Mastercard' | 'American Express';

export interface DatosTarjeta {
  numero: string;
  titular: string;
  vencimiento: string;
  cvv: string;
}

/**
 * Tarjetas de prueba (como las de las pasarelas reales) para ver un pago rechazado.
 * Cualquier otra tarjeta válida se aprueba.
 */
export const TARJETAS_RECHAZADAS: Readonly<Record<string, string>> = {
  '4000000000000002': 'El banco rechazó la tarjeta. Intenta con otra forma de pago.',
  '4000000000009995': 'Fondos insuficientes en la tarjeta.',
};

export const marcaTarjeta = (numero: string): MarcaTarjeta | null => {
  if (/^4/.test(numero)) return 'Visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(numero)) return 'Mastercard';
  if (/^3[47]/.test(numero)) return 'American Express';
  return null;
};

/** Algoritmo de Luhn: el dígito verificador con el que todas las tarjetas detectan errores de captura. */
export const pasaLuhn = (numero: string): boolean => {
  let suma = 0;
  for (let i = 0; i < numero.length; i++) {
    let digito = Number(numero[numero.length - 1 - i]);
    if (i % 2 === 1) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    suma += digito;
  }
  return numero.length > 0 && suma % 10 === 0;
};

/** Valida la tarjeta capturada; devuelve solo lo que se puede guardar (marca y últimos 4). */
export function validarTarjeta(
  datos: Partial<DatosTarjeta> | undefined,
  fechaActual: Date = new Date(),
): { marca: MarcaTarjeta; ultimos4: string; numero: string } {
  const numero = String(datos?.numero ?? '').replace(/[\s-]/g, '');
  const titular = String(datos?.titular ?? '').trim();
  const vencimiento = String(datos?.vencimiento ?? '').trim();
  const cvv = String(datos?.cvv ?? '').trim();

  const marca = marcaTarjeta(numero);
  const largoEsperado = marca === 'American Express' ? 15 : 16;
  if (!/^\d+$/.test(numero) || !marca || numero.length !== largoEsperado || !pasaLuhn(numero)) {
    throw new PagoError('El número de tarjeta no es válido.');
  }
  if (titular.length < 3) throw new PagoError('Escribe el nombre del titular como aparece en la tarjeta.');

  const venc = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/.exec(vencimiento);
  if (!venc) throw new PagoError('La fecha de vencimiento debe tener el formato MM/AA.');
  // La tarjeta es válida hasta el último día de su mes de vencimiento
  const finDeVigencia = new Date(2000 + Number(venc[2]), Number(venc[1]), 1);
  if (finDeVigencia.getTime() <= fechaActual.getTime()) throw new PagoError('La tarjeta está vencida.');

  const largoCvv = marca === 'American Express' ? 4 : 3;
  if (!new RegExp(`^\\d{${largoCvv}}$`).test(cvv)) {
    throw new PagoError(`El código de seguridad debe tener ${largoCvv} dígitos.`);
  }

  return { marca, ultimos4: numero.slice(-4), numero };
}

// ── Autorización simulada ────────────────────────────────────────────

export interface PagoAutorizado {
  forma: FormaPago;
  /** Lo que se guarda y se muestra en el ticket, p. ej. "Visa •••• 4242" o "Mercado Pago #A1B2C3". */
  referencia: string | null;
}

/**
 * Autoriza (de forma simulada) el cobro antes de registrar la venta. El monedero no se autoriza
 * aquí: se cobra dentro de la transacción de la venta, donde se revisa el saldo.
 * Con una pasarela real, aquí se crearía el cargo y se capturaría al confirmar la venta.
 */
export function autorizarPago(forma: FormaPago, body: Record<string, unknown>): PagoAutorizado {
  if (forma === 'monedero') return { forma, referencia: null };

  if (forma === 'mercado_pago') {
    // El navegador nunca puede decir "ya pagué": la venta sale de procesarPagoMercadoPago
    throw new PagoError('Mercado Pago se paga en su página: usa "Continuar a Mercado Pago".');
  }

  const tarjeta = validarTarjeta(body.tarjeta as Partial<DatosTarjeta> | undefined);
  const rechazo = TARJETAS_RECHAZADAS[tarjeta.numero];
  if (rechazo) throw new PagoError(rechazo, 402);
  if (forma === 'tarjeta_debito' && tarjeta.marca === 'American Express') {
    throw new PagoError('American Express solo se acepta como tarjeta de crédito.');
  }
  return { forma, referencia: `${tarjeta.marca} •••• ${tarjeta.ultimos4}` };
}

/** Id en MetodosPago de la forma de pago; la crea si la base aún no la tiene (la migración 0014 las da de alta). */
export async function idMetodoPago(forma: FormaPago): Promise<number> {
  const nombre = FORMAS_PAGO[forma];
  const [existente] = await db.select({ id: MetodosPago.id }).from(MetodosPago).where(eq(MetodosPago.nombre, nombre));
  if (existente) return existente.id;
  const [res] = await db.insert(MetodosPago).values({ nombre });
  return Number(res.insertId);
}
