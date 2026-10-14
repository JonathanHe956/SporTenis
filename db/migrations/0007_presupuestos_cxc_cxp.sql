-- Etapa 5 (ERP): Presupuestos y Cuentas por Cobrar / Pagar
-- Es idempotente: se puede ejecutar más de una vez.

CREATE TABLE IF NOT EXISTS `Presupuestos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `periodo` VARCHAR(7) NOT NULL,
  `ingresos_proyectados` DECIMAL(12,2) NOT NULL,
  `egresos_proyectados` DECIMAL(12,2) NOT NULL,
  `notas` TEXT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `CuentasPorCobrar` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_cliente` INT NOT NULL,
  `id_venta` INT NULL,
  `concepto` VARCHAR(255) NOT NULL,
  `monto` DECIMAL(10,2) NOT NULL,
  `monto_pagado` DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  `estado` VARCHAR(50) NOT NULL DEFAULT 'Pendiente',
  `fecha_emision` DATETIME NOT NULL,
  `fecha_vencimiento` DATETIME NOT NULL,
  `fecha_pago` DATETIME NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_cxc_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `Clientes` (`id`),
  CONSTRAINT `fk_cxc_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `CuentasPorPagar` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_proveedor` INT NOT NULL,
  `id_pedido_compra` INT NULL,
  `concepto` VARCHAR(255) NOT NULL,
  `monto` DECIMAL(10,2) NOT NULL,
  `monto_pagado` DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  `estado` VARCHAR(50) NOT NULL DEFAULT 'Pendiente',
  `fecha_emision` DATETIME NOT NULL,
  `fecha_vencimiento` DATETIME NOT NULL,
  `fecha_pago` DATETIME NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_cxp_proveedor` FOREIGN KEY (`id_proveedor`) REFERENCES `Proveedores` (`id`),
  CONSTRAINT `fk_cxp_pedido` FOREIGN KEY (`id_pedido_compra`) REFERENCES `PedidosCompra` (`id`)
) ENGINE=InnoDB;

-- Datos semilla iniciales si no existen
INSERT INTO `Presupuestos` (`periodo`, `ingresos_proyectados`, `egresos_proyectados`, `notas`, `fecha_creacion`)
SELECT DATE_FORMAT(NOW(), '%Y-%m'), 75000.00, 42000.00, 'Presupuesto base operativo del mes', NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Presupuestos` LIMIT 1);
