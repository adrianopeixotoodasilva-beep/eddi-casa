/**
 * EDDI Casa — Servidor Node.js com SQLite
 * Compativel com Windows, Mac e Linux
 * Banco de dados: eddi_casa.db (SQLite via Python bridge)
 * Porta: 3000
 */

const http            = require('http');
const fs              = require('fs');
const path            = require('path');
const url             = require('url');
const { spawnSync, execSync } = require('child_process');

const PORT   = process.env.PORT || 3000;
const BRIDGE = path.join(__dirname, 'db_bridge.py');
const PUBLIC = path.join(__dirname, 'public');

// ── Detecta o Python disponivel no sistema ────────────────────────────────
function detectPython() {
  const candidates = ['python', 'python3', 'py'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000 });
      if (r.status === 0) {
        const version = (r.stdout || r.stderr || '').trim();
        console.log(`  Python encontrado: ${cmd} (${version})`);
        return cmd;
      }
    } catch (_) {}
  }
  return null;
}

const PYTHON = detectPython();

if (!PYTHON) {
  console.error('\n  ERRO: Python nao encontrado no sistema.');
  console.error('  Instale em: https://www.python.org/downloads/');
  console.error('  IMPORTANTE: marque "Add Python to PATH" durante a instalacao.\n');
  process.exit(1);
}

// ── DB helper — chama db_bridge.py via stdin/stdout ───────────────────────
function db(action, params = {}) {
  const input  = JSON.stringify({ action, params });
  const result = spawnSync(PYTHON, [BRIDGE], {
    input,
    encoding: 'utf8',
    timeout: 10000,
    cwd: __dirname,
  });

  if (result.error) {
    throw new Error(`Erro ao chamar Python: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Erro no bridge Python:\n${result.stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (e) {
    throw new Error(`Resposta invalida do bridge: ${result.stdout}`);
  }

  if (!parsed.ok) throw new Error(parsed.error || 'Erro no banco de dados');
  return parsed.data;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonRes(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('JSON invalido no corpo da requisicao')); }
    });
    req.on('error', reject);
  });
}

function serveHTML(res, filePath) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Arquivo nao encontrado: ' + filePath);
  }
}

// ── Roteador principal ────────────────────────────────────────────────────
async function router(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/$/, '') || '/';
  const method   = req.method.toUpperCase();

  // Preflight CORS
  if (method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    return res.end();
  }

  // ── Interface web
  if (method === 'GET' && pathname === '/') {
    return serveHTML(res, path.join(PUBLIC, 'index.html'));
  }

  // ── Estatísticas do dia
  if (pathname === '/api/stats' && method === 'GET') {
    return jsonRes(res, 200, db('stats'));
  }

  // ── Listar / buscar produtos
  if (pathname === '/api/produtos' && method === 'GET') {
    return jsonRes(res, 200, db('produtos_list', {
      q:         parsed.query.q         || '',
      categoria: parsed.query.categoria || '',
    }));
  }

  // ── Registrar entrada de produto
  if (pathname === '/api/produtos' && method === 'POST') {
    const body = await readBody(req);
    const { codigo, descricao, quantidade, localizacao, categoria } = body;
    if (!codigo || !descricao || quantidade === undefined)
      return jsonRes(res, 400, { erro: 'Campos obrigatorios: codigo, descricao, quantidade' });
    return jsonRes(res, 201, db('produto_entrada', { codigo, descricao, quantidade, localizacao, categoria }));
  }

  // ── Atualizar produto
  const mPut = pathname.match(/^\/api\/produtos\/(\d+)$/);
  if (mPut && method === 'PUT') {
    const body = await readBody(req);
    return jsonRes(res, 200, db('produto_update', { id: Number(mPut[1]), ...body }));
  }

  // ── Deletar produto
  const mDel = pathname.match(/^\/api\/produtos\/(\d+)$/);
  if (mDel && method === 'DELETE') {
    return jsonRes(res, 200, db('produto_delete', { id: Number(mDel[1]) }));
  }

  // ── Listar romaneios
  if (pathname === '/api/romaneios' && method === 'GET') {
    return jsonRes(res, 200, db('romaneios_list'));
  }

  // ── Emitir romaneio
  if (pathname === '/api/romaneios' && method === 'POST') {
    const body = await readBody(req);
    const { pedido, destinatario, data_envio, itens } = body;
    if (!pedido || !destinatario || !itens?.length)
      return jsonRes(res, 400, { erro: 'Campos obrigatorios: pedido, destinatario, itens[]' });
    return jsonRes(res, 201, db('romaneio_create', { pedido, destinatario, data_envio, itens }));
  }

  // ── Carregar configuracoes
  if (pathname === '/api/config' && method === 'GET') {
    return jsonRes(res, 200, db('config_get'));
  }

  // ── Salvar configuracoes
  if (pathname === '/api/config' && method === 'PUT') {
    const body = await readBody(req);
    return jsonRes(res, 200, db('config_save', body));
  }

  // ── Importar planilha CSV
  if (pathname === '/api/importar' && method === 'POST') {
    const body = await readBody(req);
    return jsonRes(res, 200, db('importar', { rows: body.rows || [] }));
  }

  // ── Historico de movimentacoes
  if (pathname === '/api/movimentacoes' && method === 'GET') {
    return jsonRes(res, 200, db('movimentacoes_list', { limit: parsed.query.limit || 50 }));
  }

  return jsonRes(res, 404, { erro: `Rota nao encontrada: ${method} ${pathname}` });
}

// ── Inicializar banco e subir servidor ────────────────────────────────────
console.log('\n  Inicializando banco de dados SQLite...');
try {
  db('stats');
} catch (e) {
  console.error('\n  ERRO ao conectar com o banco de dados:');
  console.error(' ', e.message);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    console.error('[ERRO]', err.message);
    jsonRes(res, 500, { erro: err.message });
  }
});

server.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   EDDI Casa — Servidor + SQLite          ║');
  console.log('  ║   http://localhost:' + PORT + '                 ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('\n  Banco:  ' + path.join(__dirname, 'eddi_casa.db'));
  console.log('  Bridge: ' + BRIDGE);
  console.log('\n  Pressione Ctrl+C para encerrar.\n');
});
