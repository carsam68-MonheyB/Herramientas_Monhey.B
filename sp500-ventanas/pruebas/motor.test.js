/* Pruebas del motor con series sintéticas pequeñas cuyo resultado se conoce a mano.
   Correr con: node --test sp500-ventanas/pruebas/ */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../motor.js');

const LN2 = Math.log(2);
const casi = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

/* Serie A: fines de semana, 29 de febrero, una ventana con r = 0 y corte
   en la última fecha. Precios inventados a propósito (no son del S&P). */
const SERIE_A = {
  fechas: ['2016-02-26', '2016-02-29', '2016-03-01', '2016-03-04', '2016-03-07', '2017-02-27', '2017-02-28', '2017-03-01', '2017-03-03', '2017-03-06', '2017-03-07'],
  cierres: [150, 100, 110, 120, 130, 90, 200, 220, 240, 260, 130],
};

test('parsearFecha acepta AAAA-MM-DD y DD/MM/AAAA y rechaza fechas imposibles', () => {
  assert.equal(M.parsearFecha('2024-02-29'), '2024-02-29');
  assert.equal(M.parsearFecha('29/02/2024'), '2024-02-29');
  assert.equal(M.parsearFecha('01-03-1999'), '1999-03-01');
  assert.equal(M.parsearFecha(' "1980-01-02" '), '1980-01-02');
  assert.equal(M.parsearFecha('2023-02-29'), null);
  assert.equal(M.parsearFecha('31/04/2020'), null);
  assert.equal(M.parsearFecha('hola'), null);
  assert.equal(M.parsearFecha(''), null);
  assert.equal(M.formatearFecha('1980-01-02'), '02/01/1980');
});

test('fechaObjetivo suma años calendario y manda el 29 de febrero al 28', () => {
  assert.equal(M.fechaObjetivo('2015-03-04', 1), '2016-03-04');
  assert.equal(M.fechaObjetivo('2016-02-29', 1), '2017-02-28');
  assert.equal(M.fechaObjetivo('2016-02-29', 4), '2020-02-28');
  assert.equal(M.fechaObjetivo('1999-12-31', 1), '2000-12-31');
  assert.equal(M.fechaObjetivo('1980-01-02', 15), '1995-01-02');
});

test('indiceUltimoEnOAntes es una búsqueda binaria correcta en los bordes', () => {
  const f = ['2016-01-04', '2016-01-05', '2016-01-08'];
  assert.equal(M.indiceUltimoEnOAntes(f, '2016-01-06'), 1);
  assert.equal(M.indiceUltimoEnOAntes(f, '2016-01-05'), 1);
  assert.equal(M.indiceUltimoEnOAntes(f, '2016-01-03'), -1);
  assert.equal(M.indiceUltimoEnOAntes(f, '2016-01-08'), 2);
  assert.equal(M.indiceUltimoEnOAntes(f, '2017-01-01'), 2);
  assert.equal(M.indiceUltimoEnOAntes([], '2017-01-01'), -1);
});

test('serie A, horizonte 1: fines de semana, 29 de febrero, cero y corte', () => {
  const { resultado, resumenes, consistente } = M.analizar(SERIE_A, [1]);
  const v = resultado.porHorizonte[0].ventanas;
  assert.equal(v.length, 5, 'solo caben 5 inicios: los de 2017 tienen objetivo después del último dato');

  // 26/02/2016 -> objetivo 26/02/2017 (domingo) -> último cierre en o antes: 07/03/2016 (130)
  assert.equal(v[0].fechaObjetivo, '2017-02-26');
  assert.equal(v[0].fechaFin, '2016-03-07');
  casi(v[0].r, Math.log(130 / 150));
  // 29/02/2016 -> objetivo 28/02/2017 -> 200
  assert.equal(v[1].fechaObjetivo, '2017-02-28');
  assert.equal(v[1].fechaFin, '2017-02-28');
  casi(v[1].r, LN2);
  // 01/03/2016 -> 01/03/2017 -> 220
  assert.equal(v[2].fechaFin, '2017-03-01');
  casi(v[2].r, LN2);
  // 04/03/2016 (viernes) -> 04/03/2017 (sábado) -> viernes 03/03/2017 (240)
  assert.equal(v[3].fechaObjetivo, '2017-03-04');
  assert.equal(v[3].fechaFin, '2017-03-03');
  casi(v[3].r, LN2);
  // 07/03/2016 -> 07/03/2017 = último dato -> cabe, y r = 0
  assert.equal(v[4].fechaFin, '2017-03-07');
  assert.equal(v[4].r, 0);

  const r = resumenes[0];
  assert.equal(r.total, 5);
  assert.equal(r.positivas, 3);
  assert.equal(r.negativas, 1);
  assert.equal(r.cero, 1);
  casi(r.pctPositivas, 0.6);
  casi(r.pctNegativas, 0.2);
  const promedio = (Math.log(130 / 150) + 3 * LN2) / 5;
  casi(r.promedioLog, promedio);
  casi(r.promedioLogAnualizado, promedio);
  casi(r.tasaAnualEfectiva, Math.exp(promedio) - 1);
  casi(r.minimo.r, Math.log(130 / 150));
  assert.equal(r.minimo.fechaInicio, '2016-02-26');
  casi(r.maximo.r, LN2);
  assert.equal(r.maximo.fechaInicio, '2016-02-29', 'ante empate se queda la primera');
  assert.equal(r.primeraFechaInicio, '2016-02-26');
  assert.equal(r.ultimaFechaInicio, '2016-03-07');
  assert.equal(r.consistente, true);
  assert.equal(consistente, true);
});

