/**
 * EDDI Casa — Servidor com PostgreSQL
 * Banco de dados: PostgreSQL (Railway)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const { Pool } = require('pg');

const PORT   = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        codigo TEXT NOT NULL UNIQUE,
        descricao TEXT NOT NULL,
        localizacao TEXT DEFAULT '-',
        quantidade INTEGER DEFAULT 0,
        categoria TEXT DEFAULT 'Geral',
        ultima_mov DATE DEFAULT CURRENT_DATE
      );
      CREATE TABLE IF NOT EXISTS movimentacoes (
        id SERIAL PRIMARY KEY,
        tipo TEXT NOT NULL,
        codigo TEXT NOT NULL,
        quantidade INTEGER NOT NULL,
        data DATE DEFAULT CURRENT_DATE,
        obs TEXT
      );
      CREATE TABLE IF NOT EXISTS romaneios (
        id SERIAL PRIMARY KEY,
        pedido TEXT NOT NULL,
        destinatario TEXT NOT NULL,
        data_envio DATE,
        criado_em DATE DEFAULT CURRENT_DATE
      );
      CREATE TABLE IF NOT EXISTS romaneio_itens (
        id SERIAL PRIMARY KEY,
        romaneio_id INTEGER NOT NULL REFERENCES romaneios(id),
        codigo TEXT NOT NULL,
        quantidade INTEGER NOT NULL,
        unidade TEXT DEFAULT 'UN'
      );
      CREATE TABLE IF NOT EXISTS config (
        chave TEXT PRIMARY KEY,
        valor TEXT
      );
    `);
    const defaults = [
      ['empresa','EDDI Casa'],['cnpj',''],['responsavel',''],
      ['email',''],['telefone',''],['alerta_minimo','true'],
      ['qtd_minima','5'],['idioma','Portugues (BR)']
    ];
    for (const [k,v] of defaults) {
      await client.query(
        'INSERT INTO config(chave,valor) VALUES($1,$2) ON CONFLICT(chave) DO NOTHING',
        [k,v]
      );
    }
    const demo = [
      ['PROD-001','Cadeira escritorio','A-02-B',12,'Moveis'],
      ['PROD-007','Mesa escrivaninha', 'B-05-A', 5,'Moveis'],
      ['PROD-022','Armario 2 portas',  'C-01-C', 8,'Moveis'],
      ['PROD-034','Sofa 3 lugares',    'D-03-A', 0,'Moveis'],
      ['PROD-041','Luminaria de mesa', 'A-08-B',21,'Decoracao'],
      ['PROD-055','Monitor 27 pol',    'E-01-A', 6,'Eletronicos'],
      ['PROD-060','Teclado mecanico',  'E-02-A',14,'Eletronicos'],
    ];
    for (const [co,de,lo,qt,ca] of demo) {
      await client.query(
        'INSERT INTO produtos(codigo,descricao,localizacao,quantidade,categoria) VALUES($1,$2,$3,$4,$5) ON CONFLICT(codigo) DO NOTHING',
        [co,de,lo,qt,ca]
      );
    }
    console.log('Banco PostgreSQL pronto!');
  } finally { client.release(); }
}

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
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}
function today() { return new Date().toISOString().split('T')[0]; }

async function router(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/$/, '') || '/';
  const method   = req.method.toUpperCase();

  if (method === 'OPTIONS') { setCors(res); res.writeHead(204); return res.end(); }

  if (method === 'GET' && pathname === '/') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
    } catch { return jsonRes(res, 404, { erro: 'index.html nao encontrado' }); }
  }

  if (pathname === '/api/stats' && method === 'GET') {
    const t = today();
    const [tot,ent,sai,cfg] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(quantidade),0) AS v FROM produtos'),
      pool.query("SELECT COALESCE(SUM(quantidade),0) AS v FROM movimentacoes WHERE tipo='entrada' AND data=$1",[t]),
      pool.query("SELECT COALESCE(SUM(quantidade),0) AS v FROM movimentacoes WHERE tipo='saida' AND data=$1",[t]),
      pool.query("SELECT valor FROM config WHERE chave='qtd_minima'"),
    ]);
    const min = Number(cfg.rows[0]?.valor || 5);
    const al  = await pool.query('SELECT COUNT(*) AS v FROM produtos WHERE quantidade <= $1',[min]);
    return jsonRes(res, 200, {
      total_itens:   Number(tot.rows[0].v),
      entradas_hoje: Number(ent.rows[0].v),
      saidas_hoje:   Number(sai.rows[0].v),
      alertas:       Number(al.rows[0].v)
    });
  }

  if (pathname === '/api/produtos' && method === 'GET') {
    const q = parsed.query.q||'', cat = parsed.query.categoria||'';
    let sql = 'SELECT * FROM produtos WHERE 1=1', params = [];
    if (q) { params.push(`%${q}%`); sql += ` AND (codigo ILIKE $${params.length} OR descricao ILIKE $${params.length} OR localizacao ILIKE $${params.length})`; }
    if (cat && cat !== 'Todas') { params.push(cat); sql += ` AND categoria=$${params.length}`; }
    sql += ' ORDER BY codigo';
    return jsonRes(res, 200, (await pool.query(sql, params)).rows);
  }

  if (pathname === '/api/produtos' && method === 'POST') {
    const {codigo,descricao,quantidade,localizacao,categoria} = await readBody(req);
    if (!codigo||!descricao||quantidade===undefined) return jsonRes(res,400,{erro:'Campos obrigatorios: codigo, descricao, quantidade'});
    const ex = await pool.query('SELECT id FROM produtos WHERE codigo=$1',[codigo]);
    if (ex.rows.length) {
      await pool.query('UPDATE produtos SET quantidade=quantidade+$1,ultima_mov=$2 WHERE codigo=$3',[Number(quantidade),today(),codigo]);
    } else {
      await pool.query('INSERT INTO produtos(codigo,descricao,localizacao,quantidade,categoria,ultima_mov) VALUES($1,$2,$3,$4,$5,$6)',[codigo,descricao,localizacao||'-',Number(quantidade),categoria||'Geral',today()]);
    }
    await pool.query('INSERT INTO movimentacoes(tipo,codigo,quantidade,data) VALUES($1,$2,$3,$4)',['entrada',codigo,Number(quantidade),today()]);
    return jsonRes(res, 201, (await pool.query('SELECT * FROM produtos WHERE codigo=$1',[codigo])).rows[0]);
  }

  const mPut = pathname.match(/^\/api\/produtos\/(\d+)$/);
  if (mPut && method === 'PUT') {
    const body = await readBody(req), id = Number(mPut[1]);
    const fields = ['codigo','descricao','localizacao','quantidade','categoria'].filter(k=>body[k]!==undefined);
    if (!fields.length) return jsonRes(res,400,{erro:'Nenhum campo'});
    const sets = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
    const vals = [...fields.map(f=>body[f]),today(),id];
    await pool.query(`UPDATE produtos SET ${sets},ultima_mov=$${fields.length+1} WHERE id=$${fields.length+2}`,vals);
    return jsonRes(res, 200, (await pool.query('SELECT * FROM produtos WHERE id=$1',[id])).rows[0]);
  }

  const mDel = pathname.match(/^\/api\/produtos\/(\d+)$/);
  if (mDel && method === 'DELETE') {
    await pool.query('DELETE FROM produtos WHERE id=$1',[Number(mDel[1])]);
    return jsonRes(res, 200, { ok: true });
  }

  if (pathname === '/api/romaneios' && method === 'GET') {
    const roms = (await pool.query('SELECT * FROM romaneios ORDER BY id DESC')).rows;
    for (const r of roms) r.itens = (await pool.query('SELECT * FROM romaneio_itens WHERE romaneio_id=$1',[r.id])).rows;
    return jsonRes(res, 200, roms);
  }

  if (pathname === '/api/romaneios' && method === 'POST') {
    const {pedido,destinatario,data_envio,itens} = await readBody(req);
    if (!pedido||!destinatario||!itens?.length) return jsonRes(res,400,{erro:'Campos obrigatorios'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rom = await client.query('INSERT INTO romaneios(pedido,destinatario,data_envio,criado_em) VALUES($1,$2,$3,$4) RETURNING *',[pedido,destinatario,data_envio||today(),today()]);
      const romId = rom.rows[0].id, romItens = [];
      for (const item of itens) {
        const qtd = Number(item.quantidade);
        await client.query('INSERT INTO romaneio_itens(romaneio_id,codigo,quantidade,unidade) VALUES($1,$2,$3,$4)',[romId,item.codigo,qtd,item.unidade||'UN']);
        await client.query('UPDATE produtos SET quantidade=GREATEST(0,quantidade-$1),ultima_mov=$2 WHERE codigo=$3',[qtd,today(),item.codigo]);
        await client.query('INSERT INTO movimentacoes(tipo,codigo,quantidade,data,obs) VALUES($1,$2,$3,$4,$5)',['saida',item.codigo,qtd,today(),`Romaneio ${pedido}`]);
        romItens.push({codigo:item.codigo,quantidade:qtd,unidade:item.unidade||'UN'});
      }
      await client.query('COMMIT');
      return jsonRes(res, 201, {...rom.rows[0], itens: romItens});
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  if (pathname === '/api/config' && method === 'GET') {
    const r = await pool.query('SELECT chave,valor FROM config');
    const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor);
    return jsonRes(res, 200, cfg);
  }

  if (pathname === '/api/config' && method === 'PUT') {
    const body = await readBody(req);
    for (const [k,v] of Object.entries(body)) {
      await pool.query('INSERT INTO config(chave,valor) VALUES($1,$2) ON CONFLICT(chave) DO UPDATE SET valor=$2',[k,String(v)]);
    }
    const r = await pool.query('SELECT chave,valor FROM config');
    const cfg = {}; r.rows.forEach(row => cfg[row.chave] = row.valor);
    return jsonRes(res, 200, cfg);
  }

  if (pathname === '/api/importar' && method === 'POST') {
    const {rows=[]} = await readBody(req);
    let count = 0;
    for (const row of rows) {
      const codigo = (row.codigo||'').trim(); if (!codigo) continue;
      const qtd = Number(row.quantidade||0);
      const ex = await pool.query('SELECT id FROM produtos WHERE codigo=$1',[codigo]);
      if (ex.rows.length) { await pool.query('UPDATE produtos SET quantidade=quantidade+$1,ultima_mov=$2 WHERE codigo=$3',[qtd,today(),codigo]); }
      else { await pool.query('INSERT INTO produtos(codigo,descricao,localizacao,quantidade,categoria,ultima_mov) VALUES($1,$2,$3,$4,$5,$6)',[codigo,row.descricao||codigo,row.localizacao||'-',qtd,row.categoria||'Geral',today()]); }
      count++;
    }
    return jsonRes(res, 200, {importados: count, total: rows.length});
  }

  if (pathname === '/api/movimentacoes' && method === 'GET') {
    const limit = Number(parsed.query.limit||50);
    return jsonRes(res, 200, (await pool.query('SELECT * FROM movimentacoes ORDER BY id DESC LIMIT $1',[limit])).rows);
  }

  return jsonRes(res, 404, { erro: `Rota nao encontrada: ${method} ${pathname}` });
}

const server = http.createServer(async(req,res) => {
  try { await router(req,res); }
  catch(err) { console.error('[ERRO]',err.message); jsonRes(res,500,{erro:err.message}); }
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log('EDDI Casa com PostgreSQL rodando na porta ' + PORT);
  });
}).catch(err => {
  console.error('ERRO ao conectar PostgreSQL:', err.message);
  process.exit(1);
});
