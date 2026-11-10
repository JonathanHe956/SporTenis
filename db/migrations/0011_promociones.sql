CREATE TABLE IF NOT EXISTS `Promociones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(255) NOT NULL,
  `descripcion` TEXT NULL,
  `tipo_descuento` ENUM('porcentaje', 'monto') NOT NULL,
  `valor` DECIMAL(10,2) NOT NULL,
  `fecha_inicio` DATETIME NOT NULL,
  `fecha_fin` DATETIME NOT NULL,
  `estado` ENUM('Activa', 'Inactiva') NOT NULL DEFAULT 'Activa',
  PRIMARY KEY (`id`),
  KEY `idx_promociones_estado_vigencia` (`estado`, `fecha_inicio`, `fecha_fin`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `PromocionesProductos` (
  `id_promocion` INT NOT NULL,
  `id_producto` INT NOT NULL,
  PRIMARY KEY (`id_promocion`, `id_producto`),
  KEY `idx_promociones_productos_producto` (`id_producto`),
  CONSTRAINT `fk_promociones_productos_promocion`
    FOREIGN KEY (`id_promocion`) REFERENCES `Promociones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_promociones_productos_producto`
    FOREIGN KEY (`id_producto`) REFERENCES `Productos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
