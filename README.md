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

Para todo excepto "generar esta perspectiva (IA)": abrir `index.html`
directamente en el navegador, no requiere build ni servidor. Click sobre la
foto para colocar el objeto, arrastrar para moverlo. El panel izquierdo tiene
los controles básicos; el derecho, la rotación 3D.

Para "generar esta perspectiva (IA)" hace falta el servidor local (ver
"Generar ángulos con IA" más abajo):

```
1. Poner el token de Replicate en .env (REPLICATE_API_TOKEN=...)
2. node server.js
3. Abrir http://localhost:8787
```

## Estructura

```
index.html   estructura de la página
style.css    estilos / diseño
script.js    toda la lógica del frontend (carga de assets, muestreo de profundidad, dibujo)
server.js    servidor local: sirve los archivos estaticos + POST /api/generate-angle
.env         REPLICATE_API_TOKEN (no se commitea, ver .gitignore)
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

## Generar ángulos con IA (qwen/qwen-edit-multiangle)

Botón "generar esta perspectiva (IA)" en el panel derecho (solo activo en
modo "imagen de producto"): en vez de rotar la foto original con la
transformación afín de `drawProduct()`, le pide a
[`qwen/qwen-edit-multiangle`](https://replicate.com/qwen/qwen-edit-multiangle)
en Replicate que **genere una foto nueva** del producto real desde ese
ángulo. Es un experimento — la primera prueba de esto, sin validar aún contra
la API real (hace falta un `REPLICATE_API_TOKEN` para eso).

### Por qué hace falta un servidor

El token de Replicate no puede vivir en `script.js`: cualquiera que abra el
código fuente de la página lo vería. `server.js` es un servidor Node mínimo
(sin dependencias — usa `fetch`/`FormData`/`Blob` nativos de Node 18+) con
dos trabajos: servir los archivos estáticos del proyecto, y exponer
`POST /api/generate-angle`, el único lugar donde se usa el token.

- Poner el token en `.env` (`REPLICATE_API_TOKEN=...`, ver el archivo — está
  en `.gitignore`, nunca se commitea).
- Correr `node server.js` (puerto `8787` por defecto, `PORT` para cambiarlo)
  y abrir `http://localhost:8787`.
- El resto de la app sigue funcionando igual si en cambio abrís `index.html`
  directo (doble click) — **excepto este botón**, que en ese caso asume que
  el servidor corre en `http://localhost:8787` (`API_BASE` en `script.js`) y
  le pega ahí por `fetch` (con CORS habilitado en el servidor para que
  funcione incluso desde una página `file://`).

### Qué hace `POST /api/generate-angle`

Recibe `{ sourceImage, rotateDegrees }` (`sourceImage` es una ruta relativa a
`data/`, `rotateDegrees` un entero) y hace una cadena de **dos** modelos:

1. **Sube la imagen** a Replicate (`POST /v1/files`, multipart) para
   obtener una URL pública — los inputs de archivo del modelo aceptan URL o
   data URL, pero data URL está limitado a 256kb, así que subir el archivo es
   lo robusto para cualquier tamaño (`uploadToReplicate()`).
2. **`qwen/qwen-edit-multiangle`**: genera la foto rotada, con
   `{ image: <url subida>, go_fast: false, rotate_degrees: rotateDegrees }`.
   Devuelve buena calidad de rotación, pero **no preserva el fondo
   transparente** — pone su propio fondo de estudio. Confirmado probándolo
   contra la API real.
3. **`851-labs/background-remover`**: le pasa la salida del paso anterior
   como `{ image: <url del paso 2>, background_type: "rgba", format: "png" }`
   para recuperar la transparencia. Deja un canal alpha real, aunque puede
   quedar algún resto tenue de sombra/reflejo del fondo original (limitación
   del modelo de segmentación, aceptable para este prototipo).
4. **Descarga la imagen final** y la guarda en `data/generations/`
   (`gen-<timestamp>-<random>.<ext>`) — el punto de partida para la próxima
   generación, para poder encadenar ángulos.
5. Devuelve `{ ok: true, path, dataUri }`: `path` (relativo a `data/`) es lo
   que el frontend manda como `sourceImage` la próxima vez; `dataUri` es la
   imagen ya en base64 (con el content-type real detectado de la respuesta
   de Replicate — ver nota abajo), para que `script.js` la muestre al toque
   sin depender de si la página se abrió por `file://` o por el servidor.

Ambas llamadas usan `runPrediction(model, input)`, que primero resuelve el id
de la última versión del modelo (`GET /v1/models/{owner}/{name}`) y siempre
pega contra el endpoint genérico `POST /v1/predictions` con `{ version,
input }` — el endpoint "atajo" `POST /v1/models/{owner}/{name}/predictions`
del curl de ejemplo (que sí funciona para `qwen-edit-multiangle`) le devolvió
404 a `851-labs/background-remover`; no todos los modelos lo soportan, así
que se resuelve la versión siempre por las dudas.

