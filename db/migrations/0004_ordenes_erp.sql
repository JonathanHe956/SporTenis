-- Etapa 3 (ERP): la venta funciona como orden empresarial.
-- Estados: Procesando (editable, no toca stock), Confirmada (stock descontado),
-- Entregada (estado final) y Cancelada (si venía de Confirmada se regresa el stock).
-- Las ventas existentes ya descontaron stock, por eso quedan como Confirmada.
-- Las compras de la tienda en línea siguen naciendo como Confirmada; las que captura
-- el personal en /scm/ventas nacen como Procesando.
ALTER TABLE `Ventas`
  ADD COLUMN `estado` VARCHAR(50) NOT NULL DEFAULT 'Confirmada',
  ADD COLUMN `fecha_entrega` DATETIME NULL,
  ADD KEY `idx_ventas_estado` (`estado`);
