/* Motor de cálculo de ventanas móviles del S&P 500.
   Código puro, sin DOM: se carga en el navegador (window.MotorVentanas)
   y en Node (require) para las pruebas. Todas las fechas se manejan como
   cadenas ISO "AAAA-MM-DD", que se comparan como texto sin problemas de
   zona horaria. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.MotorVentanas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HORIZONTES = Array.from({ length: 15 }, (_, i) => i + 1);
  const FECHA_MINIMA = '1980-01-01';

  /* ------------------------------------------------------------ Fechas */

  function esBisiesto(a) {
    return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  }

  function diasDelMes(a, m) {
    return [31, esBisiesto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function dos(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function armarISO(a, m, d) {
    if (!Number.isInteger(a) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    if (a < 1000 || a > 9999 || m < 1 || m > 12 || d < 1 || d > diasDelMes(a, m)) return null;
    return a + '-' + dos(m) + '-' + dos(d);
  }

  /* Acepta "AAAA-MM-DD" y "DD/MM/AAAA" (también con guiones). Devuelve ISO o null. */
  function parsearFecha(texto) {
    if (texto == null) return null;
    const t = String(texto).trim().replace(/^["']|["']$/g, '');
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(t);
    if (m) return armarISO(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(t);
    if (m) return armarISO(+m[3], +m[2], +m[1]);
    return null;
  }

  function formatearFecha(iso) {
    if (!iso) return '';
    return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  }

  /* Misma fecha calendario N años después. El 29 de febrero se convierte
     en 28 de febrero, siempre. */
  function fechaObjetivo(iso, anios) {
    const a = +iso.slice(0, 4) + anios;
    const m = +iso.slice(5, 7);
    let d = +iso.slice(8, 10);
    if (m === 2 && d === 29) d = 28;
    return a + '-' + dos(m) + '-' + dos(d);
  }

  /* Búsqueda binaria: índice del último elemento <= objetivo, o -1. */
  function indiceUltimoEnOAntes(fechas, objetivo) {
    let lo = 0;
    let hi = fechas.length - 1;
    let res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fechas[mid] <= objetivo) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res;
  }

  /* ------------------------------------------------------------- CSV */

  function limpiarCelda(c) {
    return String(c == null ? '' : c).trim().replace(/^"(.*)"$/, '$1').trim();
  }

  function parsearNumero(texto) {
    let t = limpiarCelda(texto).replace(/\s/g, '');
    if (!t || /^(null|nan|na|n\/a|-|—)$/i.test(t)) return NaN;
    if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
    else if (t.includes(',')) t = t.replace(',', '.');
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return NaN;
    return Number(t);
  }

  function detectarDelimitador(linea) {
    const candidatos = [',', ';', '\t', '|'];
    let mejor = ',';
    let max = -1;
    for (const c of candidatos) {
      const n = linea.split(c).length - 1;
      if (n > max) {
        max = n;
        mejor = c;
      }
    }
    return mejor;
  }

  function buscarColumna(encabezados, exactos, parciales) {
    const bajos = encabezados.map((h) => h.toLowerCase());
    for (const e of exactos) {
      const i = bajos.indexOf(e);
      if (i >= 0) return i;
    }
    for (const p of parciales) {
      const i = bajos.findIndex((h) => h.includes(p));
      if (i >= 0) return i;
    }
    return -1;
  }

  /* Convierte el texto de un CSV en filas {fecha, cierre}. No ordena ni
     quita duplicados: eso lo hace limpiarSerie. */
  function parsearCSV(texto) {
    if (typeof texto !== 'string') throw new Error('El archivo no contiene texto.');
    const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lineas.length < 2) throw new Error('El CSV no tiene filas de datos.');

    const delimitador = detectarDelimitador(lineas[0]);
    const encabezados = lineas[0].split(delimitador).map(limpiarCelda);
    const iFecha = buscarColumna(encabezados, ['date', 'fecha'], ['date', 'fecha']);
    const iCierre = buscarColumna(encabezados, ['close', 'cierre'], ['close', 'cierre']);
    if (iFecha < 0) throw new Error('No se encontró la columna de fecha (Date o Fecha). Columnas: ' + encabezados.join(', '));
    if (iCierre < 0) throw new Error('No se encontró la columna de cierre (Close o Cierre). Columnas: ' + encabezados.join(', '));

    const filas = [];
    let fechaInvalida = 0;
    let sinCierre = 0;
    for (let k = 1; k < lineas.length; k++) {
      const celdas = lineas[k].split(delimitador);
      const fecha = parsearFecha(celdas[iFecha]);
      if (!fecha) {
        fechaInvalida++;
        continue;
      }
      const cierre = parsearNumero(celdas[iCierre]);
      if (!Number.isFinite(cierre) || cierre <= 0) {
        sinCierre++;
        continue;
      }
      filas.push({ fecha, cierre });
    }
    return {
      filas,
      columnas: { fecha: encabezados[iFecha], cierre: encabezados[iCierre] },
      delimitador,
      totalFilas: lineas.length - 1,
      fechaInvalida,
      sinCierre,
    };
  }

  /* Ordena por fecha, quita duplicados (se queda con la primera aparición)
     y filtra desde FECHA_MINIMA. */
  function limpiarSerie(filas, fechaMinima) {
    const minima = fechaMinima || FECHA_MINIMA;
    const ordenadas = filas.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    const fechas = [];
    const cierres = [];
    let duplicados = 0;
    let duplicadosDistintos = 0;
    let antesDeMinima = 0;
    for (const f of ordenadas) {
      if (fechas.length && fechas[fechas.length - 1] === f.fecha) {
        duplicados++;
        if (cierres[cierres.length - 1] !== f.cierre) duplicadosDistintos++;
        continue;
      }
      if (f.fecha < minima) {
        antesDeMinima++;
        continue;
      }
      fechas.push(f.fecha);
      cierres.push(f.cierre);
    }
    return { fechas, cierres, duplicados, duplicadosDistintos, antesDeMinima };
  }

  /* Texto CSV -> serie limpia + resumen + avisos en español. */
  function cargarCSV(texto, opciones) {
    const op = opciones || {};
    const p = parsearCSV(texto);
    const s = limpiarSerie(p.filas, op.fechaMinima);
    const avisos = [];
    if (p.fechaInvalida) avisos.push('Se omitieron ' + p.fechaInvalida + ' fila(s) con fecha no reconocida.');
    if (p.sinCierre) avisos.push('Se omitieron ' + p.sinCierre + ' fila(s) sin cierre válido.');
    if (s.duplicados) {
      avisos.push(
        'Se quitaron ' + s.duplicados + ' fecha(s) duplicada(s)' +
          (s.duplicadosDistintos ? ' (' + s.duplicadosDistintos + ' con cierre distinto; se conservó la primera)' : '') + '.'
      );
    }
    if (s.antesDeMinima) avisos.push('Se descartaron ' + s.antesDeMinima + ' cierre(s) anteriores al ' + formatearFecha(op.fechaMinima || FECHA_MINIMA) + '.');
    if (s.fechas.length < 2) throw new Error('Quedaron menos de dos cierres válidos desde ' + formatearFecha(op.fechaMinima || FECHA_MINIMA) + '.');
    const n = s.fechas.length;
    return {
      serie: { fechas: s.fechas, cierres: s.cierres },
      resumen: {
        columnas: p.columnas,
        delimitador: p.delimitador,
        totalFilas: p.totalFilas,
        fechaInvalida: p.fechaInvalida,
        sinCierre: p.sinCierre,
        duplicados: s.duplicados,
        antesDeMinima: s.antesDeMinima,
        cierres: n,
        primeraFecha: s.fechas[0],
        ultimaFecha: s.fechas[n - 1],
        ultimoCierre: s.cierres[n - 1],
      },
      avisos,
    };
  }

  /* --------------------------------------------------------- Ventanas */

  /* Para cada horizonte N, una ventana por cada día con cierre cuya fecha
     objetivo (misma fecha calendario N años después) cae en o antes del
     último dato. Precio final: último cierre en o antes de la fecha objetivo. */
  function calcularVentanas(serie, horizontes) {
    const hs = horizontes || HORIZONTES;
    const fechas = serie.fechas;
    const cierres = serie.cierres;
    const n = fechas.length;
    const ultima = n ? fechas[n - 1] : null;
    const porHorizonte = [];
    for (const N of hs) {
      const ventanas = [];
      for (let i = 0; i < n; i++) {
        const objetivo = fechaObjetivo(fechas[i], N);
        if (objetivo > ultima) break; // las fechas están ordenadas: ninguna posterior cabe
        const j = indiceUltimoEnOAntes(fechas, objetivo);
        ventanas.push({
          horizonte: N,
          fechaInicio: fechas[i],
          precioInicio: cierres[i],
          fechaObjetivo: objetivo,
          fechaFin: fechas[j],
          precioFin: cierres[j],
          r: Math.log(cierres[j] / cierres[i]),
        });
      }
      porHorizonte.push({ horizonte: N, ventanas });
    }
    return { porHorizonte, primeraFecha: n ? fechas[0] : null, ultimaFecha: ultima, cierres: n };
  }

  function resumirHorizonte(N, ventanas) {
    const total = ventanas.length;
    let positivas = 0;
    let negativas = 0;
    let cero = 0;
    let sumaLog = 0;
    let sumaAnual = 0;
    let min = null;
    let max = null;
    for (const v of ventanas) {
      if (v.r > 0) positivas++;
      else if (v.r < 0) negativas++;
      else cero++;
      sumaLog += v.r;
      sumaAnual += v.r / N;
      if (min === null || v.r < min.r) min = v;
      if (max === null || v.r > max.r) max = v;
    }
    const promedioLog = total ? sumaLog / total : null;
    const promedioLogAnualizado = total ? sumaAnual / total : null;
    return {
      horizonte: N,
      total,
      positivas,
      pctPositivas: total ? positivas / total : null,
      negativas,
      pctNegativas: total ? negativas / total : null,
      cero,
      pctCero: total ? cero / total : null,
      promedioLog,
      promedioLogAnualizado,
      tasaAnualEfectiva: total ? Math.exp(promedioLogAnualizado) - 1 : null,
      minimo: min ? { r: min.r, fechaInicio: min.fechaInicio } : null,
      maximo: max ? { r: max.r, fechaInicio: max.fechaInicio } : null,
      primeraFechaInicio: total ? ventanas[0].fechaInicio : null,
      ultimaFechaInicio: total ? ventanas[total - 1].fechaInicio : null,
      consistente: positivas + negativas + cero === total,
    };
  }

  function resumir(resultado) {
    return resultado.porHorizonte.map((h) => resumirHorizonte(h.horizonte, h.ventanas));
  }

  function verificarConsistencia(resumenes) {
    return resumenes.every((r) => r.consistente);
  }

  /* Todo junto: serie -> ventanas + resumen por horizonte. */
  function analizar(serie, horizontes) {
    const resultado = calcularVentanas(serie, horizontes);
    const resumenes = resumir(resultado);
    return { resultado, resumenes, consistente: verificarConsistencia(resumenes) };
  }

  /* ------------------------------------------------------ Exportación */

  function pct2(x) {
    return x == null ? '' : (x * 100).toFixed(2);
  }

  function log6(x) {
    return x == null ? '' : x.toFixed(6);
  }

  function csvResumen(resumenes) {
    const cab = [
      'horizonte_anios', 'ventanas', 'positivas', 'positivas_pct', 'negativas', 'negativas_pct', 'cero',
      'promedio_log_acumulado', 'promedio_log_anualizado', 'tasa_anual_efectiva_pct',
      'minimo_log', 'minimo_fecha_inicio', 'maximo_log', 'maximo_fecha_inicio',
      'primera_fecha_inicio', 'ultima_fecha_inicio',
    ];
    const filas = resumenes.map((r) => [
      r.horizonte, r.total, r.positivas, pct2(r.pctPositivas), r.negativas, pct2(r.pctNegativas), r.cero,
      log6(r.promedioLog), log6(r.promedioLogAnualizado), pct2(r.tasaAnualEfectiva),
      r.minimo ? log6(r.minimo.r) : '', r.minimo ? formatearFecha(r.minimo.fechaInicio) : '',
      r.maximo ? log6(r.maximo.r) : '', r.maximo ? formatearFecha(r.maximo.fechaInicio) : '',
      formatearFecha(r.primeraFechaInicio), formatearFecha(r.ultimaFechaInicio),
    ]);
    return [cab].concat(filas).map((f) => f.join(',')).join('\n') + '\n';
  }

  function csvDetalle(resultado) {
    const partes = ['horizonte,fecha_inicio,precio_inicio,fecha_fin,precio_fin,ln\n'];
    for (const h of resultado.porHorizonte) {
      for (const v of h.ventanas) {
        partes.push(
          v.horizonte + ',' + formatearFecha(v.fechaInicio) + ',' + v.precioInicio + ',' +
            formatearFecha(v.fechaFin) + ',' + v.precioFin + ',' + log6(v.r) + '\n'
        );
      }
    }
    return partes.join('');
  }

  return {
    HORIZONTES,
    FECHA_MINIMA,
    parsearFecha,
    formatearFecha,
    fechaObjetivo,
    indiceUltimoEnOAntes,
    parsearNumero,
    parsearCSV,
    limpiarSerie,
    cargarCSV,
    calcularVentanas,
    resumirHorizonte,
    resumir,
    verificarConsistencia,
    analizar,
    csvResumen,
    csvDetalle,
  };
});
