// Borradores de los formularios de contacto de Servicio al cliente: se
// guardan en el navegador para que lo escrito no se pierda al cerrar el
// paciente, cambiar de pestaña o recargar la página antes de "Guardar".
// Son solo de este navegador; lo que cuenta es lo que se guarda en el ERP.

export function leerBorradores<T>(clave: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export function guardarBorradores<T>(clave: string, valor: Record<string, T>): void {
  try {
    if (Object.keys(valor).length === 0) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento disponible (modo privado): el borrador vive solo en pantalla.
  }
}
