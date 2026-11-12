-- "¿Olvidaste tu contraseña?" pasa de enlace a código de 6 dígitos, como la verificación del registro.
-- token_hash ahora es el hash del token de la cookie del navegador que pidió el código, y codigo_hash
-- el del código ligado a ese token. id_usuario admite NULL: si el correo no tiene cuenta se guarda
-- igual una solicitud (sin mandar nada), para que la página responda lo mismo exista o no la cuenta.
-- Los enlaces pendientes dejan de servir.
DELETE FROM `RecuperacionesPassword`;

ALTER TABLE `RecuperacionesPassword`
  MODIFY `id_usuario` INT NULL,
  ADD COLUMN `correo` VARCHAR(255) NOT NULL AFTER `id_usuario`,
  ADD COLUMN `codigo_hash` VARCHAR(64) NOT NULL AFTER `token_hash`,
  ADD COLUMN `intentos` INT NOT NULL DEFAULT 0 AFTER `codigo_hash`,
  ADD KEY `idx_recuperaciones_correo` (`correo`, `fecha_creacion`);
