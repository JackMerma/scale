# Demo: escala por profundidad (objeto sobre imagen real)

Prototipo para validar el concepto de colocar un objeto sobre una foto real,
cuyo tamaño se ajusta automáticamente según la profundidad estimada del punto
donde se coloca (más lejos = más chico, más cerca = más grande), usando un
mapa de profundidad ya generado por un modelo externo. El objeto puede ser un
cubo de referencia o una imagen de producto (PNG con fondo transparente) —
ambos comparten el mismo posicionamiento y escalado por profundidad, pero
**se orientan de forma distinta**: el cubo gira solo, automáticamente, según
el punto de fuga de la escena; la lámina de producto se orienta a mano con el
control de rotación 3D del panel derecho. Ver "Cubo" e "Imagen de producto"
más abajo.

## Cómo correrlo

Abrir `index.html` directamente en el navegador (no requiere build ni servidor).
Click sobre la foto para colocar el objeto, arrastrar para moverlo. El panel
izquierdo tiene los controles básicos; el derecho, la rotación 3D.

## Estructura

```
index.html   estructura de la página
style.css    estilos / diseño
script.js    toda la lógica (carga de assets, muestreo de profundidad, dibujo)
data/        assets de entrada (ver abajo)
```

## Layout

Tres columnas, ninguna se superpone al canvas de la foto:

- **Izquierda** (`#infoPanel`): HUD con las coordenadas/profundidad/tamaño/
  rotación actuales, y los controles básicos (modo cubo/producto, toggles de
  mapa de profundidad y punto de fuga, slider de escala).
- **Centro** (`#canvasCard`): la foto con el objeto colocado.
- **Derecha** (`#rotationCard`): el control de rotación 3D (ver más abajo).

(Antes el HUD y los controles iban superpuestos sobre la foto; se movieron
afuera para no tapar la imagen.)

## Datos de entrada

Generados por el modelo `chenxwh/depth-anything-v2` en Replicate:

- `data/background.jpg` — foto real (RGB), se muestra tal cual.
- `data/background/prediction-0.png` — mapa de profundidad en escala de grises,
  misma resolución que `background.jpg`. Convención: **brillo alto (255) = cerca,
  brillo bajo (0) = lejos**. Es el que se usa para calcular el tamaño del objeto.
  Va embebido en base64 dentro de `script.js` (`DEPTH_DATA_URI`) en vez de
  cargarse por ruta: es de los assets que se leen con `getImageData`, y bajo
  `file://` eso "tainta" el canvas si la imagen se cargó como recurso
  cross-origin/opaco. `background.jpg` y `prediction-1.png` no tienen ese
  problema porque solo se dibujan con `drawImage`, nunca se leen de vuelta,
  así que se mantienen como archivos externos normales.
- `data/background/prediction-1.png` — versión coloreada del mismo mapa,
  generada por el propio modelo; solo se usa para el toggle de visualización
  (no se usa para calcular nada).
- `data/product.png` — imagen de producto con fondo transparente, para el
  modo "imagen de producto". Igual que `prediction-0.png`, va embebida en
  base64 dentro de `script.js` (`PRODUCT_DATA_URI`) porque también se le lee
  `getImageData` (para recortar el margen transparente, ver
  `computeAlphaBBox`).

Se descartó una corrida anterior con otro modelo que entregaba profundidad
métrica en un JSON (float32 + sky_mask), porque este modelo da mejor resultado
visual y, al coincidir en resolución exacta con la imagen real, no requiere
reescalar/transformar coordenadas.

## Cómo funciona el mapeo profundidad → tamaño

1. Al hacer click/arrastrar, se toma el punto `(x, y)` como el punto de apoyo
   del objeto en el suelo de la escena (crece hacia arriba desde ahí, no se
   centra en el punto).
2. Se promedia un área circular de `SAMPLE_RADIUS` px alrededor de ese punto en
   el mapa de profundidad (para evitar ruido de un solo píxel).
3. El valor promedio (0–255) se mapea linealmente a un tamaño entre
   `MIN_SIZE` y `MAX_SIZE` (constantes al inicio de `script.js`).
4. Si el punto cae fuera de los límites de la imagen, el evento se ignora.

El slider "escala" (panel izquierdo) aplica un multiplicador adicional
(`cubeScale`, 0.3x–3x) sobre ese tamaño — no lo reemplaza. `cube.size` sigue
siendo el tamaño base derivado de la profundidad.

## Cubo — orientación automática según el punto de fuga

El cubo del canvas principal **no** usa el control de rotación manual: gira
solo, según su posición respecto al punto de fuga de la escena (perspectiva
de 1 punto), igual que la técnica de los ilustradores. Al arrastrarlo, solo
cambian posición, tamaño (por profundidad) y esa orientación automática —
nunca una rotación manual.

- **Estimación del punto de fuga**: `estimateVanishingPoint()` calcula el
  centroide ponderado del percentil más oscuro/lejano de píxeles del mapa de
  profundidad (`VP_DARK_PERCENTILE`). Checkbox/tecla `V` muestra un círculo
  arrastrable en ese punto (+ línea punteada hacia el cubo) para corregirlo a
  mano cuando no cae donde debería.
