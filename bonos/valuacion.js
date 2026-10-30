/* Valuación de valores gubernamentales mexicanos (Cetes, Bonos M, Udibonos).
 * Réplica en JavaScript de valuacion.py; las convenciones están documentadas ahí.
 * Funciona en el navegador (window.Valuacion) y en Node (module.exports). */
(function (root) {
  'use strict';
  const PLAZO_CUPON = 182;
  const BASE = 360;

  const cuponesPorCortar = (plazo) => Math.max(1, Math.ceil(plazo / PLAZO_CUPON));
  const diasTranscurridos = (plazo) => cuponesPorCortar(plazo) * PLAZO_CUPON - plazo;
  const cupon = (tasa, vn = 100) => vn * tasa / 100 * PLAZO_CUPON / BASE;

  function flujosBono(plazo, tasa, vn = 100) {
    const k = cuponesPorCortar(plazo), d = diasTranscurridos(plazo), c = cupon(tasa, vn);
    const out = [];
    for (let i = 1; i <= k; i++) {
      out.push({ dias: PLAZO_CUPON - d + PLAZO_CUPON * (i - 1), flujo: c + (i === k ? vn : 0) });
    }
    return out;
  }

  // ----- fórmulas oficiales de Banxico
  function precioSucioPorRendimiento(r, tasa, plazo, vn = 100) {
    const k = cuponesPorCortar(plazo), d = diasTranscurridos(plazo), c = cupon(tasa, vn);
    const R = r / 100 * PLAZO_CUPON / BASE;
    const bruto = Math.abs(R) < 1e-12 ? c * k + vn
      : c + c / R * (1 - Math.pow(1 + R, -(k - 1))) + vn * Math.pow(1 + R, -(k - 1));
    return bruto / Math.pow(1 + R, 1 - d / PLAZO_CUPON);
  }
  const interesesDevengados = (tasa, plazo, vn = 100) => cupon(tasa, vn) * diasTranscurridos(plazo) / PLAZO_CUPON;
  const precioLimpioPorRendimiento = (r, tasa, plazo, vn = 100) =>
    precioSucioPorRendimiento(r, tasa, plazo, vn) - interesesDevengados(tasa, plazo, vn);

  function biseccion(f, objetivo, lo, hi) {
    // f decreciente; devuelve x con f(x) = objetivo
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > objetivo) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const rendimientoPorPrecioSucio = (p, tasa, plazo, vn = 100) =>
    biseccion((r) => precioSucioPorRendimiento(r, tasa, plazo, vn), p, -50, 200);
  const rendimientoPorPrecioLimpio = (p, tasa, plazo, vn = 100) =>
    rendimientoPorPrecioSucio(p + interesesDevengados(tasa, plazo, vn), tasa, plazo, vn);
  const precioCetePorRendimiento = (r, plazo, vn = 10) => vn / (1 + r / 100 * plazo / BASE);
  const rendimientoCetePorPrecio = (p, plazo, vn = 10) => (vn / p - 1) * BASE / plazo * 100;

  // ----- curva cupón cero (tasa anual act/360 capitalizable cada 182 días)
  const fdDeTasa = (z, t) => Math.pow(1 + z / 100 * PLAZO_CUPON / BASE, -t / PLAZO_CUPON);
  const tasaDeFd = (fd, t) => (Math.pow(fd, -PLAZO_CUPON / t) - 1) * BASE / PLAZO_CUPON * 100;
  const tasaSimpleDeFd = (fd, t) => (1 / fd - 1) * BASE / t * 100;

  class Curva {
    constructor(nodos) { this.nodos = nodos || []; }
    tasa(t) {
      const n = this.nodos;
      if (!n.length) throw new Error('curva vacía');
      if (t <= n[0].plazo) return n[0].tasa;
      if (t >= n[n.length - 1].plazo) return n[n.length - 1].tasa;
      for (let i = 0; i + 1 < n.length; i++) {
        const a = n[i], b = n[i + 1];
        if (a.plazo <= t && t <= b.plazo) {
          const w = (t - a.plazo) / (b.plazo - a.plazo);
          return a.tasa + w * (b.tasa - a.tasa);
        }
      }
      throw new Error('interpolación');
    }
    fd(t) { return t <= 0 ? 1 : fdDeTasa(this.tasa(t), t); }
    tasaSimple(t) { return t <= 0 ? this.tasa(1) : tasaSimpleDeFd(this.fd(t), t); }
    valorPresente(flujos) { return flujos.reduce((s, f) => s + f.flujo * this.fd(f.dias), 0); }
  }

  /* instrumentos: [{tipo:'cete', plazo, precio|tasa, etiqueta}, {tipo:'bono'|'udibono', plazo, sucio, cupon, etiqueta}] */
  function bootstrap(instrumentos) {
    const curva = new Curva([]);
    const orden = instrumentos.filter((i) => i.plazo).slice().sort((a, b) => a.plazo - b.plazo);
    for (const ins of orden) {
      const plazo = Math.round(ins.plazo);
      const ultimo = curva.nodos[curva.nodos.length - 1];
      if (ultimo && plazo <= ultimo.plazo) continue;
      if (ins.tipo === 'cete') {
        const vn = ins.vn || 10;
        let fd, tasaMercado;
        if (ins.precio != null) { fd = ins.precio / vn; tasaMercado = rendimientoCetePorPrecio(ins.precio, plazo, vn); }
        else { tasaMercado = ins.tasa; fd = 1 / (1 + tasaMercado / 100 * plazo / BASE); }
        curva.nodos.push({ plazo, fd, tasa: tasaDeFd(fd, plazo), tasaSimple: tasaSimpleDeFd(fd, plazo),
          origen: 'cete', etiqueta: ins.etiqueta || `Cete ${plazo}d`, precio: ins.precio != null ? ins.precio : vn * fd,
          tasaMercado, cupon: 0 });
      } else {
        const sucio = +ins.sucio, tasaCupon = +ins.cupon;
        const flujos = flujosBono(plazo, tasaCupon, 100);
        const tPrev = ultimo ? ultimo.plazo : 0, zPrev = ultimo ? ultimo.tasa : null;
        const precioCon = (zT) => {
          let total = 0;
          for (const f of flujos) {
            if (f.dias <= tPrev) total += f.flujo * curva.fd(f.dias);
            else {
              const z = zPrev == null ? zT : zPrev + (f.dias - tPrev) / (plazo - tPrev) * (zT - zPrev);
              total += f.flujo * fdDeTasa(z, f.dias);
            }
          }
          return total;
        };
        const zT = biseccion(precioCon, sucio, -90, 300);
        const fd = fdDeTasa(zT, plazo);
        curva.nodos.push({ plazo, fd, tasa: zT, tasaSimple: tasaSimpleDeFd(fd, plazo), origen: ins.tipo,
          etiqueta: ins.etiqueta || `${ins.tipo} ${plazo}d`, precio: sucio,
          tasaMercado: rendimientoPorPrecioSucio(sucio, tasaCupon, plazo), cupon: tasaCupon });
      }
    }
    return curva;
  }

  function valuarBono(curva, plazo, tasa, vn = 100) {
    const flujos = flujosBono(plazo, tasa, vn);
    let sucio = 0;
    const detalle = flujos.map((f) => {
      const fd = curva.fd(f.dias);
      sucio += f.flujo * fd;
      return { dias: f.dias, flujo: f.flujo, tasaCero: curva.tasa(f.dias), tasaSimple: curva.tasaSimple(f.dias), fd, vp: f.flujo * fd };
    });
    const devengados = interesesDevengados(tasa, plazo, vn);
    return { plazo, cupones: cuponesPorCortar(plazo), diasTranscurridos: diasTranscurridos(plazo), cupon: cupon(tasa, vn),
      devengados, sucio, limpio: sucio - devengados, rendimiento: rendimientoPorPrecioSucio(sucio, tasa, plazo, vn), flujos: detalle };
  }

  function valuarCete(curva, plazo, vn = 10) {
    const fd = curva.fd(plazo);
    return { plazo, fd, precio: vn * fd, tasaCero: curva.tasa(plazo), rendimiento: rendimientoCetePorPrecio(vn * fd, plazo, vn) };
  }

  const diasEntre = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

  const V = { PLAZO_CUPON, BASE, cuponesPorCortar, diasTranscurridos, cupon, flujosBono, precioSucioPorRendimiento,
    interesesDevengados, precioLimpioPorRendimiento, rendimientoPorPrecioSucio, rendimientoPorPrecioLimpio,
    precioCetePorRendimiento, rendimientoCetePorPrecio, fdDeTasa, tasaDeFd, tasaSimpleDeFd, Curva, bootstrap,
    valuarBono, valuarCete, diasEntre };
  if (typeof module !== 'undefined' && module.exports) module.exports = V; else root.Valuacion = V;
})(typeof window !== 'undefined' ? window : globalThis);
