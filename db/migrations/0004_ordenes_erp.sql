-- Etapa 3 (ERP): la venta funciona como orden empresarial.
-- Estados: Procesando (editable, no toca stock), Confirmada (stock descontado),
-- Entregada (estado final) y Cancelada (si venía de Confirmada se regresa el stock).
-- Las ventas existentes ya descontaron stock, por eso quedan como Confirmada.
ALTER TABLE `Ventas`
  ADD COLUMN `estado` VARCHAR(50) NOT NULL DEFAULT 'Confirmada',
  ADD COLUMN `fecha_entrega` DATETIME NULL,
  ADD KEY `idx_ventas_estado` (`estado`);
