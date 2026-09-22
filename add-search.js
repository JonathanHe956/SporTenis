import fs from 'fs';
import path from 'path';

const pages = [
  {
    path: 'src/pages/crm/productos.astro',
    listName: 'productosList',
    filteredName: 'productosFiltrados',
    searchProps: ['nombre', 'descripcion', 'marca', 'categoria']
  },
  {
    path: 'src/pages/crm/interacciones.astro',
    listName: 'todasLasInteracciones',
    filteredName: 'interaccionesFiltradas',
    searchProps: ['cliente', 'notas', 'tipo']
  },
  {
    path: 'src/pages/crm/evaluaciones.astro',
    listName: 'todasLasEvaluaciones',
    filteredName: 'evaluacionesFiltradas',
    searchProps: ['cliente', 'comentario']
  },
  {
    path: 'src/pages/crm/usuarios.astro',
    listName: 'usuariosList',
    filteredName: 'usuariosFiltrados',
    searchProps: ['nombre', 'correo', 'rol']
  },
  {
    path: 'src/pages/crm/actividad.astro',
    listName: 'actividades',
    filteredName: 'actividadesFiltradas',
    searchProps: ['usuario_nombre', 'descripcion']
  },
  {
    path: 'src/pages/scm/productos.astro',
    listName: 'productosList',
    filteredName: 'productosFiltrados',
    searchProps: ['nombre', 'marca', 'categoria', 'proveedor']
  },
  {
    path: 'src/pages/scm/proveedores.astro',
    listName: 'proveedoresList',
    filteredName: 'proveedoresFiltrados',
    searchProps: ['nombre', 'contacto_nombre', 'correo']
  },
  {
    path: 'src/pages/scm/pedidos.astro',
    listName: 'pedidosList',
    filteredName: 'pedidosFiltrados',
    searchProps: ['producto_nombre', 'proveedor_nombre', 'id']
  }
];

const SEARCH_FORM_HTML = [
  '      <!-- Buscador local funcional -->',
  '      <form method="GET" style="margin: 0; flex: 1; max-width: 400px; display: flex; position: relative; margin-bottom: 24px;" id="searchForm">',
  '        <input type="search" name="q" value={q || ""} placeholder="Buscar..." class="search-input" style="width: 100%; padding-right: 40px;" />',
  '        <button type="submit" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--color-text-muted);">',
  '          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  '        </button>',
  '      </form>'
].join('\\n');

for (let config of pages) {
  const p = path.join(process.cwd(), config.path);
  if (!fs.existsSync(p)) continue;

  let content = fs.readFileSync(p, 'utf8');
  let original = content;

  // 1. Add JS logic right before the closing ---
  if (!content.includes('const q = Astro.url.searchParams.get')) {
    const filterConditions = config.searchProps.map(prop => {
      if (prop === 'id') return "(item." + prop + " && item." + prop + ".toString().includes(searchTerm))";
      return "(item." + prop + " && item." + prop + ".toLowerCase().includes(searchTerm))";
    }).join(' || ');

    const jsLogic = "\\nconst q = Astro.url.searchParams.get('q');\\nlet " + config.filteredName + " = " + config.listName + ";\\n\\nif (q) {\\n  const searchTerm = q.toLowerCase();\\n  " + config.filteredName + " = " + config.filteredName + ".filter((item: any) => \\n    " + filterConditions + "\\n  );\\n}\\n---";
    
    const lastDashIndex = content.lastIndexOf('---');
    if (lastDashIndex !== -1) {
      content = content.substring(0, lastDashIndex) + jsLogic + content.substring(lastDashIndex + 3);
    }
  }

  // 2. Replace the list mapping in JSX
  content = content.split("{" + config.listName + ".map(").join("{" + config.filteredName + ".map(");

  content = content.split(config.listName + ".length === 0").join(config.filteredName + ".length === 0");

  content = content.split(config.listName + ".length > 0").join(config.filteredName + ".length > 0");

  // 3. Inject HTML Search Form right after .crm-card or .header-actions
  if (!content.includes('id="searchForm"')) {
    content = content.replace(/(<div class="table-responsive">)/, SEARCH_FORM_HTML + "\\n    $1");
  }

  // 4. Inject search-input CSS if not exists
  if (!content.includes('.search-input {')) {
    content = content.replace("<" + "/style>", "\\n  .search-input {\\n    flex: 1;\\n    padding: 10px 16px;\\n    border: 1px solid var(--color-border);\\n    border-radius: 6px;\\n    font-family: inherit;\\n  }\\n</style>");
  }

  if (content !== original) {
    fs.writeFileSync(p, content, 'utf8');
    console.log("Updated " + config.path);
  }
}
