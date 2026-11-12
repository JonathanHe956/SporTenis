-- Etapa 4: el administrador consulta los monederos y ajusta saldos a mano.
-- AjusteAbono suma y AjusteCargo resta; cada ajuste guarda quién lo hizo y por qué.
ALTER TABLE `MovimientosMonedero`
  MODIFY `tipo` ENUM('Recarga', 'Descuento', 'Reembolso', 'Retiro', 'Canjeo', 'RecargaTarjeta', 'AjusteAbono', 'AjusteCargo') NOT NULL,
  ADD COLUMN `motivo` VARCHAR(255) NULL,
  ADD COLUMN `id_usuario` INT NULL,
  ADD CONSTRAINT `fk_movimiento_monedero_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios` (`id`) ON DELETE SET NULL;

-- Un saldo nunca puede quedar en negativo, aunque alguien escriba directo en la base
ALTER TABLE `Monederos`
  ADD CONSTRAINT `chk_monederos_saldo` CHECK (`saldo` >= 0);
