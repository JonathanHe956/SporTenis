# SporTenis

Tienda deportiva desarrollada con Astro para ofrecer productos y accesorios de tenis, pádel y otras disciplinas deportivas.

## Estado actual

Se corrigió un problema relacionado con los iconos de la interfaz. Por el momento, se utilizan palabras en su lugar como solución temporal mientras se implementan los iconos definitivos.

## Requisitos

- Node.js 22.12.0 o superior
- npm 11 o superior

## Instalación

Clona el repositorio y accede a la carpeta del proyecto:

```bash
git clone https://github.com/JonathanHe956/SporTenis.git
cd SporTenis
```

Instala las dependencias:

```bash
npm install
```

## Base de datos

El proyecto usa MySQL / MariaDB con Drizzle ORM. Crea la base `sportenis_db` y un archivo `.env` con `DATABASE_URL` (los detalles están en [MIGRATION.md](MIGRATION.md)).

Base nueva: crea todas las tablas del esquema y carga los datos de prueba.

```bash
npx drizzle-kit push
npx tsx db/seed.ts
```

Base existente: aplica una sola vez, y en orden, las migraciones que te falten.

```bash
mysql -u root -p sportenis_db < db/migrations/0001_scm_inventory.sql
mysql -u root -p sportenis_db < db/migrations/0002_pedidos_stock.sql
mysql -u root -p sportenis_db < db/migrations/0003_sesiones.sql
mysql -u root -p sportenis_db < db/migrations/0004_ordenes_erp.sql
mysql -u root -p sportenis_db < db/migrations/0005_historial_ordenes.sql
mysql -u root -p sportenis_db < db/migrations/0005_erp_settings.sql
mysql -u root -p sportenis_db < db/migrations/0006_facturas_pagos_reportes.sql
mysql -u root -p sportenis_db < db/migrations/0007_presupuestos_cxc_cxp.sql
mysql -u root -p sportenis_db < db/migrations/0008_monedero.sql
mysql -u root -p sportenis_db < db/migrations/0009_movimientos_monedero.sql
mysql -u root -p sportenis_db < db/migrations/0010_impuestos.sql
mysql -u root -p sportenis_db < db/migrations/0011_promociones.sql
mysql -u root -p sportenis_db < db/migrations/0012_factura_impuestos.sql
mysql -u root -p sportenis_db < db/migrations/0013_pago_monedero.sql
mysql -u root -p sportenis_db < db/migrations/0014_formas_pago.sql
mysql -u root -p sportenis_db < db/migrations/0015_direcciones_envio.sql
mysql -u root -p sportenis_db < db/migrations/0016_codigos_postales.sql
mysql -u root -p sportenis_db < db/migrations/0017_mercado_pago.sql
```

Ejecuta solo las migraciones que aún no hayas aplicado, en orden. La `0009` es necesaria para que funcionen las recargas y el historial del monedero, la `0010` crea la tabla de impuestos con el IVA al 16% y la `0011` las tablas de promociones (ambas se administran en `/scm/precios`). La `0012` guarda el desglose de impuestos de cada factura. El precio de cada producto ya incluye los impuestos: cambiar el IVA o agregar un impuesto solo cambia el desglose, no lo que se cobra. La `0013` agrega el método de pago Monedero: las compras de la tienda se pagan con el saldo del monedero (se bloquean si no alcanza) y se reembolsan al cancelarlas. La `0014` agrega tarjeta de crédito, tarjeta de débito y Mercado Pago como formas de pago en el carrito. Son **simulados**: no se cobra nada y de la tarjeta solo se guardan la marca y los últimos 4 dígitos. Tarjetas de prueba: `4242 4242 4242 4242` se aprueba, `4000 0000 0000 0002` se rechaza y `4000 0000 0000 9995` no tiene fondos (cualquier vencimiento futuro y CVV de 3 dígitos). La `0015` agrega las direcciones de envío: el cliente guarda varias en `/cuenta/direcciones` (una es la principal), elige una en el carrito antes de pagar y cada pedido guarda una copia de la dirección a la que se envió. La `0016` crea la tabla del catálogo de códigos postales y la `0017` la de los pagos con Mercado Pago.

### Catálogo de códigos postales

Los formularios de dirección eligen municipio y colonia del Catálogo Nacional de Códigos Postales de Correos de México (SEPOMEX). Después de aplicar la `0016`, cárgalo una vez (descarga ~2 MB y tarda unos segundos):

```bash
node db/importar-codigos-postales.mjs
```

El catálogo no está en el repositorio porque su licencia permite el uso particular pero no distribuirlo a terceros; el script lo descarga de la fuente oficial. Vuelve a correrlo cuando quieras actualizarlo.

### Mercado Pago (Checkout Pro)

