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

Proyección simple con 3 caras visibles (arriba, frente, derecha). Cada cara
comparte color con su opuesta no visible:

- arriba / abajo → azul
- frente / atrás → rojo
- izquierda / derecha → verde

### Orientación según el punto de fuga

El cubo no usa un ángulo de perspectiva fijo: se orienta hacia el **punto de
fuga** estimado de la escena, igual que la técnica de perspectiva de 1 punto
que usan los ilustradores.

- **Estimación del punto de fuga**: se toma el percentil más oscuro (más
  lejano, según la convención del modelo) de píxeles del mapa de profundidad
  — `VP_DARK_PERCENTILE`, 5% por defecto — y se calcula su centroide
  ponderado (los píxeles más lejanos pesan más). En una escena con un pasillo,
  calle o corredor, esto cae naturalmente cerca de donde convergen las líneas
  de fuga (el fondo de la escena). Se calcula una sola vez al cargar, en
  `estimateVanishingPoint()`.
- **Orientación del cubo**: la cara "trasera" (la que representa la
  profundidad "hacia adentro") recede en la dirección 2D real hacia el punto
  de fuga — no solo horizontal. Si el cubo está a la derecha del punto de
  fuga gira hacia la izquierda, a la izquierda gira hacia la derecha, y si
  el cubo queda por encima o por debajo del punto de fuga, inclina hacia
  abajo o hacia arriba respectivamente. `cubeVertices()` calcula el vector
  unitario cubo→punto de fuga y elige, en `drawCube()`, cuál de las dos caras
  de cada par opuesto (arriba/abajo, izquierda/derecha) es la que realmente
  queda visible según el signo de cada componente — la otra queda oculta
  detrás de la cara frontal. `CUBE_SKEW_MAG_X` / `CUBE_SKEW_MAG_Y` controlan
  cuánto se estira esa cara trasera en cada eje.
- Checkbox/tecla `V` muestra el punto de fuga estimado (círculo + línea
  punteada hacia el cubo). El círculo se puede **arrastrar** para corregir la
  estimación a mano cuando no cae donde debería.

Es una aproximación de perspectiva de 1 punto (un único punto de fuga global),
no una reconstrucción de cámara real — no tenemos intrínsecos ni un plano de
suelo calibrado, solo el mapa de profundidad relativo del modelo. Funciona
razonablemente bien en escenas con una dirección de perspectiva dominante
(calles, pasillos); en escenas sin eso, el punto de fuga estimado puede no
significar mucho.

## Pendiente / ideas descartadas por ahora

- Oclusión (que un objeto real más cercano tape parte del cubo): se probó una
  primera versión pixel a pixel y no convenció visualmente; queda fuera por
  ahora, se retomará más adelante.
- Sombra bajo el cubo: removida a pedido, se puede reintroducir si hace falta.
