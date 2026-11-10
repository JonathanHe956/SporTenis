-- Impuestos con los que se emitió cada factura. Los precios de la tienda ya incluyen los impuestos:
-- la factura desglosa su total con todos los impuestos activos y guarda aquí el monto de cada uno
-- (Facturas.iva guarda la suma). Así el historial no cambia si después se edita la tabla Impuestos.
CREATE TABLE IF NOT EXISTS `FacturaImpuestos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_factura` INT NOT NULL,
  `nombre` VARCHAR(100) NOT NULL,
  `porcentaje` DECIMAL(5,2) NOT NULL,
  `monto` DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_factura_impuestos_factura` (`id_factura`),
  CONSTRAINT `fk_factura_impuestos_factura`
    FOREIGN KEY (`id_factura`) REFERENCES `Facturas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
