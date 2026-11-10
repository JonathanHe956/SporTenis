// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  // Túnel de Cloudflare para probar Mercado Pago en local (npm run tunel): da una URL pública https
  // *.trycloudflare.com que reenvía a localhost. Mercado Pago solo regresa al cliente y manda sus
  // avisos (webhooks) a direcciones públicas con https.
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  security: {
    // Confía en el host y el https que reporta el túnel, para que Astro.url sea la dirección pública
    allowedDomains: [{ hostname: '*.trycloudflare.com', protocol: 'https' }],
  },
});
