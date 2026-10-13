-- Etapa 3 (ERP): historial de cambios de estado de cada orden y movimientos de
-- inventario ligados a su orden con llave foránea. Ejecútala una sola vez.
ALTER TABLE `MovimientosInventario`
  ADD COLUMN `id_venta` INT NULL,
  ADD CONSTRAINT `fk_movimientos_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`);

-- Los movimientos anteriores solo guardaban el folio en el motivo ("Venta #12")
UPDATE `MovimientosInventario` m
  JOIN `Ventas` v ON v.id = CAST(SUBSTRING_INDEX(m.motivo, '#', -1) AS UNSIGNED)
  SET m.id_venta = v.id
  WHERE m.motivo LIKE 'Venta #%' OR m.motivo LIKE 'Cancelación de venta #%';

CREATE TABLE IF NOT EXISTS `HistorialOrdenes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_venta` INT NOT NULL,
  `id_usuario` INT NULL,
  `estado_anterior` VARCHAR(50) NULL,
  `estado_nuevo` VARCHAR(50) NOT NULL,
  `fecha` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_historial_venta` (`id_venta`),
  CONSTRAINT `fk_historial_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`),
  CONSTRAINT `fk_historial_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`)
);

-- Las órdenes que ya existían arrancan su historial con el estado que tienen hoy
INSERT INTO `HistorialOrdenes` (`id_venta`, `id_usuario`, `estado_anterior`, `estado_nuevo`, `fecha`)
  SELECT v.id, v.id_usuario, NULL, v.estado, v.fecha_venta
  FROM `Ventas` v
  WHERE NOT EXISTS (SELECT 1 FROM `HistorialOrdenes` h WHERE h.id_venta = v.id);