test('serie A, horizonte 2: ninguna ventana cabe y el resumen queda vacío pero consistente', () => {
  const { resumenes } = M.analizar(SERIE_A, [2]);
  const r = resumenes[0];
  assert.equal(r.total, 0);
  assert.equal(r.positivas + r.negativas + r.cero, 0);
  assert.equal(r.promedioLog, null);
  assert.equal(r.tasaAnualEfectiva, null);
  assert.equal(r.minimo, null);
  assert.equal(r.consistente, true);
});

test('el corte es estricto: objetivo un día después del último dato queda fuera', () => {
  const serie = { fechas: ['2016-03-07', '2016-03-08', '2017-03-07'], cierres: [100, 100, 110] };
  const { resultado } = M.analizar(serie, [1]);
  const v = resultado.porHorizonte[0].ventanas;
  assert.equal(v.length, 1);
  assert.equal(v[0].fechaInicio, '2016-03-07');
  assert.equal(v[0].fechaObjetivo, '2017-03-07');
  casi(v[0].r, Math.log(1.1));
});

test('el 29 de febrero como inicio usa el 28 de febrero N años después también en año bisiesto', () => {
  const serie = { fechas: ['2016-02-29', '2020-02-27', '2020-02-28', '2020-02-29'], cierres: [100, 300, 400, 500] };
  const { resultado } = M.analizar(serie, [4]);
  const v = resultado.porHorizonte[0].ventanas;
  assert.equal(v.length, 1);
  assert.equal(v[0].fechaObjetivo, '2020-02-28');
  assert.equal(v[0].precioFin, 400);
});

/* Serie pseudoaleatoria con semilla fija: solo días hábiles, ~12 años. */
function serieSintetica(n, semilla) {
  let s = semilla;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const fechas = [];
  const cierres = [];
  let d = new Date(Date.UTC(1980, 0, 1));
  let p = 100;
  while (fechas.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && rnd() > 0.03) {
      fechas.push(d.toISOString().slice(0, 10));
      p = p * (1 + (rnd() - 0.49) * 0.02);
      cierres.push(Math.round(p * 100) / 100);
    }
    d = new Date(d.getTime() + 86400000);
  }
  return { fechas, cierres };
}

test('para cada horizonte positivas + negativas + cero = total, y la búsqueda binaria coincide con la lineal', () => {
  const serie = serieSintetica(3000, 7);
  const { resultado, resumenes, consistente } = M.analizar(serie);
  assert.equal(resumenes.length, 15);
  assert.equal(consistente, true);
  const ultima = serie.fechas[serie.fechas.length - 1];
  for (const h of resultado.porHorizonte) {
    const r = resumenes[h.horizonte - 1];
    assert.equal(r.positivas + r.negativas + r.cero, r.total, 'horizonte ' + h.horizonte);
    assert.equal(r.total, h.ventanas.length);
    for (const v of h.ventanas) {
      assert.ok(v.fechaObjetivo <= ultima);
      assert.ok(v.fechaFin <= v.fechaObjetivo);
      assert.ok(v.fechaFin > v.fechaInicio);
      // búsqueda lineal de referencia
      let j = -1;
      for (let k = 0; k < serie.fechas.length; k++) if (serie.fechas[k] <= v.fechaObjetivo) j = k;
      assert.equal(v.fechaFin, serie.fechas[j]);
      assert.equal(v.precioFin, serie.cierres[j]);
    }
    // la primera ventana excluida de verdad no cabe
    const idxSig = serie.fechas.indexOf(r.ultimaFechaInicio) + 1;
    if (idxSig < serie.fechas.length) assert.ok(M.fechaObjetivo(serie.fechas[idxSig], h.horizonte) > ultima);
  }
  // horizontes largos tienen menos ventanas
  for (let k = 1; k < resumenes.length; k++) assert.ok(resumenes[k].total <= resumenes[k - 1].total);
});

