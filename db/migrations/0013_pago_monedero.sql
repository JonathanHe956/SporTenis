-- Pago de compras con el monedero: la tienda cobra del saldo al confirmar la compra y lo devuelve
-- si la compra se cancela. Se puede correr más de una vez.

-- Método de pago con el que se registran las compras pagadas con el monedero
INSERT INTO `MetodosPago` (`nombre`)
SELECT 'Monedero' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `MetodosPago` WHERE `nombre` = 'Monedero');

-- Reembolso = devolución al cancelar una compra pagada con el monedero
ALTER TABLE `MovimientosMonedero`
  MODIFY `tipo` ENUM('Recarga', 'Descuento', 'Reembolso') NOT NULL;

-- Compra pagada (o reembolsada) con cada movimiento; NULL en las recargas
SET @falta_id_venta := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MovimientosMonedero' AND COLUMN_NAME = 'id_venta'
);
SET @sql := IF(@falta_id_venta,
  'ALTER TABLE `MovimientosMonedero`
     ADD COLUMN `id_venta` INT NULL,
     ADD KEY `idx_movimientos_monedero_venta` (`id_venta`),
     ADD CONSTRAINT `fk_movimientos_monedero_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`)',
  'SELECT 1');
PREPARE agregar_id_venta FROM @sql;
EXECUTE agregar_id_venta;
DEALLOCATE PREPARE agregar_id_venta;
