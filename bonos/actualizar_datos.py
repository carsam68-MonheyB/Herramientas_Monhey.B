#!/usr/bin/env python3
"""Descarga de Banco de México los datos que usa la calculadora de bonos.

Fuentes (todas públicas, sin token):
  1. Posición de valores gubernamentales en circulación
     https://www.banxico.org.mx/valores/PresentaDetallePosicionGub.faces?BMXC_instrumento=N
     N = 1 Cetes, 2 Bonos M, 5 Udibonos.  Da fecha de vencimiento, monto en
     circulación, días por vencer, cupones por cortar y tasa cupón de cada emisión.
  2. Vector de precios de títulos gubernamentales "on the run" (cuadro CF300 del
     SIE): plazo, precio limpio, precio sucio y cupón/tasa de los títulos de
     referencia (Cetes 28/91/182/364/2 años, Bonos 3/5/7/10/20/30 años,
     Udibonos 3/10/20/30 años).  Con ellos se hace el bootstrapping.
  3. Valor de la UDI (cuadro CP150, serie SP68257) para los Udibonos.

Uso:
    python3 actualizar_datos.py            # últimos 250 días hábiles de curva
    python3 actualizar_datos.py --dias 60

Genera `datos.json` y `datos.js` (este último lo carga index.html y funciona
incluso abriendo la página desde el disco).
"""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

AQUI = os.path.dirname(os.path.abspath(__file__))
POSICION_URL = "https://www.banxico.org.mx/valores/PresentaDetallePosicionGub.faces?BMXC_instrumento={n}&BMXC_lang=es_MX"
SIE_SERIES_URL = "https://www.banxico.org.mx/SieInternet/consultarDirectorioInternetAction.do?accion=consultarSeries"
UA = "Mozilla/5.0 (calculadora-bonos Monhey.B)"

MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
         "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}

# Series del cuadro CF300 (Vector de precios, on the run).  Orden: plazo, precio
# limpio, precio sucio, tasa de rendimiento (Cetes) o cupón vigente (bonos).
NODOS_NOMINAL = [
    ("cete", "Cetes 28 días", "SF45422", "SF45438", "SF45439", "SF45470"),
    ("cete", "Cetes 91 días", "SF45423", "SF45440", "SF45441", "SF45471"),
    ("cete", "Cetes 182 días", "SF45424", "SF45442", "SF45443", "SF45472"),
    ("cete", "Cetes 364 días", "SF45425", "SF45444", "SF45445", "SF45473"),
    ("cete", "Cetes 2 años", "SF349886", "SF349887", "SF349888", "SF349889"),
    ("bono", "Bono 3 años", "SF45427", "SF45448", "SF45449", "SF45475"),
    ("bono", "Bono 5 años", "SF45428", "SF45450", "SF45451", "SF45476"),
    ("bono", "Bono 7 años", "SF45429", "SF45452", "SF45453", "SF45477"),
    ("bono", "Bono 10 años", "SF45430", "SF45454", "SF45455", "SF45478"),
    ("bono", "Bono 20 años", "SF45431", "SF45456", "SF45457", "SF45479"),
    ("bono", "Bono 30 años", "SF60720", "SF60721", "SF60722", "SF60723"),
]
NODOS_REAL = [
    ("udibono", "Udibono 3 años", "SF61784", "SF61785", "SF61786", "SF61787"),
    ("udibono", "Udibono 10 años", "SF45432", "SF45458", "SF45459", "SF45480"),
    ("udibono", "Udibono 20 años", "SF50761", "SF50765", "SF50766", "SF50763"),
    ("udibono", "Udibono 30 años", "SF50762", "SF50767", "SF50768", "SF50764"),
]
SERIE_UDI = "SP68257"


def descargar(url: str, datos: bytes | None = None, intentos: int = 3) -> bytes:
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, data=datos, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            ultimo = e
            print(f"  reintento {i + 1}: {e}", file=sys.stderr)
    raise RuntimeError(f"no se pudo descargar {url}: {ultimo}")


def num(s: str) -> float | None:
    s = s.strip().replace(",", "")
    if not s or s in ("N/E", "-"):
        return None
    return float(s)


def fecha_dmy(s: str) -> date:
    return datetime.strptime(s.strip(), "%d/%m/%Y").date()


# ------------------------------------------------------------------ posición
def obtener_posicion(instrumento: int) -> tuple[date | None, list[dict]]:
    """Lee la tabla de la posición de un instrumento (1 Cetes, 2 Bonos, 5 Udibonos)."""
    s = descargar(POSICION_URL.format(n=instrumento)).decode("latin-1")
    m = re.search(r"en circulaci[^<]*?al (\d{1,2}) de (\w+) de (\d{4})", html.unescape(s))
    fecha = date(int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1))) if m else None
    filas = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", s, flags=re.S):
        celdas = [html.unescape(re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, flags=re.S)]
        celdas = [re.sub(r"\s+", " ", c) for c in celdas if c.strip()]
        if not celdas or not re.match(r"\d\d/\d\d/\d{4}$", celdas[0]):
            continue
        fila = {"vence": fecha_dmy(celdas[0]).isoformat(),
                "saldo_colocacion": num(celdas[1]),
                "circulacion": num(celdas[5]),
                "dias": int(num(celdas[10]) or 0)}
        if len(celdas) >= 15:  # bonos con cupón
            fila.update({"cupones": int(num(celdas[11]) or 0), "plazo_cupon": int(num(celdas[12]) or 0),
                         "transcurridos": int(num(celdas[13]) or 0), "cupon": num(celdas[14])})
        filas.append(fila)
    return fecha, filas


