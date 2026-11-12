-- Saldo compartido para la tarjeta ficticia de pruebas del monedero.
-- No se almacenan el numero de tarjeta, el vencimiento ni el CVV.

CREATE TABLE IF NOT EXISTS `SaldoTarjetaDemo` (
  `id` INT NOT NULL,
  `saldo` DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT IGNORE INTO `SaldoTarjetaDemo` (`id`, `saldo`)
VALUES (1, 40000.00);

ALTER TABLE `MovimientosMonedero`
  MODIFY `tipo` ENUM('Recarga', 'Descuento', 'Reembolso', 'Retiro', 'Canjeo', 'RecargaTarjeta') NOT NULL;
