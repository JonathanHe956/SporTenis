# SporTenis

Tienda deportiva desarrollada con Astro para ofrecer productos y accesorios de tenis, pádel y otras disciplinas deportivas.

## Estado actual

Se corrigió un problema relacionado con los iconos de la interfaz. Por el momento, se utilizan palabras en su lugar como solución temporal mientras se implementan los iconos definitivos.

## Requisitos

- Node.js 22.12.0 o superior
- npm 11 o superior

## Instalación

Clona el repositorio y accede a la carpeta del proyecto:

```bash
git clone https://github.com/JonathanHe956/SporTenis.git
cd SporTenis
```

Instala las dependencias:

```bash
npm install
```

## Desarrollo

Inicia el servidor de desarrollo:

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:4321`.

Para iniciar el servidor en segundo plano:

```bash
npm run dev -- --background
```

## Compilación y previsualización

Genera la versión optimizada para producción:

```bash
npm run build
```

Previsualiza la compilación localmente:

```bash
npm run preview
```

## Estructura del proyecto

```text
/
├── public/                 Archivos públicos y recursos estáticos
├── src/
│   ├── assets/             Recursos utilizados por la interfaz
│   ├── components/         Componentes Astro reutilizables
│   ├── layouts/            Plantillas generales de página
│   └── pages/              Rutas de la aplicación
├── astro.config.mjs        Configuración de Astro
├── package.json            Dependencias y scripts del proyecto
└── tsconfig.json           Configuración de TypeScript
```

## Scripts disponibles

| Comando | Descripción |
| :--- | :--- |
| `npm install` | Instala las dependencias del proyecto. |
| `npm run dev` | Inicia el servidor de desarrollo. |
| `npm run build` | Genera la compilación de producción. |
| `npm run preview` | Previsualiza la compilación generada. |
| `npm run astro` | Ejecuta comandos de la CLI de Astro. |

## Tecnologías

- Astro 7
- TypeScript
- CSS

## Repositorio

El código fuente está disponible en [GitHub](https://github.com/JonathanHe956/SporTenis).
