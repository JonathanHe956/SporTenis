// Envío de correos de la tienda por SMTP (nodemailer). Sirve con cualquier proveedor: Gmail con
// contraseña de aplicación, Brevo, Outlook, Mailtrap…
//
// Configuración en .env:
//   SMTP_HOST=smtp.gmail.com   SMTP_PORT=587   SMTP_USER=tu-correo@gmail.com   SMTP_PASS=contraseña-de-aplicacion
//   CORREO_REMITENTE="SporTenis <tu-correo@gmail.com>"   (opcional; por defecto SMTP_USER)
//   CORREO_SOPORTE=soporte@tu-dominio.com                 (opcional; recibe aviso de cada ticket nuevo)
//   SITE_URL=https://tu-tienda.com                        (para los enlaces de los correos)
//
// Sin SMTP_HOST no se envía nada: cada correo se guarda como .html en correos-salida/ (fuera de git)
// para revisarlo en el navegador mientras se desarrolla.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Correo {
  para: string;
  asunto: string;
  html: string;
  texto: string;
}

export const smtpConfigurado = (): boolean => Boolean(process.env.SMTP_HOST?.trim());

/** URL pública de la tienda para los enlaces de los correos. */
export const urlTienda = (ruta = ''): string =>
  `${(process.env.SITE_URL?.trim() || 'http://localhost:4321').replace(/\/+$/, '')}${ruta}`;

let transporte: Transporter | null = null;

const obtenerTransporte = (): Transporter => {
  if (transporte) return transporte;
  const puerto = Number(process.env.SMTP_PORT) || 587;
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    // 465 usa TLS directo; 587 empieza en claro y sube a TLS (STARTTLS)
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : puerto === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporte;
};

const remitente = (): string => process.env.CORREO_REMITENTE?.trim() || `SporTenis <${process.env.SMTP_USER ?? 'no-responder@sportenis.local'}>`;

const CORREO_VALIDO = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** Envía el correo (o lo guarda en correos-salida/ si no hay SMTP). Lanza si el proveedor lo rechaza. */
export async function enviarCorreo(correo: Correo): Promise<void> {
  if (!CORREO_VALIDO.test(correo.para)) throw new Error(`Dirección de correo no válida: ${correo.para}`);

  if (!smtpConfigurado()) {
    const carpeta = path.resolve('correos-salida');
    await mkdir(carpeta, { recursive: true });
    const nombre = `${new Date().toISOString().replace(/[:.]/g, '-')}-${correo.asunto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').slice(0, 50)}.html`;
    const encabezado = `<!-- Para: ${escaparHtml(correo.para)} | Asunto: ${escaparHtml(correo.asunto)} -->\n`;
    await writeFile(path.join(carpeta, nombre), encabezado + correo.html, 'utf-8');
    console.info(`[correo] Sin SMTP configurado: "${correo.asunto}" para ${correo.para} se guardó en correos-salida/${nombre}`);
    return;
  }

  await obtenerTransporte().sendMail({
    from: remitente(),
    to: correo.para,
    subject: correo.asunto,
    html: correo.html,
    text: correo.texto,
  });
}

/**
 * Manda el correo sin que un fallo afecte la operación que lo originó (una venta o una cancelación
 * no se revierten porque el servidor de correo no responda): el error solo queda en el log.
 */
export function enviarEnSegundoPlano(descripcion: string, tarea: () => Promise<Correo | Correo[] | null>): void {
  void (async () => {
    try {
      const correos = await tarea();
      for (const correo of [correos ?? []].flat()) await enviarCorreo(correo);
    } catch (error) {
      console.error(`[correo] No se pudo enviar "${descripcion}":`, error);
    }
  })();
}

export const escaparHtml = (texto: string): string =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Texto del usuario (mensajes, direcciones) escapado y con sus saltos de línea. */
export const parrafoSeguro = (texto: string): string => escaparHtml(texto).replace(/\n/g, '<br>');

/**
 * Plantilla común: encabezado amarillo con la marca, título, contenido y un botón opcional.
 * `contenidoHtml` ya debe venir escapado (usa escaparHtml / parrafoSeguro con lo que escribe el usuario).
 */
export function plantillaCorreo(opciones: {
  titulo: string;
  saludo?: string;
  contenidoHtml: string;
  boton?: { texto: string; url: string };
  pie?: string;
}): string {
  const { titulo, saludo, contenidoHtml, boton, pie } = opciones;
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f6f4ed;font-family:Arial,Helvetica,sans-serif;color:#171717;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ed;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf3;border:2px solid #171717;">
        <tr><td style="background:#f7d21c;padding:18px 24px;border-bottom:2px solid #171717;font-size:24px;font-weight:900;letter-spacing:-1px;">
          Spor<span style="font-weight:400;">Tenis</span>
        </td></tr>
        <tr><td style="padding:28px 24px 8px;">
          <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:400;line-height:1.2;">${escaparHtml(titulo)}</h1>
          ${saludo ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">${escaparHtml(saludo)}</p>` : ''}
          <div style="font-size:14px;line-height:1.6;">${contenidoHtml}</div>
          ${boton ? `<p style="margin:24px 0 8px;"><a href="${escaparHtml(boton.url)}" style="display:inline-block;background:#171717;color:#fffdf3;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.5px;text-transform:uppercase;padding:14px 22px;">${escaparHtml(boton.texto)}</a></p>` : ''}
        </td></tr>
        <tr><td style="padding:18px 24px 24px;color:#716e67;font-size:12px;line-height:1.5;border-top:1px dashed #d8d3c3;">
          ${pie ? `${escaparHtml(pie)}<br>` : ''}Este correo se envió automáticamente; por favor no lo respondas. Si necesitas ayuda, escríbenos desde <a href="${escaparHtml(urlTienda('/cuenta/soporte'))}" style="color:#171717;">Soporte</a> en tu cuenta.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Tabla de dos columnas (concepto / valor) para resúmenes de pedido. */
export function tablaResumen(filas: Array<[string, string]>, negritaUltima = false): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
    ${filas.map(([concepto, valor], i) => {
      const fuerte = negritaUltima && i === filas.length - 1;
      return `<tr><td style="padding:7px 0;border-bottom:1px solid #e8e4da;${fuerte ? 'font-weight:700;font-size:15px;' : 'color:#57534e;'}">${concepto}</td><td align="right" style="padding:7px 0;border-bottom:1px solid #e8e4da;font-weight:700;${fuerte ? 'font-size:15px;' : ''}">${valor}</td></tr>`;
    }).join('')}
  </table>`;
}
