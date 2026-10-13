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
```

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
├── public/                 Archivos públicos y recursos estáticos
├── src/
│   ├── assets/             Recursos utilizados por la interfaz
│   ├── components/         Componentes Astro reutilizables
│   ├── layouts/            Plantillas generales de página
│   └── pages/              Rutas de la aplicación
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
| `npm run astro` | Ejecuta comandos de la CLI de Astro. |

## Tecnologías

- Astro 7
- TypeScript
- CSS
- MySQL / MariaDB con Drizzle ORM
- Chart.js

## Repositorio

El código fuente está disponible en [GitHub](https://github.com/JonathanHe956/SporTenis).
