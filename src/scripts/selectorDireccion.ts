// Selectores de ubicación del formulario de dirección (carrito y "Mis direcciones"):
// el estado carga sus municipios, y el código postal llena estado, municipio y la lista de colonias.
// Los datos salen del Catálogo Nacional de Códigos Postales (/api/geo/...).

interface RespuestaCp {
  ok: boolean;
  error?: string;
  estado?: string;
  municipio?: string;
  colonias?: Array<{ nombre: string; tipo: string }>;
}

export interface DatosUbicacion {
  estado?: string;
  ciudad?: string;
  cp?: string;
  colonia?: string;
}

export interface SelectorDireccion {
  /** Precarga una dirección guardada (para editarla). */
  precargar(datos: DatosUbicacion): Promise<void>;
  /** Deja los selectores como recién abiertos (después de form.reset()). */
  limpiar(): void;
}

const municipiosCache = new Map<string, Promise<string[]>>();

const pedirMunicipios = (estado: string): Promise<string[]> => {
  if (!municipiosCache.has(estado)) {
    municipiosCache.set(estado, fetch(`/api/geo/municipios?estado=${encodeURIComponent(estado)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; municipios?: string[]; error?: string }) => {
        if (!d.ok) throw new Error(d.error || 'No se pudieron cargar los municipios.');
        return d.municipios ?? [];
      })
      .catch((error) => { municipiosCache.delete(estado); throw error; }));
  }
  return municipiosCache.get(estado)!;
};

const opcion = (valor: string, texto = valor): HTMLOptionElement => new Option(texto, valor);

export function conectarSelectorDireccion(form: HTMLFormElement): SelectorDireccion {
  const estado = form.elements.namedItem('estado') as HTMLSelectElement;
  const municipio = form.elements.namedItem('ciudad') as HTMLSelectElement;
  const cp = form.elements.namedItem('cp') as HTMLInputElement;
  const colonia = form.elements.namedItem('colonia') as HTMLSelectElement;
  const aviso = form.querySelector<HTMLElement>('[data-geo-aviso]');
  // Evita que una respuesta lenta pise a una más reciente
  let consultaCp = 0;

  const mostrarAviso = (texto: string, tipo: 'info' | 'error' = 'info') => {
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.dataset.tipo = tipo;
    aviso.hidden = !texto;
  };

  const vaciarColonias = (texto = 'Primero escribe tu código postal') => {
    colonia.replaceChildren(opcion('', texto));
    colonia.disabled = true;
  };

  async function cargarMunicipios(nombreEstado: string, seleccionar = ''): Promise<void> {
    municipio.replaceChildren(opcion('', nombreEstado ? 'Cargando municipios…' : 'Primero elige el estado'));
    municipio.disabled = true;
    if (!nombreEstado) return;
    try {
      const lista = await pedirMunicipios(nombreEstado);
      if (estado.value !== nombreEstado) return; // el cliente ya cambió de estado
      municipio.replaceChildren(opcion('', `Elige tu municipio (${lista.length})`), ...lista.map((m) => opcion(m)));
      municipio.disabled = false;
      if (seleccionar) municipio.value = seleccionar;
    } catch (error) {
      municipio.replaceChildren(opcion('', 'No disponible'));
      mostrarAviso(error instanceof Error ? error.message : 'No se pudieron cargar los municipios.', 'error');
    }
  }

  async function buscarCp(seleccionarColonia = ''): Promise<void> {
    const valor = cp.value.trim();
    const consulta = ++consultaCp;
    if (!/^\d{5}$/.test(valor)) {
      vaciarColonias();
      if (valor.length === 5) mostrarAviso('El código postal debe tener 5 dígitos.', 'error');
      else mostrarAviso('');
      return;
    }
    colonia.replaceChildren(opcion('', 'Buscando colonias…'));
    colonia.disabled = true;
    try {
      const res = await fetch(`/api/geo/cp/${valor}`);
      const data = (await res.json()) as RespuestaCp;
      if (consulta !== consultaCp) return;
      if (!res.ok || !data.ok || !data.estado || !data.municipio) {
        vaciarColonias('Código postal no encontrado');
        mostrarAviso(data.error || 'No encontramos ese código postal.', 'error');
        return;
      }
      // El código postal manda: fija el estado y el municipio que le corresponden
      if (estado.value !== data.estado) {
        estado.value = data.estado;
        await cargarMunicipios(data.estado, data.municipio);
      } else if (municipio.value !== data.municipio) {
        if (municipio.disabled) await cargarMunicipios(data.estado, data.municipio);
        else municipio.value = data.municipio;
      }
      const colonias = data.colonias ?? [];
      colonia.replaceChildren(
        opcion('', colonias.length === 1 ? 'Elige tu colonia' : `Elige tu colonia (${colonias.length})`),
        ...colonias.map((c) => opcion(c.nombre, c.tipo && c.tipo !== 'Colonia' ? `${c.nombre} · ${c.tipo}` : c.nombre)),
      );
      colonia.disabled = false;
      if (seleccionarColonia) colonia.value = seleccionarColonia;
      else if (colonias.length === 1) colonia.value = colonias[0].nombre;
      mostrarAviso(`C.P. ${valor}: ${data.municipio}, ${data.estado}`);
    } catch {
      if (consulta !== consultaCp) return;
      vaciarColonias('No disponible');
      mostrarAviso('No se pudo consultar el código postal. Intenta de nuevo.', 'error');
    }
  }

  estado.addEventListener('change', () => {
    void cargarMunicipios(estado.value);
    // Un código postal de otro estado ya no aplica
    if (cp.value) { cp.value = ''; vaciarColonias(); mostrarAviso(''); }
  });
  municipio.addEventListener('change', () => {
    if (cp.value && colonia.disabled === false) { cp.value = ''; vaciarColonias(); mostrarAviso(''); }
  });
  cp.addEventListener('input', () => {
    cp.value = cp.value.replace(/\D/g, '').slice(0, 5);
    if (cp.value.length === 5 || colonia.disabled === false) void buscarCp();
  });

  const limpiar = () => {
    consultaCp++;
    void cargarMunicipios(estado.value);
    vaciarColonias();
    mostrarAviso('');
  };
  limpiar();

  return {
    limpiar,
    async precargar(datos) {
      estado.value = datos.estado ?? '';
      await cargarMunicipios(estado.value, datos.ciudad ?? '');
      cp.value = datos.cp ?? '';
      if (cp.value) await buscarCp(datos.colonia ?? '');
    },
  };
}
