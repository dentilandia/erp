// Supabase/PostgREST solo devuelve un máximo de filas por consulta (1000 por
// defecto) — sin paginar, una consulta de todo un mes con las dos sedes puede
// superar eso fácilmente, y el resto se pierde en silencio, sin error.
export async function fetchTodasLasFilas<T>(
  construir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const TAMANO_PAGINA = 1000;
  let desde = 0;
  const todas: T[] = [];
  for (;;) {
    const { data } = await construir(desde, desde + TAMANO_PAGINA - 1);
    if (!data || data.length === 0) break;
    todas.push(...data);
    if (data.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }
  return todas;
}
