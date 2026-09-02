import fs from 'fs';

let content = fs.readFileSync('src/pages/cuenta.astro', 'utf-8').replace(/\r\n/g, '\n');

const originalTop = `---
import Layout from '../layouts/Layout.astro';
import { db } from '../db/db';
import { Usuarios } from '../db/schema';
import { eq } from 'drizzle-orm';

const sessionId = Astro.cookies.get('sportenis_session')?.value;

let userData = {
  nombre: 'Admin',
  apellidos: 'SporTenis',
  telefono: '5512345678',
  correo: 'admin@sportenis.com'
};

if (sessionId) {
  const user = await db.select().from(Usuarios).where(eq(Usuarios.id, Number(sessionId)));
  if (user.length > 0) {
    const nombresSplit = user[0].nombre.split(' ');
    userData.nombre = nombresSplit[0];
    userData.apellidos = nombresSplit.slice(1).join(' ') || '';
    userData.correo = user[0].correo;
    // Si la tabla de usuarios tuviera teléfono lo leeríamos, por ahora simulamos.
  }
}
---`;

const newTop = `---
import Layout from '../layouts/Layout.astro';
import { db } from '../db/db';
import { Usuarios, Clientes } from '../db/schema';
import { eq } from 'drizzle-orm';

const sessionId = Astro.cookies.get('sportenis_session')?.value;

if (!sessionId) {
  return Astro.redirect('/login');
}

let showSuccess = false;

if (Astro.request.method === 'POST') {
  const data = await Astro.request.formData();
  const formNombre = data.get('nombre')?.toString() || '';
  const formApellidos = data.get('apellidos')?.toString() || '';
  const formTelefono = data.get('telefono')?.toString() || '';

  const fullName = \`\${formNombre} \${formApellidos}\`.trim();

  await db.update(Usuarios)
    .set({ nombre: fullName })
    .where(eq(Usuarios.id, Number(sessionId)));

  await db.update(Clientes)
    .set({ telefono: formTelefono, nombre: fullName })
    .where(eq(Clientes.id_usuario, Number(sessionId)));

  showSuccess = true;
}

let userData = {
  nombre: '',
  apellidos: '',
  telefono: '',
  correo: ''
};

const user = await db.select().from(Usuarios).where(eq(Usuarios.id, Number(sessionId)));
if (user.length > 0) {
  const nombresSplit = user[0].nombre.split(' ');
  userData.nombre = nombresSplit[0];
  userData.apellidos = nombresSplit.slice(1).join(' ') || '';
  userData.correo = user[0].correo;
  
  const client = await db.select().from(Clientes).where(eq(Clientes.id_usuario, Number(sessionId)));
  if (client.length > 0) {
    userData.telefono = client[0].telefono || '';
  }
}
---`;

content = content.replace(originalTop, newTop);

const originalForm = `<form id="profileForm" novalidate>
            <div id="successBanner" class="success-banner" style="display: none;">¡Tus datos han sido actualizados exitosamente!</div>`;

const newForm = `<form id="profileForm" method="POST" novalidate>
            <div id="successBanner" class="success-banner" style={showSuccess ? "" : "display: none;"}>¡Tus datos han sido actualizados exitosamente!</div>`;

content = content.replace(originalForm, newForm);


const originalScript = `  form && form.addEventListener('submit', e => {
    e.preventDefault();
    let ok = true;
    if (successBanner) successBanner.style.display = 'none';

    const nombre    = document.getElementById('nombre') as HTMLInputElement;
    const apellidos = document.getElementById('apellidos') as HTMLInputElement;
    const telefono  = document.getElementById('telefono') as HTMLInputElement;

    if (!nombre.value.trim()) {
      showError('error-nombre', 'El nombre es obligatorio.'); setValidity(nombre, false); ok = false;
    } else { clearError('error-nombre'); setValidity(nombre, true); }

    if (!apellidos.value.trim()) {
      showError('error-apellidos', 'Los apellidos son obligatorios.'); setValidity(apellidos, false); ok = false;
    } else { clearError('error-apellidos'); setValidity(apellidos, true); }

    if (!/^\\d{10}$/.test(telefono.value.trim())) {
      showError('error-telefono', 'Ingresa un número de 10 dígitos.'); setValidity(telefono, false); ok = false;
    } else { clearError('error-telefono'); setValidity(telefono, true); }

    if (ok) {
      if (successBanner) successBanner.style.display = 'block';
      document.querySelectorAll('input').forEach(i => i.classList.remove('valid', 'invalid'));
      
      // Ocultar mensaje después de 3 segundos
      setTimeout(() => {
        if (successBanner) successBanner.style.display = 'none';
      }, 3000);
    }
  });`;

const newScript = `  form && form.addEventListener('submit', e => {
    let ok = true;
    if (successBanner) successBanner.style.display = 'none';

    const nombre    = document.getElementById('nombre') as HTMLInputElement;
    const apellidos = document.getElementById('apellidos') as HTMLInputElement;
    const telefono  = document.getElementById('telefono') as HTMLInputElement;

    if (!nombre.value.trim()) {
      showError('error-nombre', 'El nombre es obligatorio.'); setValidity(nombre, false); ok = false;
    } else { clearError('error-nombre'); setValidity(nombre, true); }

    if (!apellidos.value.trim()) {
      showError('error-apellidos', 'Los apellidos son obligatorios.'); setValidity(apellidos, false); ok = false;
    } else { clearError('error-apellidos'); setValidity(apellidos, true); }

    if (!/^\\d{10}$/.test(telefono.value.trim())) {
      showError('error-telefono', 'Ingresa un número de 10 dígitos.'); setValidity(telefono, false); ok = false;
    } else { clearError('error-telefono'); setValidity(telefono, true); }

    if (!ok) {
      e.preventDefault();
    } else {
      document.querySelectorAll('input').forEach(i => i.classList.remove('valid', 'invalid'));
    }
  });`;

content = content.replace(originalScript, newScript);

fs.writeFileSync('src/pages/cuenta.astro', content);
console.log('Update success');