# ------------------------------------------------------------------ series SIE
def obtener_series(id_cuadro: str, sector: int, series: list[str], ano_inicial: int, ano_final: int) -> dict[str, dict[str, float | None]]:
    """Exporta series del SIE en CSV (sin token).  Devuelve {fecha_iso: {serie: valor}}."""
    partes = [("idCuadro", id_cuadro), ("locale", "es"), ("sector", str(sector)), ("version", "3")]
    partes += [("series", s) for s in series]
    partes += [("anoInicial", str(ano_inicial)), ("anoFinal", str(ano_final)), ("tipoInformacion", "4,1"),
               ("formatoHorizontal", "false"), ("formatoCSV.x", "1"), ("formatoCSV.y", "1"), ("metadatosWeb", "true")]
    cuerpo = urllib.parse.urlencode(partes).encode()
    texto = descargar(SIE_SERIES_URL, cuerpo).decode("latin-1")
    filas = [r for r in csv.reader(io.StringIO(texto)) if r]
    enc = [i for i, r in enumerate(filas) if r[0] == "Fecha"]
    if not enc:
        raise RuntimeError(f"respuesta inesperada del SIE: {texto[:200]!r}")
    cab = filas[enc[0]]
    out: dict[str, dict[str, float | None]] = {}
    for r in filas[enc[0] + 1:]:
        if not re.match(r"\d\d/\d\d/\d{4}$", r[0]):
            continue
        out[fecha_dmy(r[0]).isoformat()] = {k: num(v) for k, v in zip(cab[1:], r[1:])}
    return out


def nodos_de(fila: dict, definicion) -> list[dict]:
    nodos = []
    for tipo, etiqueta, s_plazo, s_limpio, s_sucio, s_tasa in definicion:
        plazo, limpio, sucio, tasa = (fila.get(s) for s in (s_plazo, s_limpio, s_sucio, s_tasa))
        if not plazo or sucio is None:
            continue
        n = {"tipo": tipo, "etiqueta": etiqueta, "plazo": int(plazo), "limpio": limpio, "sucio": sucio}
        if tipo == "cete":
            n["precio"] = sucio  # precio por título de valor nominal 10
            n["tasa"] = tasa
        else:
            n["cupon"] = tasa
        nodos.append(n)
    return nodos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, default=250, help="fechas de curva a conservar (días hábiles)")
    ap.add_argument("--salida", default=AQUI, help="carpeta de salida")
    args = ap.parse_args()

    print("Posición de valores gubernamentales…")
    fecha_pos, cetes = obtener_posicion(1)
    _, bonos = obtener_posicion(2)
    _, udibonos = obtener_posicion(5)
    print(f"  al {fecha_pos}: {len(cetes)} Cetes, {len(bonos)} Bonos M, {len(udibonos)} Udibonos")

    hoy = date.today()
    ano_ini = (hoy - timedelta(days=int(args.dias * 1.6) + 30)).year
    print("Vector de precios (CF300)…")
    series_nom = [s for d in NODOS_NOMINAL for s in d[2:]]
    series_real = [s for d in NODOS_REAL for s in d[2:]]
    nominal = obtener_series("CF300", 18, series_nom, ano_ini, hoy.year)
    real = obtener_series("CF300", 18, series_real, ano_ini, hoy.year)
    print("Valor de la UDI (CP150)…")
    udi = obtener_series("CP150", 8, [SERIE_UDI], ano_ini, hoy.year + 1)

    fechas = sorted(nominal)[-args.dias:]
    curvas_nom = {f: nodos_de(nominal[f], NODOS_NOMINAL) for f in fechas}
    curvas_real = {f: nodos_de(real.get(f, {}), NODOS_REAL) for f in fechas}
    # Quita fechas sin curva (días inhábiles que el SIE reporta vacíos)
    fechas = [f for f in fechas if len(curvas_nom[f]) >= 6]
    udi_map = {f: v[SERIE_UDI] for f, v in udi.items() if v.get(SERIE_UDI) and f >= fechas[0]}
    print(f"  curvas del {fechas[0]} al {fechas[-1]} ({len(fechas)} fechas)")

    datos = {
        "generado": datetime.now().isoformat(timespec="seconds"),
        "fuentes": {
            "posicion": POSICION_URL.replace("{n}", "2"),
            "vector_precios": "https://www.banxico.org.mx/SieInternet/consultarDirectorioInternetAction.do?sector=18&accion=consultarCuadro&idCuadro=CF300&locale=es",
            "udi": "https://www.banxico.org.mx/SieInternet/consultarDirectorioInternetAction.do?sector=8&accion=consultarCuadro&idCuadro=CP150&locale=es",
        },
        "posicion": {"fecha": fecha_pos.isoformat() if fecha_pos else None, "bonos": bonos, "cetes": cetes, "udibonos": udibonos},
        "curvas": {"fechas": fechas, "nominal": {f: curvas_nom[f] for f in fechas}, "real": {f: curvas_real[f] for f in fechas}},
        "udi": udi_map,
        "series_sie": {"nominal": [list(d) for d in NODOS_NOMINAL], "real": [list(d) for d in NODOS_REAL], "udi": SERIE_UDI},
    }
    os.makedirs(args.salida, exist_ok=True)
    with open(os.path.join(args.salida, "datos.json"), "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.salida, "datos.js"), "w", encoding="utf-8") as f:
        f.write("// Generado por actualizar_datos.py — no editar a mano.\n")
        f.write("window.DATOS_BONOS = ")
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("Listo:", os.path.join(args.salida, "datos.json"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
