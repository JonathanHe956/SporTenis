CREATE TABLE IF NOT EXISTS `MovimientosMonedero` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_monedero` INT NOT NULL,
  `tipo` ENUM('Recarga', 'Descuento') NOT NULL,
  `monto` DECIMAL(10,2) NOT NULL,
  `fecha` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_movimientos_monedero_fecha` (`id_monedero`, `fecha`),
  CONSTRAINT `fk_movimientos_monedero` FOREIGN KEY (`id_monedero`) REFERENCES `Monederos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
