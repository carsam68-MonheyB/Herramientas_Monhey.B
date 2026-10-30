"""Pruebas de valuacion.py.  Ejecutar:  python3 bonos/pruebas/test_valuacion.py"""
import json
import os
import subprocess
import sys
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
import valuacion as V  # noqa: E402

# Vector de precios de Banxico (CF300) del 29/10/2026: precios sucios y cupones
# de los títulos de referencia.  Sirven de nodos para el bootstrapping.
REFERENCIA = [
    {"tipo": "cete", "plazo": 28, "precio": 9.951008, "etiqueta": "Cetes 28"},
    {"tipo": "cete", "plazo": 91, "precio": 9.834058, "etiqueta": "Cetes 91"},
    {"tipo": "cete", "plazo": 182, "precio": 9.670011, "etiqueta": "Cetes 182"},
    {"tipo": "cete", "plazo": 350, "precio": 9.355996, "etiqueta": "Cetes 364"},
    {"tipo": "cete", "plazo": 700, "precio": 8.669883, "etiqueta": "Cetes 2a"},
    {"tipo": "bono", "plazo": 1218, "sucio": 102.467069, "cupon": 8.5, "etiqueta": "Bono 3a"},
    {"tipo": "bono", "plazo": 1995, "sucio": 97.171983, "cupon": 8.0, "etiqueta": "Bono 5a"},
    {"tipo": "bono", "plazo": 3402, "sucio": 93.227097, "cupon": 8.0, "etiqueta": "Bono 10a"},
    {"tipo": "bono", "plazo": 5859, "sucio": 86.503874, "cupon": 7.75, "etiqueta": "Bono 20a"},
    {"tipo": "bono", "plazo": 10409, "sucio": 85.300785, "cupon": 8.0, "etiqueta": "Bono 30a"},
]
# Precio limpio publicado por Banxico el 29/10/2026 para los mismos títulos
LIMPIOS = {1218: 101.144847, 1995: 97.016427, 3402: 91.982653, 5859: 83.339291, 10409: 82.034118}


class FormulasBanxico(unittest.TestCase):
    def test_cupones_y_dias_transcurridos_coinciden_con_posicion_banxico(self):
        # Posición al 28/10/2026: (días por vencer, cupones por cortar, días transcurridos)
        for plazo, k, d in [(127, 1, 55), (218, 2, 146), (1996, 11, 6), (10410, 58, 146), (3830, 22, 174)]:
            self.assertEqual(V.cupones_por_cortar(plazo), k)
            self.assertEqual(V.dias_transcurridos(plazo), d)

    def test_intereses_devengados_coinciden_con_vector_de_precios(self):
        for ins in REFERENCIA:
            if ins["tipo"] == "bono":
                dev = ins["sucio"] - LIMPIOS[ins["plazo"]]
                self.assertAlmostEqual(V.intereses_devengados(ins["cupon"], ins["plazo"]), dev, places=5)

    def test_rendimiento_y_precio_son_inversos(self):
        for r in (3.0, 8.1, 12.5):
            p = V.precio_sucio_por_rendimiento(r, 7.75, 2947)
            self.assertAlmostEqual(V.rendimiento_por_precio_sucio(p, 7.75, 2947), r, places=8)
        p = V.precio_limpio_por_rendimiento(9.0, 8.0, 3402)
        self.assertAlmostEqual(V.rendimiento_por_precio_limpio(p, 8.0, 3402), 9.0, places=8)

    def test_rendimientos_implicitos_del_vector_son_razonables(self):
        # Rendimientos redondos que publica el proveedor de precios
        c = V.bootstrap(REFERENCIA)
        ytm = {n.plazo: n.tasa_mercado for n in c.nodos}
        self.assertAlmostEqual(ytm[1218], 8.10, places=3)
        self.assertAlmostEqual(ytm[3402], 9.29, places=3)

    def test_cete(self):
        self.assertAlmostEqual(V.precio_cete_por_rendimiento(6.329983, 28), 9.951008, places=5)
        self.assertAlmostEqual(V.rendimiento_cete_por_precio(9.951008, 28), 6.329983, places=4)


