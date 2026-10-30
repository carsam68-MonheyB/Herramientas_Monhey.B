"""Valuación de valores gubernamentales mexicanos (Cetes, Bonos M, Udibonos).

Convenciones (Banxico, "Descripción técnica" de cada instrumento):
  * Año de 360 días, cupones de 182 días, cupón = VN * tasa * 182 / 360.
  * K = cupones por cortar = ceil(plazo / 182); d = días transcurridos del cupón
    vigente = 182 * K - plazo.  Coincide con lo que publica Banxico en la
    "Posición de valores gubernamentales".
  * Precio por rendimiento (fórmula oficial, capitalización cada 182 días):
        R = r * 182 / 360
        P_sucio = [C + C/R (1 - (1+R)^-(K-1)) + VN (1+R)^-(K-1)] / (1+R)^(1 - d/182)
        P_limpio = P_sucio - C * d / 182
  * Curva cupón cero: factores de descuento FD(t).  La tasa cupón cero z(t) se
    expresa como tasa anual act/360 capitalizable cada 182 días, la misma
    convención de la fórmula de precio de los Bonos:
        FD(t) = (1 + z(t) * 182 / 360) ^ (-t / 182)
    Con una curva plana en z el precio teórico coincide exactamente con el precio
    por rendimiento de Banxico a tasa z.  Entre nodos se interpola linealmente
    sobre z(t); antes del primer nodo y después del último la curva es plana.
    También se reporta la tasa simple act/360 equivalente (convención Cetes):
        z_simple(t) = (1 / FD(t) - 1) * 360 / t

Bootstrapping: los Cetes dan FD directamente (cupón cero). Cada bono de
referencia añade un nodo en su vencimiento: se busca la z(T) que hace que la suma
de sus flujos descontados con la curva (ya conocida hasta el nodo anterior, e
interpolada entre ese nodo y T) sea igual a su precio sucio de mercado.  Así los
periodos sin tasa observada quedan determinados por la propia curva.

Este módulo es la referencia en Python; `valuacion.js` es su réplica para el
navegador y las pruebas comprueban que ambos dan lo mismo.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

PLAZO_CUPON = 182
BASE = 360


# ----------------------------------------------------------------- utilidades
def cupones_por_cortar(plazo: int) -> int:
    return max(1, -(-plazo // PLAZO_CUPON))


def dias_transcurridos(plazo: int) -> int:
    return cupones_por_cortar(plazo) * PLAZO_CUPON - plazo


def cupon(tasa: float, vn: float = 100.0) -> float:
    """Monto del cupón por título (tasa en por ciento)."""
    return vn * tasa / 100.0 * PLAZO_CUPON / BASE


def flujos_bono(plazo: int, tasa: float, vn: float = 100.0):
    """Lista de (días, monto) de los flujos pendientes de un bono."""
    k = cupones_por_cortar(plazo)
    d = dias_transcurridos(plazo)
    c = cupon(tasa, vn)
    out = []
    for i in range(1, k + 1):
        t = PLAZO_CUPON - d + PLAZO_CUPON * (i - 1)
        out.append((t, c + (vn if i == k else 0.0)))
    return out


# ----------------------------------------------------- fórmulas de Banxico
def precio_sucio_por_rendimiento(r: float, tasa: float, plazo: int, vn: float = 100.0) -> float:
    """Precio sucio con la fórmula oficial de Banxico; r y tasa en por ciento."""
    k = cupones_por_cortar(plazo)
    d = dias_transcurridos(plazo)
    c = cupon(tasa, vn)
    R = r / 100.0 * PLAZO_CUPON / BASE
    if abs(R) < 1e-12:
        bruto = c * k + vn
    else:
        bruto = c + c / R * (1 - (1 + R) ** -(k - 1)) + vn * (1 + R) ** -(k - 1)
    return bruto / (1 + R) ** (1 - d / PLAZO_CUPON)


def intereses_devengados(tasa: float, plazo: int, vn: float = 100.0) -> float:
    return cupon(tasa, vn) * dias_transcurridos(plazo) / PLAZO_CUPON


def precio_limpio_por_rendimiento(r, tasa, plazo, vn=100.0):
    return precio_sucio_por_rendimiento(r, tasa, plazo, vn) - intereses_devengados(tasa, plazo, vn)


def rendimiento_por_precio_sucio(p_sucio: float, tasa: float, plazo: int, vn: float = 100.0) -> float:
    """Rendimiento (por ciento) que reproduce el precio sucio; bisección."""
    lo, hi = -50.0, 200.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if precio_sucio_por_rendimiento(mid, tasa, plazo, vn) > p_sucio:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def rendimiento_por_precio_limpio(p_limpio, tasa, plazo, vn=100.0):
    return rendimiento_por_precio_sucio(p_limpio + intereses_devengados(tasa, plazo, vn), tasa, plazo, vn)


def precio_cete_por_rendimiento(r: float, plazo: int, vn: float = 10.0) -> float:
    return vn / (1 + r / 100.0 * plazo / BASE)


def rendimiento_cete_por_precio(p: float, plazo: int, vn: float = 10.0) -> float:
    return (vn / p - 1) * BASE / plazo * 100.0


# ------------------------------------------------------------ curva cero
@dataclass
class Nodo:
    plazo: int
    fd: float
    origen: str          # "cete", "bono", "udibono"
    etiqueta: str = ""
    precio: float = 0.0  # precio sucio observado
    tasa_mercado: float = 0.0  # rendimiento observado del instrumento (%)
    cupon: float = 0.0

    @property
    def tasa(self) -> float:
        """Tasa cupón cero anual, capitalizable cada 182 días (por ciento)."""
        return tasa_de_fd(self.fd, self.plazo)

    @property
    def tasa_simple(self) -> float:
        """Tasa simple act/360 equivalente (por ciento)."""
        return (1 / self.fd - 1) * BASE / self.plazo * 100.0


def fd_de_tasa(z: float, t: float) -> float:
    return (1 + z / 100.0 * PLAZO_CUPON / BASE) ** (-t / PLAZO_CUPON)


def tasa_de_fd(fd: float, t: float) -> float:
    return (fd ** (-PLAZO_CUPON / t) - 1) * BASE / PLAZO_CUPON * 100.0


@dataclass
class Curva:
    nodos: list = field(default_factory=list)

    def tasa(self, t: float) -> float:
        """z(t) en por ciento, interpolación lineal sobre los nodos."""
        n = self.nodos
        if not n:
            raise ValueError("curva vacía")
        if t <= n[0].plazo:
            return n[0].tasa
        if t >= n[-1].plazo:
            return n[-1].tasa
        for a, b in zip(n, n[1:]):
            if a.plazo <= t <= b.plazo:
                w = (t - a.plazo) / (b.plazo - a.plazo)
                return a.tasa + w * (b.tasa - a.tasa)
        raise AssertionError

    def fd(self, t: float) -> float:
        if t <= 0:
            return 1.0
        return fd_de_tasa(self.tasa(t), t)

    def tasa_simple(self, t: float) -> float:
        if t <= 0:
            return self.tasa(1)
        return (1 / self.fd(t) - 1) * BASE / t * 100.0

    def valor_presente(self, flujos) -> float:
        return sum(m * self.fd(t) for t, m in flujos)


def bootstrap(instrumentos) -> Curva:
    """Construye la curva cero a partir de instrumentos de referencia.

    `instrumentos`: lista de dicts con
      tipo "cete":   plazo, precio (por título de VN 10) o tasa (%)
      tipo "bono" / "udibono": plazo, sucio (precio sucio por VN 100), cupon (%)
    Se procesan en orden de plazo; el nodo de cada bono se resuelve por
    bisección para que la curva reprecie exactamente el instrumento.
    """
    curva = Curva()
    orden = sorted((i for i in instrumentos if i.get("plazo")), key=lambda i: i["plazo"])
    for ins in orden:
        plazo = int(ins["plazo"])
        if ins["tipo"] == "cete":
            vn = ins.get("vn", 10.0)
            if ins.get("precio") is not None:
                fd = ins["precio"] / vn
                tasa = rendimiento_cete_por_precio(ins["precio"], plazo, vn)
            else:
                tasa = ins["tasa"]
                fd = 1 / (1 + tasa / 100.0 * plazo / BASE)
            if curva.nodos and plazo <= curva.nodos[-1].plazo:
                continue  # plazo repetido: se conserva el primero
            curva.nodos.append(Nodo(plazo, fd, "cete", ins.get("etiqueta", f"Cete {plazo}d"),
                                    ins.get("precio") or vn * fd, tasa, 0.0))
        else:
            sucio = float(ins["sucio"])
            tasa_cupon = float(ins["cupon"])
            if curva.nodos and plazo <= curva.nodos[-1].plazo:
                continue
            flujos = flujos_bono(plazo, tasa_cupon, 100.0)
            # flujos ya cubiertos por la curva conocida
            if curva.nodos:
                t_prev = curva.nodos[-1].plazo
                z_prev = curva.nodos[-1].tasa
            else:
                t_prev, z_prev = 0, None

            def precio_con(z_t: float) -> float:
                total = 0.0
                for t, m in flujos:
                    if t <= t_prev:
                        total += m * curva.fd(t)
                    else:
                        if z_prev is None:
                            z = z_t
                        else:
                            w = (t - t_prev) / (plazo - t_prev)
                            z = z_prev + w * (z_t - z_prev)
                        total += m * fd_de_tasa(z, t)
                return total

            lo, hi = -90.0, 300.0
            for _ in range(200):
                mid = (lo + hi) / 2
                if precio_con(mid) > sucio:
                    lo = mid
                else:
                    hi = mid
            z_t = (lo + hi) / 2
            curva.nodos.append(Nodo(plazo, fd_de_tasa(z_t, plazo), ins["tipo"],
                                    ins.get("etiqueta", f"{ins['tipo']} {plazo}d"), sucio,
                                    rendimiento_por_precio_sucio(sucio, tasa_cupon, plazo), tasa_cupon))
    return curva


# ------------------------------------------------------------ valuación
def valuar_bono(curva: Curva, plazo: int, tasa: float, vn: float = 100.0) -> dict:
    """Precio teórico de un bono con la curva cero (flujo por flujo)."""
    flujos = flujos_bono(plazo, tasa, vn)
    detalle = []
    sucio = 0.0
    for t, m in flujos:
        fd = curva.fd(t)
        detalle.append({"dias": t, "flujo": m, "tasa_cero": curva.tasa(t),
                        "tasa_simple": curva.tasa_simple(t), "fd": fd, "vp": m * fd})
        sucio += m * fd
    devengados = intereses_devengados(tasa, plazo, vn)
    return {
        "plazo": plazo,
        "cupones": cupones_por_cortar(plazo),
        "dias_transcurridos": dias_transcurridos(plazo),
        "cupon": cupon(tasa, vn),
        "devengados": devengados,
        "sucio": sucio,
        "limpio": sucio - devengados,
        "rendimiento": rendimiento_por_precio_sucio(sucio, tasa, plazo, vn),
        "flujos": detalle,
    }


def dias_entre(a: date, b: date) -> int:
    return (b - a).days
