// Abre un túnel de Cloudflare (gratis, sin cuenta) hacia el servidor de desarrollo para probar
// Mercado Pago con una URL pública https: así Mercado Pago regresa solo al cliente y manda sus
// avisos (webhooks). Uso:  npm run tunel   (con `npm run dev` corriendo en otra terminal)
//
// La URL *.trycloudflare.com cambia cada vez que se abre el túnel; no hace falta configurarla en
// ningún lado: la tienda usa la dirección con la que entra el cliente (ver urlSitio en lib/mercadoPago.ts).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const puerto = process.env.PORT || '4321';

function buscarCloudflared() {
  const candidatos = [
    'cloudflared',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'cloudflared', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ].filter(Boolean);
  return candidatos.find((c) => (c === 'cloudflared' ? spawnSync(c, ['--version']).status === 0 : existsSync(c)));
}

const cloudflared = buscarCloudflared();
if (!cloudflared) {
  console.error('No encontré cloudflared. Instálalo con:\n  winget install --id Cloudflare.cloudflared\n'
    + 'o descárgalo de https://github.com/cloudflare/cloudflared/releases y vuelve a correr npm run tunel.');
  process.exit(1);
}

console.log(`Abriendo túnel hacia http://localhost:${puerto} …`);
const tunel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${puerto}`]);

let anunciado = false;
const leer = (chunk) => {
  const texto = chunk.toString();
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(texto)?.[0];
  if (url && !anunciado) {
    anunciado = true;
    console.log(`\n  Tienda pública:  ${url}\n`);
    console.log('  Abre la tienda con esa URL (inicia sesión ahí) y paga con Mercado Pago:');
    console.log('  al terminar, Mercado Pago te regresará solo a la tienda.');
    console.log('  Deja esta terminal abierta mientras pruebas; Ctrl+C cierra el túnel.\n');
  }
  if (/ERR|error/i.test(texto) && !/Retrying|metrics/i.test(texto)) process.stderr.write(texto);
};
tunel.stdout.on('data', leer);
tunel.stderr.on('data', leer);
tunel.on('exit', (codigo) => process.exit(codigo ?? 0));
process.on('SIGINT', () => tunel.kill('SIGINT'));
