/* Interfaz: carga de datos (función de Netlify o CSV propio), tabla, gráficas SVG
   y exportación. La lógica de cálculo vive en motor.js (window.MotorVentanas). */
(function () {
  'use strict';
  const M = window.MotorVentanas;
  const $ = (sel) => document.querySelector(sel);
  const URL_FUNCION = '/.netlify/functions/spx';
  const CLAVE_LS = 'sp500ventanas.datos';
  const NS = 'http://www.w3.org/2000/svg';

  const fmt2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEntero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  const pct = (x) => (x == null ? '—' : fmt2.format(x * 100) + ' %');
  const num2 = (x) => (x == null ? '—' : fmt2.format(x));
  const fecha = M.formatearFecha;

  const estado = {
    serie: null,
    resumenDatos: null,
    fuente: '',
    analisis: null,
    horizonte: 10,
  };

  /* ------------------------------------------------------------ Avisos */
  const banner = $('#banner');
  function mostrarBanner(tipo, texto) {
    banner.className = 'banner ' + tipo;
    banner.textContent = texto;
    banner.hidden = false;
  }
  function ocultarBanner() {
    banner.hidden = true;
  }

  /* ----------------------------------------------------- Persistencia */
  function guardarLocal(texto, fuente) {
    try {
      localStorage.setItem(CLAVE_LS, JSON.stringify({ texto, fuente, guardadoEn: new Date().toISOString() }));
      return true;
    } catch (e) {
      return false;
    }
  }
  function leerLocal() {
    try {
      const raw = localStorage.getItem(CLAVE_LS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function borrarLocal() {
    try {
      localStorage.removeItem(CLAVE_LS);
    } catch (e) { /* sin almacenamiento */ }
  }

  /* ------------------------------------------------------------ Carga */
  async function actualizarDesdeStooq() {
    const btn = $('#btn-actualizar');
    btn.disabled = true;
    btn.textContent = 'Descargando…';
    ocultarBanner();
    try {
      const res = await fetch(URL_FUNCION, { cache: 'no-store' });
      const tipo = res.headers.get('content-type') || '';
      if (!res.ok || tipo.includes('json')) {
        let detalle = 'código ' + res.status;
        try {
          const j = await res.json();
          if (j && j.error) detalle = j.error;
        } catch (e) { /* sin cuerpo JSON */ }
        throw new Error('No se pudieron descargar los datos de Stooq (' + detalle + '). Puedes cargar un CSV propio.');
      }
      const texto = await res.text();
      const hoy = fecha(new Date().toISOString().slice(0, 10));
      procesar(texto, 'Stooq (^SPX, cierre diario), descargado el ' + hoy, true);
    } catch (e) {
      mostrarBanner('error', e.message || String(e));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Actualizar datos';
    }
  }

  function leerArchivo(archivo) {
    if (!archivo) return;
    ocultarBanner();
    const lector = new FileReader();
    lector.onload = () => procesar(String(lector.result), 'Archivo: ' + archivo.name, true);
    lector.onerror = () => mostrarBanner('error', 'No se pudo leer el archivo.');
    lector.readAsText(archivo);
  }

  function procesar(texto, fuente, guardar) {
    let carga;
    try {
      carga = M.cargarCSV(texto);
    } catch (e) {
      mostrarBanner('error', 'El CSV no se pudo usar: ' + e.message);
      return;
    }
    estado.serie = carga.serie;
    estado.resumenDatos = carga.resumen;
    estado.fuente = fuente;
    if (guardar) {
      const ok = guardarLocal(texto, fuente);
      $('#guardado').textContent = ok
        ? 'Estos datos quedan guardados en este navegador y se cargan solos la próxima vez.'
        : 'No se pudieron guardar los datos en este navegador (almacenamiento lleno o bloqueado).';
    }
    renderDatos(carga.avisos);
    $('#estado-datos').textContent = 'Calculando…';
    // Deja pintar la ficha de datos antes del cálculo.
    setTimeout(() => {
      estado.analisis = M.analizar(estado.serie);
      renderTodo();
    }, 0);
  }

  /* ---------------------------------------------------------- Render */
  function renderDatos(avisos) {
    const r = estado.resumenDatos;
    $('#d-fuente').textContent = estado.fuente;
    $('#d-primera').textContent = fecha(r.primeraFecha);
    $('#d-ultima').textContent = fecha(r.ultimaFecha);
    $('#d-n').textContent = fmtEntero.format(r.cierres);
    $('#d-cierre').textContent = num2(r.ultimoCierre);
    const ul = $('#avisos');
    ul.innerHTML = '';
    for (const a of avisos) {
      const li = document.createElement('li');
      li.textContent = a;
      ul.appendChild(li);
    }
    if (avisos.length) mostrarBanner('aviso', 'Se limpiaron los datos: ' + avisos.join(' '));
  }

  function renderTodo() {
    const { resumenes, consistente } = estado.analisis;
    const r = estado.resumenDatos;
    $('#estado-datos').textContent = fmtEntero.format(r.cierres) + ' cierres · hasta ' + fecha(r.ultimaFecha);
    const c = $('#consistencia');
    c.className = 'consistencia ' + (consistente ? 'ok' : 'mal');
    c.textContent = consistente
      ? 'Comprobación interna: en cada horizonte positivas + negativas + cero = total de ventanas.'
      : 'Atención: la comprobación positivas + negativas + cero = total falló en algún horizonte.';
    renderTabla(resumenes);
    renderBarras(resumenes);
    renderSelector(resumenes);
    renderLinea();
    $('#btn-csv-resumen').disabled = false;
    $('#btn-csv-detalle').disabled = false;
  }

  function celda(tr, contenido, clase) {
    const td = document.createElement('td');
    if (contenido instanceof Node) td.appendChild(contenido);
    else td.textContent = contenido;
    if (clase) td.className = clase;
    tr.appendChild(td);
    return td;
  }

  function valorConFecha(x, f) {
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(x));
    const s = document.createElement('span');
    s.className = 'fecha';
    s.textContent = f;
    frag.appendChild(s);
    return frag;
  }

  function renderTabla(resumenes) {
    const cuerpo = $('#tabla-cuerpo');
    cuerpo.innerHTML = '';
    for (const r of resumenes) {
      const tr = document.createElement('tr');
      celda(tr, r.horizonte + (r.horizonte === 1 ? ' año' : ' años'));
      if (!r.total) {
        celda(tr, '0');
        const td = celda(tr, 'No cabe ninguna ventana completa en los datos.', 'muted');
        td.colSpan = 12;
        td.style.textAlign = 'left';
        cuerpo.appendChild(tr);
        continue;
      }
      celda(tr, fmtEntero.format(r.total));
      celda(tr, fmtEntero.format(r.positivas));
      celda(tr, pct(r.pctPositivas), 'pos');
      celda(tr, fmtEntero.format(r.negativas));
      celda(tr, pct(r.pctNegativas), r.negativas ? 'neg' : '');
      celda(tr, fmtEntero.format(r.cero));
      celda(tr, pct(r.promedioLog));
      celda(tr, pct(r.promedioLogAnualizado));
      celda(tr, pct(r.tasaAnualEfectiva));
      celda(tr, valorConFecha(pct(r.minimo.r), fecha(r.minimo.fechaInicio)), r.minimo.r < 0 ? 'neg' : '');
      celda(tr, valorConFecha(pct(r.maximo.r), fecha(r.maximo.fechaInicio)), r.maximo.r > 0 ? 'pos' : '');
      celda(tr, fecha(r.primeraFechaInicio));
      celda(tr, fecha(r.ultimaFechaInicio));
      cuerpo.appendChild(tr);
    }
  }

  function renderSelector(resumenes) {
    const sel = $('#sel-horizonte');
    const previo = sel.value ? Number(sel.value) : estado.horizonte;
    sel.innerHTML = '';
    let hayPrevio = false;
    for (const r of resumenes) {
      const op = document.createElement('option');
      op.value = r.horizonte;
      op.textContent = r.horizonte + (r.horizonte === 1 ? ' año' : ' años') + (r.total ? '' : ' (sin ventanas)');
      op.disabled = !r.total;
      if (r.horizonte === previo && r.total) hayPrevio = true;
      sel.appendChild(op);
    }
    estado.horizonte = hayPrevio ? previo : (resumenes.find((r) => r.total) || resumenes[0]).horizonte;
    sel.value = estado.horizonte;
  }

  /* ----------------------------------------------------- Utilidades SVG */
  function el(nombre, attrs, padre) {
    const e = document.createElementNS(NS, nombre);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(e);
    return e;
  }
  function texto(padre, x, y, contenido, attrs) {
    const t = el('text', Object.assign({ x, y }, attrs || {}), padre);
    t.textContent = contenido;
    return t;
  }
  function barraRedondeada(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    if (h <= 0) return '';
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + -r + 'H' + (x + w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'V' + (y + h) + 'Z';
  }
  function pasoBonito(rango, objetivo) {
    const crudo = rango / Math.max(1, objetivo);
    const mag = Math.pow(10, Math.floor(Math.log10(crudo)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= crudo) return m * mag;
    return 10 * mag;
  }
  function crearTooltip(cont) {
    let t = cont.querySelector('.tooltip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'tooltip';
      cont.appendChild(t);
    }
    return t;
  }
  function colocarTooltip(t, cont, x, y, html) {
    t.innerHTML = html;
    t.classList.add('visible');
    const ancho = t.offsetWidth;
    const limite = cont.clientWidth;
    let left = x + 14;
    if (left + ancho > limite) left = Math.max(0, x - ancho - 14);
    t.style.left = left + 'px';
    t.style.top = Math.max(0, y - 10) + 'px';
  }

  /* ------------------------------------------------- Gráfica de barras */
  function renderBarras(resumenes) {
    const cont = $('#g-barras');
    cont.innerHTML = '';
    const datos = resumenes.filter((r) => r.total);
    if (!datos.length) {
      cont.innerHTML = '<div class="vacio">Ningún horizonte tiene ventanas completas.</div>';
      return;
    }
    const W = Math.max(320, cont.clientWidth || 800);
    const H = 320;
    const m = { l: 46, r: 12, t: 14, b: 40 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Porcentaje de ventanas positivas y negativas por horizonte de 1 a 15 años' }, cont);
    const grupo = pw / 15;
    const ancho = Math.min(24, Math.floor((grupo - 10) / 2));
    const sep = 2;
    const y = (v) => m.t + ph - (v / 100) * ph;

    const rej = el('g', { class: 'rejilla' }, svg);
    const eje = el('g', { class: 'eje' }, svg);
    for (let v = 0; v <= 100; v += 25) {
      el('line', { x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v) }, v === 0 ? eje : rej);
      texto(eje, m.l - 8, y(v) + 4, v + ' %', { 'text-anchor': 'end' });
    }
    const barras = el('g', {}, svg);
    const hover = el('g', {}, svg);
    const tip = crearTooltip(cont);
    for (let i = 0; i < 15; i++) {
      const N = i + 1;
      const r = resumenes[i];
      const cx = m.l + grupo * i + grupo / 2;
      texto(eje, cx, m.t + ph + 18, String(N), { 'text-anchor': 'middle' });
      if (!r || !r.total) continue;
      const xPos = cx - ancho - sep / 2;
      const xNeg = cx + sep / 2;
      const hp = (r.pctPositivas * 100 / 100) * ph;
      const hn = (r.pctNegativas * 100 / 100) * ph;
      const bp = el('path', { class: 'barra-pos', d: barraRedondeada(xPos, y(r.pctPositivas * 100), ancho, hp, 4) }, barras);
      const bn = el('path', { class: 'barra-neg', d: barraRedondeada(xNeg, y(r.pctNegativas * 100), ancho, hn, 4) }, barras);
      const zona = el('rect', { x: m.l + grupo * i, y: m.t, width: grupo, height: ph, fill: 'transparent' }, hover);
      const html =
        '<strong>' + N + (N === 1 ? ' año' : ' años') + '</strong> · ' + fmtEntero.format(r.total) + ' ventanas<br>' +
        'Positivas: ' + pct(r.pctPositivas) + ' (' + fmtEntero.format(r.positivas) + ')<br>' +
        'Negativas: ' + pct(r.pctNegativas) + ' (' + fmtEntero.format(r.negativas) + ')' +
        (r.cero ? '<br>Cero: ' + fmtEntero.format(r.cero) : '');
      zona.addEventListener('mousemove', (ev) => {
        bp.classList.add('hover');
        bn.classList.add('hover');
        const rect = cont.getBoundingClientRect();
        colocarTooltip(tip, cont, ev.clientX - rect.left, ev.clientY - rect.top, html);
      });
      zona.addEventListener('mouseleave', () => {
        bp.classList.remove('hover');
        bn.classList.remove('hover');
        tip.classList.remove('visible');
      });
    }
    texto(eje, m.l + pw / 2, H - 4, 'Horizonte (años)', { 'text-anchor': 'middle' });
  }

  /* -------------------------------------------------- Gráfica de línea */
  function renderLinea() {
    const cont = $('#g-linea');
    cont.innerHTML = '';
    if (!estado.analisis) return;
    const N = estado.horizonte;
    const h = estado.analisis.resultado.porHorizonte.find((x) => x.horizonte === N);
    const resumen = estado.analisis.resumenes.find((x) => x.horizonte === N);
    const v = h ? h.ventanas : [];
    $('#linea-desc').textContent =
      'Rendimiento logarítmico (ln × 100) de cada ventana de ' + N + (N === 1 ? ' año' : ' años') +
      ', colocado en su fecha de inicio. ' + (v.length ? fmtEntero.format(v.length) + ' ventanas, inicios del ' + fecha(v[0].fechaInicio) + ' al ' + fecha(v[v.length - 1].fechaInicio) + '. ' : '') +
      'La línea gris marca el cero.';
    if (!v.length) {
      cont.innerHTML = '<div class="vacio">No cabe ninguna ventana de ' + N + ' años en los datos.</div>';
      return;
    }
    const W = Math.max(320, cont.clientWidth || 800);
    const H = 360;
    const m = { l: 56, r: 16, t: 14, b: 40 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Rendimiento logarítmico de cada ventana de ' + N + ' años según su fecha de inicio' }, cont);

    const tiempos = v.map((w) => Date.parse(w.fechaInicio + 'T00:00:00Z'));
    const t0 = tiempos[0];
    const t1 = tiempos[tiempos.length - 1];
    const rangoT = Math.max(1, t1 - t0);
    let yMin = Math.min(0, resumen.minimo.r * 100);
    let yMax = Math.max(0, resumen.maximo.r * 100);
    const margen = (yMax - yMin || 1) * 0.06;
    yMin -= margen;
    yMax += margen;
    const x = (t) => m.l + ((t - t0) / rangoT) * pw;
    const y = (r) => m.t + ph - ((r - yMin) / (yMax - yMin)) * ph;

    const rej = el('g', { class: 'rejilla' }, svg);
    const eje = el('g', { class: 'eje' }, svg);
    const paso = pasoBonito(yMax - yMin, 7);
    for (let val = Math.ceil(yMin / paso) * paso; val <= yMax; val += paso) {
      const vv = Math.abs(val) < 1e-9 ? 0 : val;
      el('line', { x1: m.l, x2: m.l + pw, y1: y(vv), y2: y(vv) }, rej);
      texto(eje, m.l - 8, y(vv) + 4, fmtEntero.format(vv) + ' %', { 'text-anchor': 'end' });
    }
    el('line', { x1: m.l, x2: m.l, y1: m.t, y2: m.t + ph }, eje);
    el('line', { class: 'cero', x1: m.l, x2: m.l + pw, y1: y(0), y2: y(0) }, svg);

    const a0 = new Date(t0).getUTCFullYear();
    const a1 = new Date(t1).getUTCFullYear();
    const pasoA = pasoBonito(Math.max(1, a1 - a0), Math.max(3, Math.floor(pw / 70)));
    for (let a = Math.ceil(a0 / pasoA) * pasoA; a <= a1; a += pasoA) {
      const t = Date.UTC(a, 0, 1);
      if (t < t0 || t > t1) continue;
      el('line', { x1: x(t), x2: x(t), y1: m.t + ph, y2: m.t + ph + 5 }, eje);
      texto(eje, x(t), m.t + ph + 18, String(a), { 'text-anchor': 'middle' });
    }
    texto(eje, m.l + pw / 2, H - 4, 'Fecha de inicio de la ventana', { 'text-anchor': 'middle' });

    let d = '';
    for (let i = 0; i < v.length; i++) {
      d += (i ? 'L' : 'M') + x(tiempos[i]).toFixed(1) + ',' + y(v[i].r * 100).toFixed(1);
    }
    el('path', { class: 'linea', d }, svg);

    const cursor = el('line', { class: 'cursor', x1: 0, x2: 0, y1: m.t, y2: m.t + ph, visibility: 'hidden' }, svg);
    const punto = el('circle', { class: 'punto', r: 4.5, cx: 0, cy: 0, visibility: 'hidden' }, svg);
    const tip = crearTooltip(cont);
    const captura = el('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' }, svg);
    captura.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const t = t0 + ((px - m.l) / pw) * rangoT;
      let lo = 0;
      let hi = tiempos.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tiempos[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(tiempos[lo - 1] - t) < Math.abs(tiempos[lo] - t)) lo--;
      const w = v[lo];
      const cx = x(tiempos[lo]);
      const cy = y(w.r * 100);
      cursor.setAttribute('x1', cx);
      cursor.setAttribute('x2', cx);
      cursor.setAttribute('visibility', 'visible');
      punto.setAttribute('cx', cx);
      punto.setAttribute('cy', cy);
      punto.setAttribute('visibility', 'visible');
      const html =
        '<strong>r = ' + pct(w.r) + '</strong><br>' +
        'Inicio ' + fecha(w.fechaInicio) + ' · ' + num2(w.precioInicio) + '<br>' +
        'Fin ' + fecha(w.fechaFin) + ' · ' + num2(w.precioFin) +
        (w.fechaFin !== w.fechaObjetivo ? '<br><span class="small">objetivo ' + fecha(w.fechaObjetivo) + ', sin mercado</span>' : '');
      const crect = cont.getBoundingClientRect();
      colocarTooltip(tip, cont, (cx / W) * rect.width + (rect.left - crect.left), (cy / H) * rect.height + (rect.top - crect.top), html);
    });
    captura.addEventListener('mouseleave', () => {
      cursor.setAttribute('visibility', 'hidden');
      punto.setAttribute('visibility', 'hidden');
      tip.classList.remove('visible');
    });
  }

  /* ------------------------------------------------------- Exportación */
  function descargar(nombre, contenido) {
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function sufijoFecha() {
    return estado.resumenDatos ? estado.resumenDatos.ultimaFecha : 'sin-fecha';
  }

  /* ----------------------------------------------------------- Eventos */
  $('#btn-actualizar').addEventListener('click', actualizarDesdeStooq);
  $('#archivo').addEventListener('change', (ev) => leerArchivo(ev.target.files[0]));
  const zona = $('#zona');
  ['dragenter', 'dragover'].forEach((t) =>
    zona.addEventListener(t, (ev) => {
      ev.preventDefault();
      zona.classList.add('sobre');
    })
  );
  ['dragleave', 'drop'].forEach((t) =>
    zona.addEventListener(t, (ev) => {
      ev.preventDefault();
      zona.classList.remove('sobre');
    })
  );
  zona.addEventListener('drop', (ev) => leerArchivo(ev.dataTransfer.files && ev.dataTransfer.files[0]));
  $('#sel-horizonte').addEventListener('change', (ev) => {
    estado.horizonte = Number(ev.target.value);
    renderLinea();
  });
  $('#btn-csv-resumen').addEventListener('click', () => {
    if (estado.analisis) descargar('sp500_ventanas_resumen_' + sufijoFecha() + '.csv', M.csvResumen(estado.analisis.resumenes));
  });
  $('#btn-csv-detalle').addEventListener('click', () => {
    if (estado.analisis) descargar('sp500_ventanas_detalle_' + sufijoFecha() + '.csv', M.csvDetalle(estado.analisis.resultado));
  });
  let temporizador = null;
  window.addEventListener('resize', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      if (estado.analisis) {
        renderBarras(estado.analisis.resumenes);
        renderLinea();
      }
    }, 150);
  });

  /* ------------------------------------------------------------ Inicio */
  const guardado = leerLocal();
  if (guardado && guardado.texto) {
    $('#guardado').textContent = 'Datos guardados en este navegador el ' + fecha(guardado.guardadoEn.slice(0, 10)) + '. Usa Actualizar datos o carga otro CSV para reemplazarlos.';
    procesar(guardado.texto, guardado.fuente, false);
  } else {
    $('#guardado').textContent = 'Todavía no hay datos guardados en este navegador.';
  }
  window.SP500Ventanas = { estado, borrarLocal };
})();
