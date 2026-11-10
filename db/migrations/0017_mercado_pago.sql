-- Pagos con Mercado Pago (Checkout Pro oficial). Cada intento guarda una copia del carrito, la
-- dirección y el total: al volver de Mercado Pago (o al llegar su aviso por webhook) la venta se
-- registra con esos datos, solo después de confirmar con la API de Mercado Pago que el pago se aprobó.
CREATE TABLE IF NOT EXISTS `CheckoutsMercadoPago` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_cliente` INT NOT NULL,
  `id_usuario` INT NULL,
  `id_direccion` INT NULL,
  `direccion_envio` TEXT NOT NULL,
  -- [{ id_producto, cantidad, precio, titulo }]
  `articulos` TEXT NOT NULL,
  `envio` DECIMAL(10,2) NOT NULL,
  `total` DECIMAL(10,2) NOT NULL,
  `preference_id` VARCHAR(100) NULL,
  `payment_id` VARCHAR(50) NULL,
  -- pendiente → procesando → pagado | reembolsado | error; fallido si Mercado Pago rechazó el pago
  `estado` VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  `mensaje` VARCHAR(255) NULL,
  `id_venta` INT NULL,
  `fecha_creacion` DATETIME NOT NULL,
  `fecha_actualizacion` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_checkouts_mp_cliente` (`id_cliente`),
  KEY `idx_checkouts_mp_payment` (`payment_id`),
  CONSTRAINT `fk_checkouts_mp_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `Clientes` (`id`),
  CONSTRAINT `fk_checkouts_mp_venta` FOREIGN KEY (`id_venta`) REFERENCES `Ventas` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
