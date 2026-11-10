-- Etapa 4: impuestos configurables desde la administración (antes el IVA estaba fijo en el código)
CREATE TABLE IF NOT EXISTS `Impuestos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `porcentaje` DECIMAL(5,2) NOT NULL,
  `estado` VARCHAR(20) NOT NULL DEFAULT 'Activo',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_impuestos_nombre` (`nombre`),
  CONSTRAINT `chk_impuestos_porcentaje` CHECK (`porcentaje` >= 0 AND `porcentaje` <= 100)
) ENGINE=InnoDB;

-- El IVA de México con el que ya trabajaba la tienda
INSERT IGNORE INTO `Impuestos` (`nombre`, `porcentaje`, `estado`) VALUES ('IVA', 16.00, 'Activo');
