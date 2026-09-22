import fs from 'fs';
let content = fs.readFileSync('src/pages/scm/configuracion.astro', 'utf8');
content = content.replace(/\/scm\/configuracion/g, '/crm/configuracion');
fs.writeFileSync('src/pages/crm/configuracion.astro', content);
