-- Tarjetas de regalo de un solo uso para recargar el monedero.
-- Los codigos se guardan como SHA-256; el texto original solo se entrega al generarlos.

CREATE TABLE IF NOT EXISTS `TarjetasRegalo` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `codigo_hash` VARCHAR(64) NOT NULL,
  `monto` DECIMAL(10,2) NOT NULL,
  `lote` VARCHAR(80) NOT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  `canjeada_por` INT NULL,
  `fecha_canje` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tarjetas_regalo_codigo_hash` (`codigo_hash`),
  KEY `idx_tarjetas_regalo_lote` (`lote`),
  CONSTRAINT `fk_tarjetas_regalo_cliente` FOREIGN KEY (`canjeada_por`) REFERENCES `Clientes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `MovimientosMonedero`
  MODIFY `tipo` ENUM('Recarga', 'Descuento', 'Reembolso', 'Retiro', 'Canjeo') NOT NULL,
  ADD COLUMN `id_tarjeta_regalo` INT NULL,
  ADD UNIQUE KEY `uq_movimiento_tarjeta_regalo` (`id_tarjeta_regalo`),
  ADD CONSTRAINT `fk_movimiento_tarjeta_regalo` FOREIGN KEY (`id_tarjeta_regalo`) REFERENCES `TarjetasRegalo` (`id`);
