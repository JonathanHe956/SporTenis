CREATE TABLE IF NOT EXISTS `MovimientosInventario` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_producto` INT NOT NULL,
  `tipo` VARCHAR(50) NOT NULL,
  `cantidad` INT NOT NULL,
  `motivo` VARCHAR(255) NOT NULL,
  `fecha` DATETIME NOT NULL,
  `id_usuario` INT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_movimientos_producto` (`id_producto`),
  KEY `idx_movimientos_usuario` (`id_usuario`),
  CONSTRAINT `fk_movimientos_producto` FOREIGN KEY (`id_producto`) REFERENCES `Productos` (`id`),
  CONSTRAINT `fk_movimientos_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `Auditorias` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_usuario` INT NULL,
  `fecha` DATETIME NOT NULL,
  `estado` VARCHAR(50) NOT NULL,
  `notas` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_auditorias_usuario` (`id_usuario`),
  CONSTRAINT `fk_auditorias_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `AuditoriaDetalles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_auditoria` INT NOT NULL,
  `id_producto` INT NOT NULL,
  `stock_sistema` INT NOT NULL,
  `stock_fisico` INT NOT NULL,
  `diferencia` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_auditoria_detalles_auditoria` (`id_auditoria`),
  KEY `idx_auditoria_detalles_producto` (`id_producto`),
  CONSTRAINT `fk_auditoria_detalles_auditoria` FOREIGN KEY (`id_auditoria`) REFERENCES `Auditorias` (`id`),
  CONSTRAINT `fk_auditoria_detalles_producto` FOREIGN KEY (`id_producto`) REFERENCES `Productos` (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ScmSettings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nivel_scm` VARCHAR(50) DEFAULT 'Inicial',
  `fecha_actualizacion` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;