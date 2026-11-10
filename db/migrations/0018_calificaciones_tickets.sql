-- Calificaciones y tickets de soporte de los clientes. Se puede correr más de una vez.
--
-- Evaluaciones: el cliente califica (1 a 5) cada pedido entregado desde "Mis compras". Antes solo
-- las registraba el personal, por eso id_usuario pasa a ser opcional y se agrega el pedido calificado
-- (único: una calificación por pedido; las capturadas por el personal no llevan pedido).
--
-- Tickets: el cliente levanta un ticket (retraso, cancelación, producto dañado, devolución, pago u
-- otro), casi siempre ligado a uno de sus pedidos. El cliente y el personal del CRM se escriben en
-- MensajesTicket hasta resolverlo.

ALTER TABLE `Evaluaciones` MODIFY `id_usuario` INT NULL;

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Evaluaciones' AND COLUMN_NAME = 'id_venta');
SET @sql := IF(@falta, 'ALTER TABLE `Evaluaciones` ADD COLUMN `id_venta` INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Evaluaciones' AND INDEX_NAME = 'uq_evaluaciones_venta');
SET @sql := IF(@falta, 'ALTER TABLE `Evaluaciones` ADD UNIQUE KEY `uq_evaluaciones_venta` (`id_venta`)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Evaluaciones' AND CONSTRAINT_NAME = 'fk_evaluaciones_venta');
SET @sql := IF(@falta,
  'ALTER TABLE `Evaluaciones` ADD CONSTRAINT `fk_evaluaciones_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `Tickets` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_cliente` INT NOT NULL,
  -- Pedido del que se queja el cliente; null en dudas generales
  `id_venta` INT NULL,
  -- Retraso en la entrega, Cancelación, Producto dañado o incorrecto, Cambio o devolución, Pago o factura, Otro
  `tipo` VARCHAR(50) NOT NULL,
  `asunto` VARCHAR(150) NOT NULL,
  `estado` ENUM('Abierto', 'En proceso', 'Resuelto', 'Cerrado') NOT NULL DEFAULT 'Abierto',
  `prioridad` ENUM('Baja', 'Media', 'Alta') NOT NULL DEFAULT 'Media',
  -- Agente del CRM que lo atiende
  `id_usuario_asignado` INT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  `fecha_actualizacion` DATETIME NOT NULL,
  -- Cuándo pasó a Resuelto o Cerrado (para medir el tiempo de resolución)
  `fecha_resolucion` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tickets_cliente` (`id_cliente`),
  KEY `idx_tickets_venta` (`id_venta`),
  KEY `idx_tickets_estado` (`estado`),
  CONSTRAINT `fk_tickets_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `Clientes` (`id`),
  CONSTRAINT `fk_tickets_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`),
  CONSTRAINT `fk_tickets_usuario` FOREIGN KEY (`id_usuario_asignado`) REFERENCES `Usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `MensajesTicket` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_ticket` INT NOT NULL,
  -- Cliente, Soporte (un agente) o Sistema (avisos automáticos: cambios de estado, cancelación aprobada)
  `autor` ENUM('Cliente', 'Soporte', 'Sistema') NOT NULL,
  `id_usuario` INT NULL,
  `mensaje` TEXT NOT NULL,
  `fecha` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mensajes_ticket` (`id_ticket`),
  CONSTRAINT `fk_mensajes_ticket` FOREIGN KEY (`id_ticket`) REFERENCES `Tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mensajes_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
