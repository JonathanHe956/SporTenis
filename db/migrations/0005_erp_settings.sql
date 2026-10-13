-- Etapa 3 (ERP): tabla de configuración específica del módulo ERP,
-- siguiendo el mismo patrón que ScmSettings.
CREATE TABLE IF NOT EXISTS `ErpSettings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nivel_erp` VARCHAR(50) DEFAULT 'Inicial',
  `fecha_actualizacion` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
