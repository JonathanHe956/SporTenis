import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'src');

function findAstroFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findAstroFiles(filePath, fileList);
    } else if (filePath.endsWith('.astro') || filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const files = findAstroFiles(srcDir);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf-8');
  if (content.includes('astro:db')) {
    // Regex to match: import { db, Usuarios, eq, desc } from 'astro:db';
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]astro:db['"];?/g;
    
    content = content.replace(importRegex, (match, importsStr) => {
      const imports = importsStr.split(',').map(i => i.trim()).filter(Boolean);
      
      const tables = [];
      const functions = [];
      let hasDb = false;
      
      const allTables = [
        'Roles', 'EtapasCrm', 'TiposInteraccion', 'MetodosPago', 'Marcas', 
        'Categorias', 'Modelos', 'Productos', 'Usuarios', 'Clientes', 
        'Direcciones', 'PreferenciasCliente', 'Favoritos', 'Interacciones', 
        'Evaluaciones', 'TareasSeguimiento', 'Carritos', 'DetalleCarritos', 
        'Ventas', 'DetalleVentas', 'Configuraciones', 'LogsActividad'
      ];
      
      for (const imp of imports) {
        if (imp === 'db') hasDb = true;
        else if (allTables.includes(imp)) tables.push(imp);
        else functions.push(imp); // eq, desc, and, or, sql, etc.
      }
      
      // Calculate relative path to src/db
      const dir = path.dirname(file);
      let relativePathToDb = path.relative(dir, path.join(srcDir, 'db')).replace(/\\/g, '/');
      if (!relativePathToDb.startsWith('.')) {
        relativePathToDb = './' + relativePathToDb;
      }
      
      let newImports = [];
      if (hasDb) {
        newImports.push(`import { db } from '${relativePathToDb}/db';`);
      }
      if (tables.length > 0) {
        newImports.push(`import { ${tables.join(', ')} } from '${relativePathToDb}/schema';`);
      }
      if (functions.length > 0) {
        newImports.push(`import { ${functions.join(', ')} } from 'drizzle-orm';`);
      }
      
      return newImports.join('\n');
    });
    
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`Updated ${file}`);
  }
}
