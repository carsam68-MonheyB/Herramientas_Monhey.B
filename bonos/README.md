# Calculadora de bonos gubernamentales

Valúa cualquier **Cete, Bono M o Udibono** en circulación con la curva cupón cero
construida por *bootstrapping* a partir de datos públicos de Banco de México, y
compara el precio teórico con el precio de compra para mostrar la plusvalía o
minusvalía.

Abrir `index.html` en el navegador (funciona desde el disco o publicada en GitHub
Pages). Todo el cálculo corre en el navegador.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | La calculadora: selector de emisión, resultado, datos generales, curva, flujos descontados. |
| `valuacion.js` | Fórmulas de Banxico, bootstrapping y valuación (JavaScript, usado por la página). |
| `valuacion.py` | Las mismas fórmulas en Python; es la referencia documentada. |
| `actualizar_datos.py` | Descarga de Banxico las emisiones en circulación, el vector de precios y la UDI; genera `datos.js` y `datos.json`. |
| `datos.js` / `datos.json` | Datos descargados (último año de curvas). `datos.js` es el que carga la página. |
| `pruebas/` | Pruebas: fórmulas contra cifras publicadas por Banxico, repreciación exacta de los nodos y coincidencia Python ↔ JavaScript. |

## Actualizar los datos

```bash
python3 bonos/actualizar_datos.py          # último año de curvas (250 fechas)
python3 bonos/actualizar_datos.py --dias 60
```

No necesita token ni librerías externas. Descarga:

1. **Posición de valores gubernamentales** (`PresentaDetallePosicionGub.faces`,
   instrumentos 1 Cetes, 2 Bonos M, 5 Udibonos): fecha de vencimiento, monto en
   circulación, días por vencer, cupones por cortar y tasa cupón de cada emisión.
2. **Vector de precios de títulos gubernamentales "on the run"** (cuadro CF300 del
   SIE): plazo, precio limpio, precio sucio y cupón de los títulos de referencia
   (Cetes 28, 91, 182, 364 días y 2 años; Bonos 3, 5, 7, 10, 20 y 30 años;
   Udibonos 3, 10, 20 y 30 años).
3. **Valor de la UDI** (cuadro CP150, serie SP68257).

Desde la propia página, con un token gratuito de la
[API del SIE](https://www.banxico.org.mx/SieAPIRest/service/v1/token), se pueden
descargar las fechas de curva que falten (la API permite llamadas desde el
navegador). El listado de emisiones sólo se renueva con el script.

## Método

* **Flujos.** Cupones de 182 días, año de 360 días: cupón = VN · tasa · 182/360.
  Cupones por cortar K = ⌈plazo/182⌉; días transcurridos d = 182·K − plazo
  (coincide con la posición de Banxico, incluidas las emisiones con primer cupón
  irregular).
* **Curva cupón cero.** Los Cetes son cupón cero y dan el factor de descuento
  directamente (FD = precio/10). Cada bono de referencia añade un nodo en su
  vencimiento: se resuelve la tasa cero z(T) que hace que sus flujos, descontados
  con la curva conocida e interpolada linealmente entre el nodo anterior y T,
  sumen exactamente su precio sucio de mercado (bootstrapping). Los plazos sin
  tasa observada quedan determinados por esa interpolación; antes del primer
  nodo y después del último la curva es plana.
* **Convención de la tasa cero.** Tasa anual act/360 capitalizable cada 182 días,
  FD(t) = (1 + z·182/360)^(−t/182), la misma de la fórmula oficial de precio de
  los Bonos; con una curva plana el precio teórico coincide con el precio por
  rendimiento de Banxico. Se muestra también la tasa simple act/360 equivalente.
* **Precio teórico.** Suma de cada flujo por su factor de descuento. Precio
  limpio = sucio − cupón·d/182. El rendimiento implícito es el que reproduce ese
  precio con la fórmula de Banxico.
* **Plusvalía / minusvalía.** Precio sucio a la fecha de valuación (el teórico, o
  el precio de mercado capturado, por ejemplo el de Cetesdirecto) menos el precio
  sucio pagado, sin contar los cupones ya cobrados, igual que la muestra
  Cetesdirecto. El precio pagado se captura como rendimiento, precio limpio o
  precio sucio en la fecha de compra.
* **TIR de la inversión.** Flujos fechados: la compra (precio sucio pagado), cada
  cupón cobrado en su fecha y el valor hoy. La TIR es la tasa anual que los iguala,
  como XIRR de Excel (base 365). Se reportan además los días invertidos, los
  cupones cobrados y la ganancia total (cupones + plusvalía). Los Udibonos se valúan
  en UDIs con la curva real y se convierten a pesos con la UDI de la fecha de
  valuación.

## Pruebas

```bash
python3 bonos/pruebas/test_valuacion.py
```

Comprueban que los intereses devengados y los cupones por cortar coinciden con
lo publicado por Banxico, que la curva reprecia exactamente cada título de
referencia, que una curva plana reproduce la fórmula oficial y que
`valuacion.js` da los mismos números que `valuacion.py` (requiere Node).
