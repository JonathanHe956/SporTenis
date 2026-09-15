import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import 'dotenv/config';

const globalForDb = globalThis as unknown as {
  conn: mysql.Pool | undefined;
};

const connection = globalForDb.conn ?? mysql.createPool({
  uri: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db',
});

if (process.env.NODE_ENV !== 'production') {
  globalForDb.conn = connection;
}

export const db = drizzle(connection, { schema, mode: 'default' });
