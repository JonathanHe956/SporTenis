# Guía de Migración: Astro DB a MySQL

Hemos reemplazado `@astrojs/db` (SQLite) por **Drizzle ORM** usando **MySQL / MariaDB**. Esto significa que ya no usaremos la base de datos local embebida `.astro/data.db`, sino un servidor real de MySQL.

Para que el proyecto te funcione localmente, debes realizar los siguientes pasos:

## 1. Actualizar dependencias
Ejecuta el siguiente comando para desinstalar Astro DB e instalar los nuevos paquetes (Drizzle ORM, MySQL2, dotenv):
```bash
npm install
```

## 2. Configurar la Base de Datos Local
Debes tener un servidor MySQL corriendo en tu computadora (puedes usar XAMPP, MAMP, Docker, o el instalador oficial de MySQL).
- **Usuario recomendado:** `root`
- **Base de datos a crear:** `sportenis_db`

1. Abre tu gestor de base de datos favorito (phpMyAdmin, DBeaver, TablePlus, etc.).
2. Crea una base de datos vacía llamada `sportenis_db`.
3. Para una base existente con las tablas principales ya creadas, aplica la migración SCM incluida:
	```bash
	mysql -u root -p sportenis_db < db/migrations/0001_scm_inventory.sql
	mysql -u root -p sportenis_db < db/migrations/0002_pedidos_stock.sql
	mysql -u root -p sportenis_db < db/migrations/0003_sesiones.sql
	```
	La primera migración crea de forma idempotente las tablas de movimientos, auditorías y configuración SCM. La segunda agrega a `PedidosCompra` las columnas de stock que usa el código; ejecútala una sola vez.
	La tercera crea la tabla `Sesiones`; sin ella no se puede iniciar sesión. Las contraseñas que ya existan en texto plano se convierten a hash la primera vez que cada usuario inicia sesión.
4. Para crear todas las tablas del esquema en una base nueva, ejecuta `npx drizzle-kit push` después de configurar `DATABASE_URL`.

## 3. Configurar tus variables de entorno (.env)
En la raíz del proyecto, debes crear un archivo `.env` basándote en `.env.example` (o crearlo tú mismo) con la ruta a tu MySQL local:
```env
# Ejemplo (modifica si tu contraseña de root no está vacía)
DATABASE_URL="mysql://root:@localhost:3306/sportenis_db"
```

## 4. Poblar la base de datos (Seed)
Para rellenar la base con los datos de prueba, ejecuta el script de seed:
```bash
npx tsx db/seed.ts
```

> **Nota:** El archivo `db/config.ts` ha sido eliminado. Nuestro nuevo esquema central vive en `src/db/schema.ts` y la conexión en `src/db/db.ts`.
