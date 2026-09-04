CREATE DATABASE IF NOT EXISTS `sportenis_db`;
USE `sportenis_db`;

CREATE TABLE `Roles` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) NOT NULL
);

CREATE TABLE `EtapasCrm` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) NOT NULL
);

CREATE TABLE `TiposInteraccion` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) NOT NULL
);

CREATE TABLE `MetodosPago` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) NOT NULL
);

CREATE TABLE `Marcas` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) NOT NULL
);

CREATE TABLE `Categorias` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) NOT NULL
);

CREATE TABLE `Modelos` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_marca` int NOT NULL,
  `id_categoria` int NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `descripcion` text,
  `precio_base` decimal(10,2) NOT NULL,
  FOREIGN KEY (`id_marca`) REFERENCES `Marcas`(`id`),
  FOREIGN KEY (`id_categoria`) REFERENCES `Categorias`(`id`)
);

CREATE TABLE `Productos` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_modelo` int NOT NULL,
  `sku` varchar(100) UNIQUE NOT NULL,
  `talla_cm` varchar(50),
  `color` varchar(50),
  `precio_venta` decimal(10,2) NOT NULL,
  `costo` decimal(10,2) NOT NULL,
  `stock` int NOT NULL,
  `estado` varchar(100) NOT NULL,
  `badge` varchar(100),
  `theme_class` varchar(100),
  FOREIGN KEY (`id_modelo`) REFERENCES `Modelos`(`id`)
);

CREATE TABLE `Usuarios` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_rol` int NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `correo` varchar(255) UNIQUE NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `estado` varchar(100) NOT NULL,
  `fecha_creacion` datetime NOT NULL,
  FOREIGN KEY (`id_rol`) REFERENCES `Roles`(`id`)
);

CREATE TABLE `Clientes` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_usuario` int,
  `id_etapa_crm` int,
  `nombre` varchar(255) NOT NULL,
  `empresa` varchar(255),
  `correo` varchar(255) UNIQUE NOT NULL,
  `telefono` varchar(50),
  `estado` varchar(100) NOT NULL,
  `fecha_registro` datetime NOT NULL,
  FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios`(`id`),
  FOREIGN KEY (`id_etapa_crm`) REFERENCES `EtapasCrm`(`id`)
);

CREATE TABLE `Direcciones` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int NOT NULL,
  `tipo_direccion` varchar(100) NOT NULL,
  `calle` varchar(255) NOT NULL,
  `colonia` varchar(255),
  `ciudad` varchar(255) NOT NULL,
  `estado_provincia` varchar(255) NOT NULL,
  `cp` varchar(20) NOT NULL,
  `es_principal` boolean NOT NULL,
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`)
);

CREATE TABLE `PreferenciasCliente` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int NOT NULL,
  `talla_calzado_preferida` varchar(50),
  `id_marca_favorita` int,
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`),
  FOREIGN KEY (`id_marca_favorita`) REFERENCES `Marcas`(`id`)
);

CREATE TABLE `Favoritos` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int NOT NULL,
  `id_producto` int NOT NULL,
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`),
  FOREIGN KEY (`id_producto`) REFERENCES `Productos`(`id`)
);

CREATE TABLE `Interacciones` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int NOT NULL,
  `id_usuario` int NOT NULL,
  `id_tipo_interaccion` int NOT NULL,
  `descripcion` text NOT NULL,
  `fecha_hora` datetime NOT NULL,
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`),
  FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios`(`id`),
  FOREIGN KEY (`id_tipo_interaccion`) REFERENCES `TiposInteraccion`(`id`)
);

CREATE TABLE `Evaluaciones` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int NOT NULL,
  `id_usuario` int NOT NULL,
  `calificacion` int NOT NULL,
  `comentarios` text,
  `fecha_evaluacion` datetime NOT NULL,
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`),
  FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios`(`id`)
);

CREATE TABLE `TareasSeguimiento` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_usuario` int NOT NULL,
  `id_cliente` int NOT NULL,
  `descripcion` text NOT NULL,
  `fecha_vencimiento` datetime NOT NULL,
  `estado` varchar(100) NOT NULL,
  FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios`(`id`),
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`)
);

CREATE TABLE `Carritos` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int,
  `session_id` varchar(255) UNIQUE,
  `fecha_actualizacion` datetime NOT NULL,
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`)
);

CREATE TABLE `DetalleCarritos` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_carrito` int NOT NULL,
  `id_producto` int NOT NULL,
  `cantidad` int NOT NULL,
  FOREIGN KEY (`id_carrito`) REFERENCES `Carritos`(`id`),
  FOREIGN KEY (`id_producto`) REFERENCES `Productos`(`id`)
);

CREATE TABLE `Ventas` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_cliente` int NOT NULL,
  `id_usuario` int,
  `id_metodo_pago` int NOT NULL,
  `fecha_venta` datetime NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  `envio` decimal(10,2) NOT NULL,
  `total` decimal(10,2) NOT NULL,
  `cupon_descuento` varchar(100),
  FOREIGN KEY (`id_cliente`) REFERENCES `Clientes`(`id`),
  FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios`(`id`),
  FOREIGN KEY (`id_metodo_pago`) REFERENCES `MetodosPago`(`id`)
);

CREATE TABLE `DetalleVentas` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_venta` int NOT NULL,
  `id_producto` int NOT NULL,
  `cantidad` int NOT NULL,
  `precio_unitario` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  FOREIGN KEY (`id_venta`) REFERENCES `Ventas`(`id`),
  FOREIGN KEY (`id_producto`) REFERENCES `Productos`(`id`)
);

CREATE TABLE `Configuraciones` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `clave` varchar(255) UNIQUE NOT NULL,
  `valor` text NOT NULL,
  `descripcion` text
);

CREATE TABLE `LogsActividad` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `id_usuario` int NOT NULL,
  `accion` varchar(255) NOT NULL,
  `modulo_afectado` varchar(255) NOT NULL,
  `id_registro_afectado` int,
  `fecha_hora` datetime NOT NULL,
  FOREIGN KEY (`id_usuario`) REFERENCES `Usuarios`(`id`)
);