- **Orientación**: `vpDirectionFor()` calcula la dirección 2D real (no solo
  horizontal) desde el cubo hacia el punto de fuga; `cubeVertices()` usa esa
  dirección como desplazamiento uniforme (`CUBE_SKEW_MAG_X/Y`) de la cara
  trasera, y `drawCube()` elige, por el signo de cada componente, cuál de las
  dos caras de cada par opuesto es la visible (arriba/abajo, izquierda/
  derecha) — la otra queda oculta detrás de la cara frontal. Es una
  aproximación de perspectiva de 1 punto (un único punto de fuga global), no
  una reconstrucción de cámara real.
- Sus 3 caras visibles comparten color con su opuesta:
  arriba/abajo → verde (Y), izquierda/derecha → rojo (X), frente/atrás →
  azul (Z).

## Imagen de producto — rotación 3D manual

Radio "cubo" / "imagen de producto" en el panel izquierdo cambia qué se
dibuja sobre el punto colocado. El punto en sí (`cube` — se reutiliza el
mismo objeto de estado para ambos modos) no cambia: mismo punto de apoyo,
mismo tamaño derivado de profundidad, mismo `cubeScale`. Lo que cambia por
completo es cómo se orienta: la lámina de producto **no sigue el punto de
fuga** — se rota a mano con el panel derecho.

Panel derecho ("rotación del producto"): un mini-canvas con un cubo en
wireframe + ejes X(rojo)/Y(verde)/Z(azul), tres sliders (uno por eje,
-180°..180°) y un botón de reset. Todo controla el mismo estado global
`rotX, rotY, rotZ` (radianes), que se aplica **únicamente** a la lámina de
producto (`drawProduct()`) — el cubo del mini-canvas es solo la interfaz de
control, sin relación con el "cubo" que se coloca sobre la foto.

- **Interacción**: arrastrar sobre el mini-canvas orbita la vista (horizontal
  → `rotY`, vertical → `rotX`), igual que orbitar la cámara en un viewport
  3D — la interacción "como en AutoCAD" que se pidió. Los tres sliders dan
  control preciso por eje, incluyendo `rotZ` (giro sobre el propio plano, que
  el arrastre no cubre). Arrastre y sliders están sincronizados en ambas
  direcciones (`setRotation()` es el único punto de entrada que actualiza
  todo).
- **Matemática**: `rotateVec3(v, rx, ry, rz)` aplica una rotación 3D real
  (Rz·Ry·Rx) a un vector. La usan por igual `drawProduct()` (rota las 4
  esquinas de la lámina) y `renderRotationGizmo()` (rota el cubo/ejes del
  mini-canvas) — ambos pasan por la misma función, así que se mueven
  exactamente igual.
- El eje X quedó con el signo invertido a propósito respecto a una rotación
  matemática estándar (ver comentario en `rotateVec3`): al probar el control,
  arrastrar/subir hacia arriba giraba la lámina para el lado contrario al
  esperado, así que se corrigió ahí en un solo lugar.
- **Proyección ortográfica, sin WebGL**: `drawProduct()` descarta la
  coordenada Z al pasar a pantalla (`toScreen()`). Una proyección ortográfica
  de un rectángulo rotado siempre da un **paralelogramo** en 2D (nunca un
  trapecio, porque preserva paralelismo) — y eso es exactamente lo que una
  transformación afín de canvas (`ctx.setTransform(a,b,c,d,e,f)`) puede
  mapear de forma exacta a partir del rectángulo fuente. Por eso no hace
  falta deformar la imagen píxel a píxel ni un motor 3D.
- **Reverso de la lámina**: como el PNG no tiene una textura trasera real, si
  la normal rotada de la lámina queda mirando "hacia adentro" de la pantalla
  (se está viendo el reverso), se dibuja con `globalAlpha` reducido en vez de
  mostrar el frente como si nada — una pista visual mínima de que se está del
  otro lado.
- **Recorte del margen transparente**: al cargar, `computeAlphaBBox()`
  escanea el canal alpha completo del PNG (una sola vez) y calcula el
  bounding box de los píxeles no-transparentes (`ALPHA_BBOX_THRESHOLD`,
  umbral 8/255 para ignorar antialiasing residual). `productAspect` se
  calcula sobre ese recorte, no sobre el lienzo completo del archivo, y
  `drawProduct()` usa ese mismo rectángulo como *source* de `drawImage()` —
  así el contenido visible llena exactamente el tamaño derivado de
  profundidad, sin quedar más chico por el padding vacío alrededor del
  producto.
- El hit-test de arrastre (`isNearProduct()`) usa el bounding box axis-aligned
  del rectángulo sin rotar — no sigue el paralelogramo rotado, es una
  aproximación suficiente para un prototipo.

Los dos sistemas de orientación (punto de fuga para el cubo, rotación libre
para la lámina) son intencionalmente independientes y no se mezclan.

## Pendiente / ideas descartadas por ahora

- Oclusión (que un objeto real más cercano tape parte del objeto colocado):
  se probó una primera versión pixel a pixel y no convenció visualmente;
  queda fuera por ahora, se retomará más adelante.
- Sombra bajo el objeto: removida a pedido, se puede reintroducir si hace falta.
- Ejes/flechas sobre el objeto en el canvas principal: se probaron y se
  quitaron a pedido; el gizmo de ejes ahora vive solo en el mini-canvas de
  rotación (panel derecho).
