-- Tarjetas de regalo desde el panel (CRM, SCM y ERP): el administrador ve los códigos que siguen
-- sin canjear y genera lotes nuevos de $2,000. Para poder mostrarlos se guarda el código además de
-- su hash (el canje sigue buscando por hash). Las tarjetas creadas antes no tienen código guardado.
ALTER TABLE `TarjetasRegalo`
  ADD COLUMN `codigo` VARCHAR(24) NULL AFTER `codigo_hash`,
  ADD COLUMN `generada_por` INT NULL,
  ADD CONSTRAINT `fk_tarjetas_regalo_usuario` FOREIGN KEY (`generada_por`) REFERENCES `Usuarios` (`id`) ON DELETE SET NULL;
