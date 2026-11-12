// POST /api/pagos/procesar (ruta del documento de la Etapa 4, 4.1.2).
// Es el mismo flujo de /api/ventas, que se conserva para el personal y el ERP:
// valida stock, genera el pedido, registra el pago, actualiza el inventario y guarda el estado.
export { POST } from '../ventas';
