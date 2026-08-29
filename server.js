/**
 * Servidor local minimo (sin dependencias externas, usa fetch/FormData nativos de Node 18+)
 * con dos trabajos:
 *   1. Servir los archivos estaticos del proyecto (igual que abrir index.html directo).
 *   2. Exponer POST /api/generate-angle, que llama a qwen/qwen-edit-multiangle en Replicate
 *      para generar una nueva foto del producto en un angulo distinto.
 *
 * Existe como servidor -- y no como fetch directo desde el navegador -- porque el
 * REPLICATE_API_TOKEN tiene que quedarse en el backend; exponerlo en script.js lo filtraria
 * a cualquiera que abra el codigo fuente de la pagina.
 *
 * Uso: node server.js   (lee REPLICATE_API_TOKEN de .env, ver README)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 8787;

// ---------- Carga manual de .env (sin dependencias externas) ----------
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const MODEL_ROTATE = 'qwen/qwen-edit-multiangle';
// qwen-edit-multiangle no preserva el fondo transparente del PNG original (genera su propio
// fondo de estudio) -- se lo recorta en un segundo paso con este modelo de segmentacion.
const MODEL_BG_REMOVE = '851-labs/background-remover';
const GENERATIONS_DIR = path.join(ROOT, 'data', 'generations');
const DATA_DIR = path.join(ROOT, 'data');

// El modelo puede devolver distintos formatos (en la practica devolvio WEBP). Se usa para
// elegir la extension con la que se guarda el archivo generado.
const EXT_BY_CONTENT_TYPE = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Sube un archivo local al Files API de Replicate y devuelve la URL publica que se le puede
// pasar como input "image" a un modelo (los inputs de tipo archivo aceptan URL o data URL,
// pero data URL esta limitado a 256kb -- subir el archivo es lo robusto para cualquier tamaño).
async function uploadToReplicate(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('content', new Blob([buf], { type: 'image/png' }), path.basename(filePath));

  const resp = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    body: form,
  });
  if (!resp.ok) {
    throw new Error(`Replicate (subida de archivo) respondio ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.urls.get;
}

// Resuelve el id de la ultima version de un modelo "owner/name". El endpoint "shortcut"
// POST /v1/models/{owner}/{name}/predictions (el del curl de ejemplo de qwen-edit-multiangle)
// no lo soportan todos los modelos -- 851-labs/background-remover, por ejemplo, devuelve 404
// ahi. Resolver la version y pegarle siempre al endpoint generico funciona para cualquiera.
async function resolveLatestVersion(model) {
  const resp = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
  });
  if (!resp.ok) {
    throw new Error(`Replicate (info de modelo ${model}) respondio ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  const versionId = json.latest_version && json.latest_version.id;
  if (!versionId) throw new Error(`No se pudo resolver la ultima version de ${model}.`);
  return versionId;
}

// Crea una prediccion para "model" (owner/name) con "Prefer: wait" (espera hasta 60s en la
// misma conexion); si para entonces no termino, hace polling a prediction.urls.get hasta que
// resuelva. Generica: la usan tanto qwen-edit-multiangle como background-remover (ver abajo).
async function runPrediction(model, input) {
  const version = await resolveLatestVersion(model);
  const createResp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ version, input }),
  });
  if (!createResp.ok) {
    throw new Error(`Replicate (crear prediccion de ${model}) respondio ${createResp.status}: ${await createResp.text()}`);
  }
  let prediction = await createResp.json();

  const deadline = Date.now() + 120000; // margen total de polling, por si "wait" no alcanzo
  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() > deadline) throw new Error(`Timeout esperando la prediccion de ${model}.`);
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    });
    prediction = await pollResp.json();
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`La prediccion de ${model} terminó en estado "${prediction.status}"${prediction.error ? `: ${prediction.error}` : ''}.`);
  }

  const output = prediction.output;
  const outputUrl = Array.isArray(output) ? output[0] : output;
  if (!outputUrl) throw new Error(`La prediccion de ${model} no devolvio ninguna imagen de salida.`);
  return outputUrl;
}

// POST /api/generate-angle  { sourceImage: "product.png" | "generations/xxx.png", rotateDegrees: number }
// Genera una nueva foto del producto rotada, la guarda en data/generations/ y devuelve tanto
// la ruta (para poder re-usarla como sourceImage de la proxima generacion, encadenando
// angulos) como un data URI (para que el frontend la muestre sin problemas de CORS/file://).
async function handleGenerateAngle(req, res) {
  try {
    if (!REPLICATE_TOKEN) {
      sendJson(res, 500, { ok: false, error: 'Falta REPLICATE_API_TOKEN en .env (ver README).' });
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8'));
    } catch {
      sendJson(res, 400, { ok: false, error: 'JSON invalido en el body.' });
      return;
    }

    const { sourceImage, rotateDegrees } = payload || {};
    if (typeof sourceImage !== 'string' || !Number.isFinite(rotateDegrees)) {
      sendJson(res, 400, { ok: false, error: 'sourceImage (string) y rotateDegrees (number) son requeridos.' });
      return;
    }

    const sourcePath = path.normalize(path.join(DATA_DIR, sourceImage));
    if (!sourcePath.startsWith(DATA_DIR + path.sep) || !fs.existsSync(sourcePath)) {
      sendJson(res, 404, { ok: false, error: `No se encontro data/${sourceImage}.` });
      return;
    }

    const uploadedUrl = await uploadToReplicate(sourcePath);
    const rotatedUrl = await runPrediction(MODEL_ROTATE, {
      image: uploadedUrl,
      go_fast: false,
      rotate_degrees: Math.round(rotateDegrees),
    });
    // Segundo paso: la salida de qwen-edit-multiangle trae fondo de estudio propio, no
    // transparencia -- background-remover la reemplaza por un canal alpha real (rgba).
    const transparentUrl = await runPrediction(MODEL_BG_REMOVE, {
      image: rotatedUrl,
      background_type: 'rgba',
      format: 'png',
    });

    const imgResp = await fetch(transparentUrl, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } });
    if (!imgResp.ok) throw new Error(`No se pudo descargar la imagen generada (${imgResp.status}).`);
    const imgBuf = Buffer.from(await imgResp.arrayBuffer());

    // El modelo no siempre devuelve PNG (en la practica devolvio WEBP) -- se detecta el
    // content-type real de la descarga para no etiquetar/guardar el archivo con una
    // extension/MIME equivocada (un data URI con el tipo mal declarado no carga en el navegador).
    const contentType = (imgResp.headers.get('content-type') || 'image/png').split(';')[0].trim();
    const ext = EXT_BY_CONTENT_TYPE[contentType] || 'png';

    fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
    const fileName = `gen-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(GENERATIONS_DIR, fileName), imgBuf);

    sendJson(res, 200, {
      ok: true,
      path: `generations/${fileName}`,
      dataUri: `data:${contentType};base64,${imgBuf.toString('base64')}`,
    });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, '', {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/generate-angle') {
    handleGenerateAngle(req, res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }
  send(res, 405, 'Method not allowed');
});

server.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  if (!REPLICATE_TOKEN) {
    console.warn('Aviso: REPLICATE_API_TOKEN no esta definido en .env -- /api/generate-angle fallara hasta que lo definas.');
  }
});
