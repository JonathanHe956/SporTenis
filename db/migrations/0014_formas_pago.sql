-- Formas de pago de la tienda: monedero (0013), tarjeta de crédito, tarjeta de débito y Mercado Pago.
-- Tarjetas y Mercado Pago son simulados. Se puede correr más de una vez.

INSERT INTO `MetodosPago` (`nombre`)
SELECT 'Tarjeta de crédito' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `MetodosPago` WHERE `nombre` = 'Tarjeta de crédito');

INSERT INTO `MetodosPago` (`nombre`)
SELECT 'Tarjeta de débito' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `MetodosPago` WHERE `nombre` = 'Tarjeta de débito');

INSERT INTO `MetodosPago` (`nombre`)
SELECT 'Mercado Pago' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `MetodosPago` WHERE `nombre` = 'Mercado Pago');

-- Cómo se pagó, sin datos sensibles ("Visa •••• 4242", "Mercado Pago #A1B2C3").
-- Nunca se guarda el número completo de la tarjeta ni el CVV.
SET @falta_referencia := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Pagos' AND COLUMN_NAME = 'referencia'
);
SET @sql := IF(@falta_referencia, 'ALTER TABLE `Pagos` ADD COLUMN `referencia` VARCHAR(100) NULL', 'SELECT 1');
PREPARE agregar_referencia FROM @sql;
EXECUTE agregar_referencia;
DEALLOCATE PREPARE agregar_referencia;
