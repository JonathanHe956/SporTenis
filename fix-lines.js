import fs from 'fs';
import path from 'path';

const pages = [
  'src/pages/crm/productos.astro',
  'src/pages/crm/interacciones.astro',
  'src/pages/crm/evaluaciones.astro',
  'src/pages/crm/usuarios.astro',
  'src/pages/crm/actividad.astro',
  'src/pages/scm/productos.astro',
  'src/pages/scm/proveedores.astro',
  'src/pages/scm/pedidos.astro'
];

for (let file of pages) {
  const p = path.join(process.cwd(), file);
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    // Replace literal '\n' with actual line break
    content = content.split('\\n').join('\n');
    fs.writeFileSync(p, content, 'utf8');
    console.log('Fixed ' + file);
  }
}