**Nota sobre el formato**: `qwen-edit-multiangle` devolvió **WEBP**, no PNG,
en la prueba real — el servidor detecta el `content-type` real de la
descarga (`EXT_BY_CONTENT_TYPE`) en vez de asumir PNG a ciegas; guardar/
declarar un archivo con el MIME equivocado hace que el `<img>`/data URI no
cargue en el navegador. Como `background-remover` siempre devuelve el
`format` pedido (`png`), la imagen *final* que ve el frontend termina siendo
PNG de todos modos.

### Qué hace el frontend (`generateAngle()` en `script.js`)

- Manda `rotateDegrees` (desde `rotY`, clampeado a **-90..90** — no -180..180
  como el slider) y `verticalTilt` (desde `rotX`, ver abajo). `rotZ` no tiene
  equivalente en este modelo y no se envía; sigue aplicando solo a la vista
  previa 3D local (`drawProduct()`).
- **Bug encontrado y corregido**: al principio solo se mandaba
  `rotate_degrees` — rotar en X ("acostar" el producto) no cambiaba nada en
  la imagen generada porque `rotX` nunca llegaba a la API, solo afectaba la
  vista previa local. Consultando el schema real del modelo
  (`GET /v1/models/qwen/qwen-edit-multiangle` con el token) apareció
  `vertical_tilt`: entero, **-1 = vista de pájaro, 0 = nivel, 1 = vista de
  gusano** (no un ángulo continuo). `verticalTiltFromRotX()` en `script.js`
  lo deriva del signo de `rotX` con un umbral de 20° (`VERTICAL_TILT_THRESHOLD_DEG`)
  para no disparar tilt con inclinaciones mínimas. Se probó contra la API
  real con `-1` y `1` por separado y ambos cambian la perspectiva
  visiblemente en la dirección esperada (`-1` muestra mucho más el interior/
  tapa desde arriba; `1` la achata, más a la altura del ojo desde abajo).
  También se confirmó que `rotate_degrees` fuera de -90..90 no está permitido
  por el modelo — el servidor lo clampea de nuevo por las dudas
  (`handleGenerateAngle` en `server.js`).
- Al recibir la respuesta: reemplaza `productImg.src` por el `dataUri`
  (dispara de nuevo `computeAlphaBBox()` para recortar el margen
  transparente de la imagen nueva), actualiza `productSourcePath` al `path`
  devuelto (para encadenar), y **resetea la rotación manual a 0** — la
  imagen nueva ya *es* esa perspectiva; seguir aplicando el giro manual
  encima la duplicaría.
- "usar imagen original" (`resetProductSource()`) vuelve a `data/product.png`
  y limpia el estado, para poder repetir pruebas sin reiniciar el servidor.

### Probado extremo a extremo

A diferencia de una primera versión de esto (documentada solo en teoría),
**se probó contra la API real** con un token válido: subida de archivo,
generación del ángulo, remoción de fondo, descarga y guardado en
`data/generations/` — las 4 pruebas manuales encontraron y corrigieron 2
bugs reales (formato WEBP mal declarado como PNG, y el 404 del endpoint
atajo para `background-remover`), documentados arriba.

### Limitaciones conocidas

- Se usan 2 de los 3 ejes (`rotY` → `rotate_degrees`, `rotX` → `vertical_tilt`);
  `rotZ` no tiene equivalente en este modelo, no se envía.
- `vertical_tilt` es discreto (-1/0/1, no un ángulo continuo) — inclinaciones
  chicas en X (por debajo de `VERTICAL_TILT_THRESHOLD_DEG`, 20°) se mandan
  como "nivel" (0), así que rotX no se refleja de forma gradual como en la
  vista previa local, solo en 3 escalones.
- El signo exacto de `verticalTiltFromRotX()` (qué lado de rotX es "vista de
  pájaro" vs "de gusano") se fijó mirando el resultado real de la API una
  vez, no se hizo un barrido exhaustivo — si en algún ángulo se siente al
  revés, invertir el signo ahí es el único lugar que hace falta tocar.
- La remoción de fondo puede dejar restos tenues de sombra/reflejo del fondo
  de estudio original (visible en la prueba real) — no es un recorte perfecto.
- Cada generación son 2 llamadas reales a Replicate en cadena (~25-45s,
  tienen costo) — no hay caché ni debounce todavía.
- Si `background-remover` fallara en dejar transparencia real,
  `computeAlphaBBox()` cae en su fallback (usa el lienzo entero) en vez de
  romper.

## Pendiente / ideas descartadas por ahora

- Oclusión (que un objeto real más cercano tape parte del objeto colocado):
  se probó una primera versión pixel a pixel y no convenció visualmente;
  queda fuera por ahora, se retomará más adelante.
- Sombra bajo el objeto: removida a pedido, se puede reintroducir si hace falta.
- Ejes/flechas sobre el objeto en el canvas principal: se probaron y se
  quitaron a pedido; el gizmo de ejes ahora vive solo en el mini-canvas de
  rotación (panel derecho).
