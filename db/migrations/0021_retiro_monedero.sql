-- Retiro: el saldo que se le devuelve al cliente cuando elimina su cuenta con dinero en el monedero
-- (deja el saldo en cero; el equipo hace la devolución desde la notificación del panel). Se puede
-- correr más de una vez.
ALTER TABLE `MovimientosMonedero`
  MODIFY `tipo` ENUM('Recarga', 'Descuento', 'Reembolso', 'Retiro') NOT NULL;
