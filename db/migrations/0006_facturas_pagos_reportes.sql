-- Etapa 4 (ERP): facturación automática, conciliación de pagos y reportes programados.
-- Es idempotente: se puede ejecutar más de una vez.
CREATE TABLE IF NOT EXISTS `Facturas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_venta` INT NOT NULL,
  `folio` VARCHAR(30) NOT NULL,
  `uuid` VARCHAR(36) NOT NULL,
  `subtotal` DECIMAL(10,2) NOT NULL,
  `iva` DECIMAL(10,2) NOT NULL,
  `total` DECIMAL(10,2) NOT NULL,
  `estado` VARCHAR(50) NOT NULL DEFAULT 'Emitida',
  `fecha_emision` DATETIME NOT NULL,
  `fecha_cancelacion` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_facturas_venta` (`id_venta`),
  UNIQUE KEY `uq_facturas_folio` (`folio`),
  UNIQUE KEY `uq_facturas_uuid` (`uuid`),
  CONSTRAINT `fk_facturas_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `Pagos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_venta` INT NOT NULL,
  `id_factura` INT NULL,
  `id_metodo_pago` INT NOT NULL,
  `monto` DECIMAL(10,2) NOT NULL,
  `estado` VARCHAR(50) NOT NULL,
  `fecha_pago` DATETIME NOT NULL,
  `fecha_conciliacion` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pagos_venta` (`id_venta`),
  CONSTRAINT `fk_pagos_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`),
  CONSTRAINT `fk_pagos_factura` FOREIGN KEY (`id_factura`) REFERENCES `Facturas` (`id`),
  CONSTRAINT `fk_pagos_metodo` FOREIGN KEY (`id_metodo_pago`) REFERENCES `MetodosPago` (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ReportesProgramados` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `periodo_inicio` VARCHAR(10) NOT NULL,
  `periodo_fin` VARCHAR(10) NOT NULL,
  `ordenes` INT NOT NULL,
  `ventas` INT NOT NULL,
  `ingresos` DECIMAL(12,2) NOT NULL,
  `facturas_emitidas` INT NOT NULL,
  `pagos_conciliados` INT NOT NULL,
  `pagos_con_diferencia` INT NOT NULL,
  `fecha_generacion` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reportes_periodo` (`periodo_inicio`)
) ENGINE=InnoDB;

-- Las ventas confirmadas o entregadas que ya existían reciben su factura y su cobro conciliado.
-- El IVA (16 %) va incluido en el total, igual que en src/lib/facturacion.ts
INSERT INTO `Facturas` (`id_venta`, `folio`, `uuid`, `subtotal`, `iva`, `total`, `estado`, `fecha_emision`)
  SELECT v.id, CONCAT('FAC-', LPAD(v.id, 6, '0')), UUID(),
         ROUND(v.total / 1.16, 2), v.total - ROUND(v.total / 1.16, 2), v.total, 'Emitida', v.fecha_venta
  FROM `Ventas` v
  WHERE v.estado IN ('Confirmada', 'Entregada')
    AND NOT EXISTS (SELECT 1 FROM `Facturas` f WHERE f.id_venta = v.id);

INSERT INTO `Pagos` (`id_venta`, `id_factura`, `id_metodo_pago`, `monto`, `estado`, `fecha_pago`, `fecha_conciliacion`)
  SELECT v.id, f.id, v.id_metodo_pago, v.total, 'Conciliado', v.fecha_venta, v.fecha_venta
  FROM `Ventas` v
  JOIN `Facturas` f ON f.id_venta = v.id
  WHERE v.estado IN ('Confirmada', 'Entregada')
    AND NOT EXISTS (SELECT 1 FROM `Pagos` p WHERE p.id_venta = v.id);
