CREATE TABLE IF NOT EXISTS `Sesiones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `token_hash` VARCHAR(64) NOT NULL,
  `id_usuario` INT NOT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  `fecha_expiracion` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sesiones_token_hash` (`token_hash`),
  KEY `idx_sesiones_usuario` (`id_usuario`),
  CONSTRAINT `fk_sesiones_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
