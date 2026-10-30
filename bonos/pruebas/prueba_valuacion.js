// Usado por test_valuacion.py: recibe los instrumentos de referencia en JSON y
// devuelve la curva y algunas valuaciones para compararlas con Python.
const V = require('../valuacion.js');
const referencia = JSON.parse(process.argv[2]);
const curva = V.bootstrap(referencia);
const casos = [[127, 5.5], [2401, 7.5], [3675, 10.0], [10410, 8.0], [855, 8.5]];
process.stdout.write(JSON.stringify({
  tir: V.tir([{ fecha: '2025-02-20', monto: -88.55 }, { fecha: '2025-06-05', monto: 3.92 }, { fecha: '2025-12-04', monto: 3.92 }, { fecha: '2026-06-04', monto: 3.92 }, { fecha: '2026-10-30', monto: 94.06 }]),
  nodos: curva.nodos.map((n) => ({ plazo: n.plazo, fd: n.fd, tasa: n.tasa })),
  valuaciones: casos.map(([plazo, cupon]) => {
    const v = V.valuarBono(curva, plazo, cupon);
    return { plazo, cupon, sucio: v.sucio, limpio: v.limpio, rendimiento: v.rendimiento };
  }),
}));
