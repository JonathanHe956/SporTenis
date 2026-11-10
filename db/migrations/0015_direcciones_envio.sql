-- Direcciones de envío: el cliente guarda varias y elige una antes de pagar.
-- Cada venta guarda una copia de la dirección (direccion_envio) para que el pedido no cambie
-- si después se edita o se borra la dirección. Se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS `Direcciones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_cliente` INT NOT NULL,
  `tipo_direccion` VARCHAR(100) NOT NULL,
  `calle` VARCHAR(255) NOT NULL,
  `colonia` VARCHAR(255) NULL,
  `ciudad` VARCHAR(255) NOT NULL,
  `estado_provincia` VARCHAR(255) NOT NULL,
  `cp` VARCHAR(20) NOT NULL,
  `es_principal` BOOLEAN NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_direcciones_cliente` (`id_cliente`),
  CONSTRAINT `fk_direcciones_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `Clientes` (`id`)
) ENGINE=InnoDB;

-- Cada columna se agrega solo si todavía no existe

-- Quién recibe el paquete, un teléfono de contacto y referencias para el repartidor
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Direcciones' AND COLUMN_NAME = 'destinatario');
SET @sql := IF(@falta, 'ALTER TABLE `Direcciones` ADD COLUMN `destinatario` VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Direcciones' AND COLUMN_NAME = 'telefono');
SET @sql := IF(@falta, 'ALTER TABLE `Direcciones` ADD COLUMN `telefono` VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Direcciones' AND COLUMN_NAME = 'referencias');
SET @sql := IF(@falta, 'ALTER TABLE `Direcciones` ADD COLUMN `referencias` VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Dirección elegida en la compra y la copia con la que se envió
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ventas' AND COLUMN_NAME = 'id_direccion');
SET @sql := IF(@falta, 'ALTER TABLE `Ventas` ADD COLUMN `id_direccion` INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @falta := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ventas' AND COLUMN_NAME = 'direccion_envio');
SET @sql := IF(@falta, 'ALTER TABLE `Ventas` ADD COLUMN `direccion_envio` TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Si se borra una dirección, las ventas conservan su copia y solo pierden el enlace
SET @falta_fk := (
  SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ventas' AND CONSTRAINT_NAME = 'fk_ventas_direccion'
);
SET @sql := IF(@falta_fk,
  'ALTER TABLE `Ventas` ADD CONSTRAINT `fk_ventas_direccion` FOREIGN KEY (`id_direccion`) REFERENCES `Direcciones` (`id`) ON DELETE SET NULL',
  'SELECT 1');
PREPARE agregar_fk FROM @sql;
EXECUTE agregar_fk;
DEALLOCATE PREPARE agregar_fk;