El pago con Mercado Pago usa la pasarela oficial y el SDK `mercadopago`. Agrega a tu `.env` las credenciales de tu aplicación en [Mercado Pago Developers](https://www.mercadopago.com.mx/developers/panel/app) (usa las **de prueba** para desarrollar):

```bash
MP_ACCESS_TOKEN=TEST-...        # obligatorio; sin él la opción aparece como "No disponible"
MP_WEBHOOK_SECRET=...           # opcional: valida la firma de los avisos (webhooks)
SITE_URL=http://localhost:4321  # URL pública de la tienda (https en producción)
```

Para probarlo en local con regreso automático, abre un túnel público (Cloudflare, gratis y sin cuenta) en otra terminal mientras corre `npm run dev`:

```bash
npm run tunel
```

Muestra una URL `https://…trycloudflare.com`: entra a la tienda con esa URL (e inicia sesión ahí). Mercado Pago descarta las URLs de regreso de `localhost`, así que sin túnel hay que volver a la tienda a mano; aun así la compra se registra al abrir el carrito o "Mis compras". Requiere `cloudflared` (`winget install --id Cloudflare.cloudflared`).

El cliente paga en la página de Mercado Pago y regresa a `/checkout/mercadopago`; la compra se registra solo después de consultar el pago a la API de Mercado Pago. Con `SITE_URL` en https, Mercado Pago regresa solo al cliente y avisa por webhook a `/api/webhooks/mercadopago`. Si un pago aprobado no se puede registrar (por ejemplo, se agotó el stock), se reembolsa automáticamente.

### Usuarios de prueba

El seed crea un usuario por rol. La contraseña de los tres es `password123`.

| Rol | Correo | Secciones |
| :--- | :--- | :--- |
| Administrador | `admin@sportenis.com` | CRM, SCM y ERP completos, usuarios y configuración |
| Ventas | `ventas1@sportenis.com` | CRM, órdenes y reportes del ERP, consulta de productos |
| Logística | `logistica1@sportenis.com` | SCM, órdenes y reportes del ERP |

## Etapa 3: módulo ERP

El panel interno tiene tres secciones (CRM, SCM y ERP) y el menú muestra solo las páginas que el rol puede abrir; el middleware aplica el mismo permiso en el servidor.

- **Órdenes de clientes** (`/erp/ventas`, `/erp/ordenes`): se captura la orden con un cliente del CRM y productos del SCM. Nace en `Procesando`; al confirmarla se descuenta el stock, se registra la salida de inventario y el cambio queda en el historial, todo en una transacción. Cancelar una orden confirmada regresa el stock con un movimiento de entrada.
- **Reportes** (`/erp/reportes`): KPIs, ventas por mes, productos más vendidos, inventario por rotación y órdenes a proveedores recientes, con filtro por fechas. La rotación se mide por unidades vendidas en los últimos 30 días: alta con 5 o más, media de 1 a 4 y baja sin ventas.
- **Nivel ERP** (`/erp/implementacion`): cómo se integran CRM, ERP y SCM, y el checklist de avance por etapas (básico, integrado, optimizado y automatizado).
- **Dashboard** (`/erp`) y **Finanzas** (`/erp/finanzas`): resumen de órdenes e ingresos, y rentabilidad.
- La ficha de cada cliente en el CRM muestra sus órdenes, y "Mi actividad" las órdenes capturadas por el usuario.

Las pruebas unitarias se ejecutan con `npm test`.

## Desarrollo

Inicia el servidor de desarrollo:

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:4321`.

Para iniciar el servidor en segundo plano:

```bash
npm run dev -- --background
```

## Compilación y previsualización

Genera la versión optimizada para producción:

```bash
npm run build
```

Previsualiza la compilación localmente:

```bash
npm run preview
```

## Estructura del proyecto

```text
/
├── db/                     Esquema de Drizzle, seed y migraciones SQL
├── public/                 Archivos públicos y recursos estáticos
├── src/
│   ├── assets/             Recursos utilizados por la interfaz
│   ├── components/         Componentes Astro reutilizables
│   ├── db/                 Conexión a la base de datos y esquema
│   ├── layouts/            Plantillas generales de página
│   ├── lib/                Lógica de negocio (auth, carrito, ventas, monedero...)
│   ├── pages/              Rutas de la aplicación
│   └── middleware.ts       Sesión y permisos por rol en cada petición
├── tests/                  Pruebas unitarias (Vitest)
├── astro.config.mjs        Configuración de Astro
├── package.json            Dependencias y scripts del proyecto
└── tsconfig.json           Configuración de TypeScript
```

## Scripts disponibles

| Comando | Descripción |
| :--- | :--- |
| `npm install` | Instala las dependencias del proyecto. |
| `npm run dev` | Inicia el servidor de desarrollo. |
| `npm run build` | Genera la compilación de producción. |
| `npm run preview` | Previsualiza la compilación generada. |
| `npm test` | Ejecuta las pruebas unitarias con Vitest. |
| `npm run astro` | Ejecuta comandos de la CLI de Astro. |

## Tecnologías

- Astro 7
- TypeScript
- CSS
- MySQL / MariaDB con Drizzle ORM
- Chart.js

## Repositorio

El código fuente está disponible en [GitHub](https://github.com/JonathanHe956/SporTenis).
