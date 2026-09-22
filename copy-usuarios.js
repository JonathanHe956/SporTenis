import fs from 'fs';
let content = fs.readFileSync('src/pages/crm/usuarios.astro', 'utf8');
content = content.replace(/\/crm\/usuarios/g, '/scm/usuarios').replace(/return Astro\.redirect\('\/crm'\)/g, "return Astro.redirect('/scm')");
fs.writeFileSync('src/pages/scm/usuarios.astro', content);
