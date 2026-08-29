# Demo: escala por profundidad (cubo sobre imagen real)

Prototipo para validar el concepto de colocar un objeto 2D/isométrico sobre una
foto real, cuyo tamaño se ajusta automáticamente según la profundidad estimada
del punto donde se coloca (más lejos = más chico, más cerca = más grande),
usando un mapa de profundidad ya generado por un modelo externo.

## Cómo correrlo

Abrir `index.html` directamente en el navegador (no requiere build ni servidor).
Click para colocar el cubo, arrastrar para moverlo, checkbox o tecla `D` para
ver el mapa de profundidad superpuesto.

## Estructura

```
index.html   estructura de la página
style.css    estilos / diseño
script.js    toda la lógica (carga de assets, muestreo de profundidad, dibujo)
data/        assets de entrada (ver abajo)
```

## Datos de entrada

Generados por el modelo `chenxwh/depth-anything-v2` en Replicate:

- `data/background.jpg` — foto real (RGB), se muestra tal cual.
- `data/background/prediction-0.png` — mapa de profundidad en escala de grises,
  misma resolución que `background.jpg`. Convención: **brillo alto (255) = cerca,
  brillo bajo (0) = lejos**. Es el que se usa para calcular el tamaño del cubo.
  Va embebido en base64 dentro de `script.js` (`DEPTH_DATA_URI`) en vez de
  cargarse por ruta: es el único asset del que se leen píxeles con
  `getImageData`, y bajo `file://` eso "tainta" el canvas si la imagen se
  cargó como recurso cross-origin/opaco. `background.jpg` y `prediction-1.png`
  no tienen ese problema porque solo se dibujan con `drawImage`, nunca se leen
  de vuelta, así que se mantienen como archivos externos normales.
- `data/background/prediction-1.png` — versión coloreada del mismo mapa,
  generada por el propio modelo; solo se usa para el toggle de visualización
  (no se usa para calcular nada).

Se descartó una corrida anterior con otro modelo que entregaba profundidad
métrica en un JSON (float32 + sky_mask), porque este modelo da mejor resultado
visual y, al coincidir en resolución exacta con la imagen real, no requiere
reescalar/transformar coordenadas.

## Cómo funciona el mapeo profundidad → tamaño

1. Al hacer click/arrastrar, se toma el punto `(x, y)` como el punto de apoyo
   del cubo en el suelo de la escena (el cubo crece hacia arriba desde ahí,
   no se centra en el punto).
2. Se promedia un área circular de `SAMPLE_RADIUS` px alrededor de ese punto en
   el mapa de profundidad (para evitar ruido de un solo píxel).
3. El valor promedio (0–255) se mapea linealmente a un tamaño de cubo entre
   `MIN_SIZE` y `MAX_SIZE` (constantes al inicio de `script.js`).
4. Si el punto cae fuera de los límites de la imagen, el evento se ignora.

## Cubo

Proyección isométrica simple con 3 caras visibles (arriba, frente, derecha).
Cada cara comparte color con su opuesta no visible:

- arriba / abajo → azul
- frente / atrás → rojo
- izquierda / derecha → verde

`CUBE_SKEW_X` / `CUBE_SKEW_Y` controlan el ángulo de la perspectiva.

## Pendiente / ideas descartadas por ahora

- Oclusión (que un objeto real más cercano tape parte del cubo): se probó una
  primera versión pixel a pixel y no convenció visualmente; queda fuera por
  ahora, se retomará más adelante.
- Sombra bajo el cubo: removida a pedido, se puede reintroducir si hace falta.
