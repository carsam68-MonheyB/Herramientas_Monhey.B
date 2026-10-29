# S&P 500 · Ventanas móviles

Web app estática (HTML + CSS + JS, sin dependencias) que mide los rendimientos históricos del S&P 500 (índice de precio ^SPX) con ventanas móviles de 1 a 15 años: cuántas ventanas terminaron en positivo, cuántas en negativo y el rendimiento logarítmico promedio de cada horizonte. Toda la interfaz está en español y el cálculo ocurre en el navegador.

**Los rendimientos son nominales:** índice de precio sin dividendos ni inflación.

## Metodología

1. **Datos.** Cierres diarios del ^SPX. Se ordenan por fecha, se quitan duplicados (se conserva la primera aparición), se descartan filas sin cierre válido y se filtra desde el 01/01/1980. No se inventan ni interpolan precios: lo que falta se omite y se avisa en pantalla.
2. **Horizontes.** De 1 a 15 años calendario.
3. **Fechas de inicio.** Cada día con cierre, empezando en el primer día hábil a partir del 01/01/1980 y avanzando de uno en uno. Precio de entrada: el cierre de ese día.
4. **Fecha final.** La misma fecha calendario N años después. Si ese día no hubo mercado se usa el último cierre disponible en o antes de esa fecha (búsqueda binaria sobre las fechas ordenadas). Si el inicio es un 29 de febrero, la fecha objetivo es el 28 de febrero.
5. **Corte.** La ventana solo cuenta si su fecha objetivo cae en o antes del último dato disponible.
6. **Rendimiento.** r = ln(P_final / P_inicial). Positiva si r > 0, negativa si r < 0; las ventanas con r = 0 se cuentan aparte. Por horizonte se reporta: número de ventanas, positivas y negativas con su %, promedio de r, promedio de r/N (anualizado), tasa anual efectiva exp(promedio anualizado) − 1, mínimo y máximo con su fecha de inicio, y primera y última fecha de inicio usadas.

Formato: porcentajes con 2 decimales, fechas en DD/MM/AAAA. Los rendimientos logarítmicos se muestran en pantalla como porcentaje (ln × 100); en los CSV van como número con 6 decimales.

## Fuente de datos y cómo actualizarlos

- **Stooq.** `https://stooq.com/q/d/l/?s=^spx&i=d` devuelve un CSV con `Date,Open,High,Low,Close,Volume`. El navegador no puede pedirlo directamente (CORS), así que el botón **Actualizar datos** llama a la función de Netlify `netlify/functions/spx.mjs`, que descarga el CSV y lo reenvía. Stooq limita las descargas diarias por IP; si lo supera, la función devuelve un error legible y la app lo muestra.
- **CSV propio.** Arrastra o elige un archivo con una columna de fecha (`Date` o `Fecha`, en AAAA-MM-DD o DD/MM/AAAA) y una de cierre (`Close` o `Cierre`). Acepta separador coma, punto y coma o tabulador, y decimales con punto o coma.
- Los últimos datos cargados se guardan en `localStorage` del navegador y se reutilizan al volver a abrir la página, hasta que se actualicen o se cargue otro archivo.

En pantalla se muestran la fuente, la primera y última fecha, el número de cierres, el último cierre y los avisos de limpieza.

## Archivos

- `index.html` · estructura de la página y texto de metodología.
- `styles.css` · estilos (paleta Monhey.B, modo oscuro).
- `motor.js` · motor puro: fechas, lectura y limpieza del CSV, ventanas, estadísticas y exportación. Se carga igual en el navegador y en Node.
- `app.js` · carga de datos, tabla, gráficas SVG, exportación.
- `netlify/functions/spx.mjs` · función que descarga el CSV de Stooq.
- `servidor-local.mjs` · servidor de desarrollo sin dependencias.
- `pruebas/motor.test.js` · pruebas unitarias.
- `../netlify.toml` · configuración de Netlify (publica la raíz y apunta a la carpeta de funciones).

## Correr localmente

```bash
# desde la raíz del repositorio
node sp500-ventanas/servidor-local.mjs
# abre http://localhost:8888/sp500-ventanas/
```

El servidor sirve el repositorio completo y atiende `/.netlify/functions/spx` con el mismo código que se publica. Sin salida a internet, la función puede devolver un CSV local:

```bash
SPX_CSV_LOCAL=/ruta/a/un.csv node sp500-ventanas/servidor-local.mjs
```

También funciona `netlify dev` si tienes la CLI de Netlify instalada.

## Pruebas

```bash
node --test "sp500-ventanas/pruebas/*.test.js"
```

Usan series sintéticas pequeñas con resultado conocido a mano y cubren fines de semana, el 29 de febrero, el corte en la última fecha, el conteo de positivas, negativas y cero, la búsqueda binaria contra una búsqueda lineal de referencia, la lectura del CSV (formato Stooq y formato español) y las exportaciones. Además comprueban que en cada horizonte positivas + negativas + cero = total de ventanas; la app repite esa comprobación en pantalla.

## Exportar

- **Descargar resumen (CSV):** una fila por horizonte con todas las columnas de la tabla.
- **Descargar detalle de ventanas (CSV):** todas las ventanas con `horizonte, fecha_inicio, precio_inicio, fecha_fin, precio_fin, ln`. `fecha_fin` es la fecha del cierre realmente usado (puede ser anterior a la fecha objetivo si ese día no hubo mercado).

Separador coma y decimales con punto.
