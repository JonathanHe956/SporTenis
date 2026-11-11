-- Verificación del correo al registrarse: la cuenta no se crea hasta que el cliente escribe el código
-- de 6 dígitos que le llega por correo. Se puede correr más de una vez.
--
-- Cada fila es un registro en espera. token_hash identifica al navegador que llenó el formulario (el
-- token real solo vive en una cookie) y codigo_hash guarda el código ligado a ese token, nunca en claro.
-- Las filas con más de 24 horas se borran solas en el siguiente registro.

CREATE TABLE IF NOT EXISTS `VerificacionesCorreo` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `token_hash` CHAR(64) NOT NULL,
  `correo` VARCHAR(255) NOT NULL,
  `nombre` VARCHAR(255) NOT NULL,
  `telefono` VARCHAR(50) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `codigo_hash` CHAR(64) NOT NULL,
  -- Intentos fallidos con el código vigente; al llegar al límite hay que pedir otro
  `intentos` INT NOT NULL DEFAULT 0,
  -- Códigos enviados a este correo; tope para no usar la tienda para llenar buzones ajenos
  `envios` INT NOT NULL DEFAULT 1,
  `fecha_envio` DATETIME NOT NULL,
  -- Vencimiento del código vigente
  `fecha_expiracion` DATETIME NOT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_verificaciones_token` (`token_hash`),
  UNIQUE KEY `uq_verificaciones_correo` (`correo`),
  KEY `idx_verificaciones_creacion` (`fecha_creacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