class Bootstrapping(unittest.TestCase):
    def setUp(self):
        self.curva = V.bootstrap(REFERENCIA)

    def test_nodos_ordenados_y_factores_decrecientes(self):
        plazos = [n.plazo for n in self.curva.nodos]
        self.assertEqual(plazos, sorted(plazos))
        fds = [n.fd for n in self.curva.nodos]
        self.assertEqual(fds, sorted(fds, reverse=True))
        self.assertTrue(all(0 < f < 1 for f in fds))

    def test_reprecia_exactamente_los_instrumentos_de_referencia(self):
        for ins in REFERENCIA:
            if ins["tipo"] == "cete":
                self.assertAlmostEqual(10 * self.curva.fd(ins["plazo"]), ins["precio"], places=9)
            else:
                v = V.valuar_bono(self.curva, ins["plazo"], ins["cupon"])
                self.assertAlmostEqual(v["sucio"], ins["sucio"], places=6)
                self.assertAlmostEqual(v["limpio"], LIMPIOS[ins["plazo"]], places=5)

    def test_interpolacion_lineal_entre_nodos_y_plana_en_extremos(self):
        a, b = self.curva.nodos[5], self.curva.nodos[6]
        t = (a.plazo + b.plazo) / 2
        self.assertAlmostEqual(self.curva.tasa(t), (a.tasa + b.tasa) / 2)
        self.assertAlmostEqual(self.curva.tasa(1), self.curva.nodos[0].tasa)
        self.assertAlmostEqual(self.curva.tasa(20000), self.curva.nodos[-1].tasa)

    def test_curva_plana_reproduce_la_formula_de_banxico(self):
        # Con todos los nodos en z = 9 % el precio teórico es el precio por rendimiento al 9 %.
        plana = V.bootstrap([{"tipo": "cete", "plazo": t, "precio": 10 * V.fd_de_tasa(9.0, t)} for t in (28, 364, 3650)])
        for plazo, cupon in [(2402, 7.5), (127, 5.5), (10410, 8.0)]:
            v = V.valuar_bono(plana, plazo, cupon)
            self.assertAlmostEqual(v["sucio"], V.precio_sucio_por_rendimiento(9.0, cupon, plazo), places=8)
            self.assertAlmostEqual(v["rendimiento"], 9.0, places=6)

    def test_valuacion_de_bono_no_referencia_cae_entre_vecinos(self):
        v = V.valuar_bono(self.curva, 2401, 7.5)  # Bono 26/05/2033
        self.assertGreater(v["rendimiento"], 8.6892)
        self.assertLess(v["rendimiento"], 9.29)
        self.assertEqual(len(v["flujos"]), 14)
        self.assertAlmostEqual(sum(f["vp"] for f in v["flujos"]), v["sucio"])


class ReplicaJavaScript(unittest.TestCase):
    """valuacion.js debe dar los mismos números que valuacion.py."""

    def test_mismos_resultados_que_node(self):
        try:
            subprocess.run(["node", "--version"], check=True, capture_output=True)
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("node no disponible")
        script = os.path.join(AQUI, "prueba_valuacion.js")
        salida = subprocess.run(["node", script, json.dumps(REFERENCIA)], check=True, capture_output=True, text=True).stdout
        js = json.loads(salida)
        curva = V.bootstrap(REFERENCIA)
        for n_py, n_js in zip(curva.nodos, js["nodos"]):
            self.assertEqual(n_py.plazo, n_js["plazo"])
            self.assertAlmostEqual(n_py.fd, n_js["fd"], places=12)
            self.assertAlmostEqual(n_py.tasa, n_js["tasa"], places=10)
        for caso in js["valuaciones"]:
            v = V.valuar_bono(curva, caso["plazo"], caso["cupon"])
            self.assertAlmostEqual(v["sucio"], caso["sucio"], places=10)
            self.assertAlmostEqual(v["limpio"], caso["limpio"], places=10)
            self.assertAlmostEqual(v["rendimiento"], caso["rendimiento"], places=8)


if __name__ == "__main__":
    unittest.main()