test('cargarCSV lee el formato de Stooq y limpia la serie', () => {
  const csv = [
    'Date,Open,High,Low,Close,Volume',
    '1979-12-31,1,1,1,107.94,0',
    '1980-01-03,1,1,1,105.22,0',
    '1980-01-02,1,1,1,105.76,0',
    '1980-01-04,1,1,1,,0',
    '1980-01-03,1,1,1,105.22,0',
    '1980-01-07,1,1,1,106.81,0',
    'basura,1,1,1,100,0',
    '1980-01-08,1,1,1,0,0',
    '',
  ].join('\n');
  const { serie, resumen, avisos } = M.cargarCSV(csv);
  assert.deepEqual(serie.fechas, ['1980-01-02', '1980-01-03', '1980-01-07']);
  assert.deepEqual(serie.cierres, [105.76, 105.22, 106.81]);
  assert.equal(resumen.columnas.fecha, 'Date');
  assert.equal(resumen.columnas.cierre, 'Close');
  assert.equal(resumen.totalFilas, 8);
  assert.equal(resumen.fechaInvalida, 1);
  assert.equal(resumen.sinCierre, 2, 'cierre vacío y cierre 0 se omiten');
  assert.equal(resumen.duplicados, 1);
  assert.equal(resumen.antesDeMinima, 1);
  assert.equal(resumen.cierres, 3);
  assert.equal(resumen.primeraFecha, '1980-01-02');
  assert.equal(resumen.ultimaFecha, '1980-01-07');
  assert.equal(resumen.ultimoCierre, 106.81);
  assert.equal(avisos.length, 4);
});

test('cargarCSV acepta Fecha/Cierre, punto y coma, DD/MM/AAAA y decimales con coma', () => {
  const csv = '﻿Fecha;Apertura;Cierre\r\n02/01/1980;100;"105,76"\r\n03/01/1980;100;105,22\r\n';
  const { serie, resumen } = M.cargarCSV(csv);
  assert.equal(resumen.delimitador, ';');
  assert.deepEqual(serie.fechas, ['1980-01-02', '1980-01-03']);
  assert.deepEqual(serie.cierres, [105.76, 105.22]);
});

test('cargarCSV avisa cuando faltan columnas o datos', () => {
  assert.throws(() => M.cargarCSV('Dia,Precio\n2020-01-02,1\n'), /columna de fecha/);
  assert.throws(() => M.cargarCSV('Date,Open\n2020-01-02,1\n'), /columna de cierre/);
  assert.throws(() => M.cargarCSV('Date,Close\n1975-01-02,1\n1976-01-02,2\n'), /menos de dos cierres/);
  assert.throws(() => M.cargarCSV('Date,Close\n'), /filas de datos/);
});

test('exportación: el detalle tiene una fila por ventana con seis columnas y fechas DD/MM/AAAA', () => {
  const { resultado, resumenes } = M.analizar(SERIE_A, [1, 2]);
  const detalle = M.csvDetalle(resultado).trim().split('\n');
  assert.equal(detalle[0], 'horizonte,fecha_inicio,precio_inicio,fecha_fin,precio_fin,ln');
  assert.equal(detalle.length, 1 + 5);
  assert.equal(detalle[2], '1,29/02/2016,100,28/02/2017,200,' + LN2.toFixed(6));
  assert.ok(detalle.every((l) => l.split(',').length === 6));

  const resumen = M.csvResumen(resumenes).trim().split('\n');
  assert.equal(resumen.length, 3);
  const cols = resumen[1].split(',');
  assert.equal(cols[0], '1');
  assert.equal(cols[1], '5');
  assert.equal(cols[3], '60.00');
  assert.equal(cols[5], '20.00');
  assert.equal(cols[11], '26/02/2016');
  assert.equal(resumen[2].split(',')[1], '0');
});
