import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import 'dotenv/config';

const globalForDb = globalThis as unknown as {
  conn: mysql.Pool | undefined;
  hasListeners: boolean | undefined;
};

const connection = globalForDb.conn ?? mysql.createPool({
  uri: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db',
});

if (process.env.NODE_ENV !== 'production') {
  globalForDb.conn = connection;
  
  // Apagar la conexión a la base de datos limpiamente cuando se cierra el servidor
  if (!globalForDb.hasListeners) {
    const closePool = async () => {
      if (globalForDb.conn) {
        try {
          await globalForDb.conn.end();
          console.log('\n[Conexiones a MySQL cerradas correctamente]');
        } catch (e) {}
      }
      process.exit(0);
    };
    process.on('SIGINT', closePool);
    process.on('SIGTERM', closePool);
    globalForDb.hasListeners = true;
  }
}

export const db = drizzle(connection, { schema, mode: 'default' });
