# Demo: escala por profundidad (objeto sobre imagen real)

Prototipo para validar el concepto de colocar un objeto sobre una foto real,
cuyo tamaño se ajusta automáticamente según la profundidad estimada del punto
donde se coloca (más lejos = más chico, más cerca = más grande), usando un
mapa de profundidad ya generado por un modelo externo. El objeto puede ser un
cubo de referencia o una imagen de producto (PNG con fondo transparente) —
ambos comparten exactamente el mismo posicionamiento/escalado/orientación,
solo cambia qué se dibuja.

## Cómo correrlo

Abrir `index.html` directamente en el navegador (no requiere build ni servidor).
Click para colocar el objeto, arrastrar para moverlo, checkbox o tecla `D` para
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
- `data/product.png` — imagen de producto con fondo transparente, para el
  modo "imagen de producto" (ver más abajo). Igual que `prediction-0.png`,
  va embebida en base64 dentro de `script.js` (`PRODUCT_DATA_URI`) porque
  también se le lee `getImageData` (para recortar el margen transparente,
  ver `computeAlphaBBox`), y eso tainta el canvas bajo `file://` si se carga
  por ruta.

Se descartó una corrida anterior con otro modelo que entregaba profundidad
métrica en un JSON (float32 + sky_mask), porque este modelo da mejor resultado
visual y, al coincidir en resolución exacta con la imagen real, no requiere
reescalar/transformar coordenadas.

## Control manual de escala

El slider "escala" aplica un multiplicador (`cubeScale`, 0.3x–3x) sobre el
tamaño que ya calculó el mapeo por profundidad — no lo reemplaza. `cube.size`
sigue siendo el tamaño base derivado de la profundidad; se multiplica por
`cubeScale` al construir la geometría del cubo (`cubeVertices()`) o el
rectángulo del producto (`drawProduct()`), así que el efecto es consistente
en todo (dibujo, hitbox de arrastre, HUD) y en ambos modos.

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

Proyección simple con 3 caras visibles. Cada cara comparte color con su
opuesta no visible, y ese color coincide con el eje al que pertenece (ver
"Ejes" más abajo):

- arriba / abajo → verde (eje Y)
- izquierda / derecha → rojo (eje X)
- frente / atrás → azul (eje Z)

(Esta sección aplica al modo "cubo"; ver "Imagen de producto" más abajo para
el otro modo.)

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

  (Se probó una versión donde la cara trasera además se achicaba/convergía
  geométricamente con el tamaño del cubo, imitando perspectiva real — quedaba
  demasiado exagerada y el cubo es solo referencial, así que se descartó a
  favor de este desplazamiento uniforme más simple.)
- Checkbox/tecla `V` muestra el punto de fuga estimado (círculo + línea
  punteada hacia el cubo). El círculo se puede **arrastrar** para corregir la
  estimación a mano cuando no cae donde debería.
- Checkbox/tecla `A` muestra los ejes locales del cubo, saliendo de su centro
  geométrico: **X = rojo** (horizontal), **Y = verde** (vertical), **Z = azul**
  (profundidad — misma dirección hacia el punto de fuga que usa `cubeVertices`
  para el skew, así se ve directamente hacia dónde "gira" el cubo). Cada
  flecha apunta hacia el lado que realmente está visible en ese momento (si
  se ve la cara derecha, la flecha X sale hacia la derecha; si se ve la de
  abajo, la flecha Y sale hacia abajo), con el mismo criterio de signo que
  usa `drawCube()` para elegir qué cara de cada par dibujar.

Es una aproximación de perspectiva de 1 punto (un único punto de fuga global),
no una reconstrucción de cámara real — no tenemos intrínsecos ni un plano de
suelo calibrado, solo el mapa de profundidad relativo del modelo. Funciona
razonablemente bien en escenas con una dirección de perspectiva dominante
(calles, pasillos); en escenas sin eso, el punto de fuga estimado puede no
significar mucho.

## Imagen de producto

Radio "cubo" / "imagen de producto" en el panel de controles cambia qué se
dibuja sobre el punto colocado. El punto en sí (`cube` — se reutiliza el
mismo objeto de estado para ambos modos) no cambia: mismo punto de apoyo,
mismo tamaño derivado de profundidad, mismo `cubeScale`. Solo cambia
`render()`, que llama a `drawCube()` o a `drawProduct()`.

- `drawProduct()` dibuja `data/product.png` como un rectángulo plano,
  anclado por su arista inferior al mismo punto de apoyo que usaría el cubo.
  El canvas respeta la transparencia del PNG automáticamente (`drawImage` no
  requiere nada especial para eso).
- **Recorte del margen transparente**: al cargar, `computeAlphaBBox()`
  escanea el canal alpha completo del PNG (una sola vez) y calcula el
  bounding box de los píxeles no-transparentes (`ALPHA_BBOX_THRESHOLD`,
  umbral 8/255 para ignorar antialiasing residual). `productAspect` se
  calcula sobre ese recorte, no sobre el lienzo completo del archivo, y
  `drawProduct()` usa ese mismo rectángulo como *source* de `drawImage()` —
  así el contenido visible llena exactamente el tamaño derivado de
  profundidad, sin quedar más chico por el padding vacío alrededor del
  producto.
- No tiene caras que elegir — es plana, sin grosor real en el eje Z — pero
  igual se le muestra el mismo gizmo de ejes X/Y/Z (checkbox/tecla `A`),
  con la misma orientación según el punto de fuga que usa el cubo
  (`vpDirectionFor()`, extraído de `cubeVertices()` para que ambos modos
  compartan exactamente el mismo cálculo de dirección). El eje Z representa
  la profundidad que la imagen no tiene físicamente, solo como referencia de
  hacia dónde "miraría" si fuera un objeto 3D en ese punto.
- El hit-test de arrastre (`isNearProduct()`) usa el bounding box del
  rectángulo dibujado, análogo a `isNearCube()`.

## Pendiente / ideas descartadas por ahora

- Oclusión (que un objeto real más cercano tape parte del cubo): se probó una
  primera versión pixel a pixel y no convenció visualmente; queda fuera por
  ahora, se retomará más adelante.
- Sombra bajo el cubo: removida a pedido, se puede reintroducir si hace falta.
