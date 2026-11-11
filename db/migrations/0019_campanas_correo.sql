-- Campañas de correo: el administrador manda un mismo correo (promociones, novedades) a todos los
-- clientes desde /crm/campanas. Se puede correr más de una vez.
--
-- Clientes.recibe_promociones: el cliente puede darse de baja con el enlace que trae cada campaña.
-- Clientes.token_baja: identifica al cliente en ese enlace sin exponer su id; se genera al primer envío.
-- CampanasCorreo: historial de lo enviado, con el avance del envío (se manda en segundo plano).

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Clientes' AND COLUMN_NAME = 'recibe_promociones');
SET @sql := IF(@falta, 'ALTER TABLE `Clientes` ADD COLUMN `recibe_promociones` BOOLEAN NOT NULL DEFAULT TRUE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Clientes' AND COLUMN_NAME = 'token_baja');
SET @sql := IF(@falta, 'ALTER TABLE `Clientes` ADD COLUMN `token_baja` CHAR(43) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Clientes' AND INDEX_NAME = 'uq_clientes_token_baja');
SET @sql := IF(@falta, 'ALTER TABLE `Clientes` ADD UNIQUE KEY `uq_clientes_token_baja` (`token_baja`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `CampanasCorreo` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `asunto` VARCHAR(150) NOT NULL,
  `titulo` VARCHAR(150) NOT NULL,
  `mensaje` TEXT NOT NULL,
  -- Promoción que se destaca en el correo (opcional)
  `id_promocion` INT NULL,
  `boton_texto` VARCHAR(60) NULL,
  `boton_url` VARCHAR(500) NULL,
  -- Interrumpida: el servidor se apagó a media campaña
  `estado` ENUM('Enviando', 'Enviada', 'Con errores', 'Interrumpida') NOT NULL DEFAULT 'Enviando',
  `destinatarios` INT NOT NULL DEFAULT 0,
  `enviados` INT NOT NULL DEFAULT 0,
  `fallidos` INT NOT NULL DEFAULT 0,
  `id_usuario` INT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  `fecha_actualizacion` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_campanas_fecha` (`fecha_creacion`),
  CONSTRAINT `fk_campanas_promocion` FOREIGN KEY (`id_promocion`) REFERENCES `Promociones` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_campanas_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
