import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import 'dotenv/config';

const connection = mysql.createPool({
  uri: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/sportenis_db',
});

export const db = drizzle(connection, { schema, mode: 'default' });
