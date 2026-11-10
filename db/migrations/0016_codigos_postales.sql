-- Catálogo Nacional de Códigos Postales (SEPOMEX / Correos de México) para elegir municipio y colonia
-- en las direcciones de envío. La tabla se llena con:  node db/importar-codigos-postales.mjs
-- (el catálogo no se incluye en el repositorio: su licencia no permite distribuirlo a terceros).
CREATE TABLE IF NOT EXISTS `CodigosPostales` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `cp` CHAR(5) NOT NULL,
  `colonia` VARCHAR(255) NOT NULL,
  `tipo_asentamiento` VARCHAR(100) NOT NULL,
  `municipio` VARCHAR(255) NOT NULL,
  `estado` VARCHAR(100) NOT NULL,
  `ciudad` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_codigos_postales_cp` (`cp`),
  KEY `idx_codigos_postales_estado_municipio` (`estado`, `municipio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
