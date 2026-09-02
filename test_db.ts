import { db } from './src/db/db.js';
import { Usuarios } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function test() {
  try {
    const result = await db.select().from(Usuarios).where(eq(Usuarios.correo, 'test@test.com'));
    console.log(result);
  } catch (e) {
    console.error("FULL ERROR:", e);
  }
  process.exit(0);
}

test();
