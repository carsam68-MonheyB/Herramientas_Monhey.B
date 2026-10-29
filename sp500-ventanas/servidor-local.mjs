/* Servidor local para desarrollo, sin dependencias. Sirve el repositorio
   completo desde la raíz (igual que Netlify) y atiende la función
   /.netlify/functions/spx con el mismo código que se publica.

   Uso:   node sp500-ventanas/servidor-local.mjs
   Abre:  http://localhost:8888/sp500-ventanas/

   Variables opcionales:
     PUERTO=8888            puerto de escucha
     SPX_CSV_LOCAL=ruta     en vez de llamar a Stooq, la función devuelve ese
                            archivo CSV (útil sin internet o para pruebas).  */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PUERTO || 8888);
const CSV_LOCAL = process.env.SPX_CSV_LOCAL ? path.resolve(process.env.SPX_CSV_LOCAL) : null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

async function atenderFuncion(res) {
  if (CSV_LOCAL) {
    try {
      const texto = await readFile(CSV_LOCAL, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'X-Fuente': 'archivo local ' + CSV_LOCAL });
      res.end(texto);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'No se pudo leer SPX_CSV_LOCAL: ' + e.message }));
    }
    return;
  }
  const { default: spx } = await import('./netlify/functions/spx.mjs');
  const respuesta = await spx(new Request('http://localhost/.netlify/functions/spx'));
  const cabeceras = {};
  respuesta.headers.forEach((v, k) => (cabeceras[k] = v));
  res.writeHead(respuesta.status, cabeceras);
  res.end(Buffer.from(await respuesta.arrayBuffer()));
}

async function atenderEstatico(urlPath, res) {
  let ruta = decodeURIComponent(urlPath.split('?')[0]);
  const absoluta = path.resolve(RAIZ, '.' + ruta);
  if (!absoluta.startsWith(RAIZ)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }
  let archivo = absoluta;
  try {
    const info = await stat(archivo);
    if (info.isDirectory()) {
      if (!ruta.endsWith('/')) {
        res.writeHead(302, { Location: ruta + '/' });
        return res.end();
      }
      archivo = path.join(archivo, 'index.html');
    }
    const datos = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado: ' + ruta);
  }
}

http
  .createServer(async (req, res) => {
    try {
      const urlPath = req.url || '/';
      if (urlPath.startsWith('/.netlify/functions/spx')) await atenderFuncion(res);
      else await atenderEstatico(urlPath, res);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error del servidor: ' + e.message);
    }
  })
  .listen(PUERTO, () => {
    console.log('Servidor local en http://localhost:' + PUERTO + '/sp500-ventanas/');
    console.log(CSV_LOCAL ? 'La función /.netlify/functions/spx devuelve ' + CSV_LOCAL : 'La función /.netlify/functions/spx descarga de Stooq');
  });
