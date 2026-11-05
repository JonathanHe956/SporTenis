CREATE TABLE IF NOT EXISTS `Monederos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `id_cliente` INT NOT NULL,
  `saldo` DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_monedero_cliente` (`id_cliente`),
  CONSTRAINT `fk_monedero_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `Clientes` (`id`)
) ENGINE=InnoDB;
