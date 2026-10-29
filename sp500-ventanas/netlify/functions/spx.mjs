/* Función de Netlify: descarga el CSV diario del S&P 500 (^SPX) de Stooq y lo
   devuelve tal cual a la app. Existe porque Stooq no manda cabeceras CORS y
   el navegador no puede pedirlo directamente.
   URL en producción: /.netlify/functions/spx */

export const ORIGEN = 'https://stooq.com/q/d/l/?s=^spx&i=d';

function respuestaError(mensaje, estado) {
  return new Response(JSON.stringify({ error: mensaje }), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async function spx() {
  let res;
  try {
    res = await fetch(ORIGEN, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sp500-ventanas/1.0)', Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return respuestaError('No se pudo conectar con Stooq: ' + (e && e.message ? e.message : e), 502);
  }
  if (!res.ok) return respuestaError('Stooq respondió con el código ' + res.status + '.', 502);

  const texto = await res.text();
  const primeraLinea = (texto.split(/\r?\n/, 1)[0] || '').trim();
  if (!/date/i.test(primeraLinea) || !/close/i.test(primeraLinea)) {
    // Stooq devuelve texto plano cuando se agota el límite diario de descargas.
    return respuestaError('Stooq no devolvió un CSV con Date y Close. Respuesta: "' + texto.slice(0, 160).trim() + '"', 502);
  }
  return new Response(texto, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Fuente': ORIGEN,
    },
  });
}
