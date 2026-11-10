/** La tabla aún no existe (migración sin aplicar); drizzle envuelve el error de mysql2 en `cause`. */
export const esTablaInexistente = (error: unknown): boolean => {
  const err = error as { code?: string; cause?: { code?: string } } | null;
  return err?.code === 'ER_NO_SUCH_TABLE' || err?.cause?.code === 'ER_NO_SUCH_TABLE';
};
