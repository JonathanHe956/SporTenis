-- Etapa 4 (4.3): "¿Olvidaste tu contraseña?". El cliente recibe por correo un enlace de un solo uso
-- que vence en 30 minutos. Solo se guarda el hash del token, nunca el enlace en claro.
CREATE TABLE IF NOT EXISTS `RecuperacionesPassword` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_usuario` INT NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  `fecha_expiracion` DATETIME NOT NULL,
  -- Cuándo se usó para cambiar la contraseña; un enlace usado ya no sirve
  `fecha_uso` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recuperaciones_token` (`token_hash`),
  KEY `idx_recuperaciones_usuario` (`id_usuario`, `fecha_creacion`),
  CONSTRAINT `fk_recuperaciones_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
