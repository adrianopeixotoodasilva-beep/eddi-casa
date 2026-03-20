#!/usr/bin/env python3
"""
EDDI Casa — SQLite Bridge
Recebe um JSON via stdin com { "action": "...", ...params }
Retorna um JSON via stdout com { "ok": true, "data": ... } ou { "ok": false, "error": "..." }
"""

import sys
import json
import sqlite3
import os
from datetime import date

DB_PATH = os.path.join(os.path.dirname(__file__), 'eddi_casa.db')

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS produtos (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo       TEXT    NOT NULL UNIQUE,
            descricao    TEXT    NOT NULL,
            localizacao  TEXT    DEFAULT '—',
            quantidade   INTEGER DEFAULT 0,
            categoria    TEXT    DEFAULT 'Geral',
            ultima_mov   TEXT    DEFAULT (date('now'))
        );

        CREATE TABLE IF NOT EXISTS movimentacoes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo       TEXT NOT NULL,
            codigo     TEXT NOT NULL,
            quantidade INTEGER NOT NULL,
            data       TEXT DEFAULT (date('now')),
            obs        TEXT
        );

        CREATE TABLE IF NOT EXISTS romaneios (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido       TEXT NOT NULL,
            destinatario TEXT NOT NULL,
            data_envio   TEXT,
            criado_em    TEXT DEFAULT (date('now'))
        );

        CREATE TABLE IF NOT EXISTS romaneio_itens (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            romaneio_id  INTEGER NOT NULL REFERENCES romaneios(id),
            codigo       TEXT NOT NULL,
            quantidade   INTEGER NOT NULL,
            unidade      TEXT DEFAULT 'UN'
        );

        CREATE TABLE IF NOT EXISTS config (
            chave TEXT PRIMARY KEY,
            valor TEXT
        );
    """)
    conn.commit()

    # Seed config defaults
    defaults = [
        ('empresa',       'EDDI Casa'),
        ('cnpj',          ''),
        ('responsavel',   ''),
        ('email',         ''),
        ('telefone',      ''),
        ('alerta_minimo', 'true'),
        ('qtd_minima',    '5'),
        ('idioma',        'Português (BR)'),
    ]
    for chave, valor in defaults:
        conn.execute("INSERT OR IGNORE INTO config(chave,valor) VALUES (?,?)", (chave, valor))

    # Seed produtos demo
    demo = [
        ('PROD-001','Cadeira escritório','A-02-B',12,'Móveis'),
        ('PROD-007','Mesa escrivaninha', 'B-05-A', 5,'Móveis'),
        ('PROD-022','Armário 2 portas',  'C-01-C', 8,'Móveis'),
        ('PROD-034','Sofá 3 lugares',    'D-03-A', 0,'Móveis'),
        ('PROD-041','Luminária de mesa', 'A-08-B',21,'Decoração'),
        ('PROD-055','Monitor 27"',       'E-01-A', 6,'Eletrônicos'),
        ('PROD-060','Teclado mecânico',  'E-02-A',14,'Eletrônicos'),
    ]
    for row in demo:
        conn.execute(
            "INSERT OR IGNORE INTO produtos(codigo,descricao,localizacao,quantidade,categoria) VALUES (?,?,?,?,?)",
            row
        )
    conn.commit()

def rows_to_list(rows):
    return [dict(r) for r in rows]

def today():
    return date.today().isoformat()

# ── HANDLERS ─────────────────────────────────────────────────────────────────

def handle(action, params, conn):

    # ── stats ──────────────────────────────────────────────────────────────
    if action == 'stats':
        t = today()
        total    = conn.execute("SELECT COALESCE(SUM(quantidade),0) FROM produtos").fetchone()[0]
        entradas = conn.execute("SELECT COALESCE(SUM(quantidade),0) FROM movimentacoes WHERE tipo='entrada' AND data=?", (t,)).fetchone()[0]
        saidas   = conn.execute("SELECT COALESCE(SUM(quantidade),0) FROM movimentacoes WHERE tipo='saida'   AND data=?", (t,)).fetchone()[0]
        qtd_min  = int(conn.execute("SELECT valor FROM config WHERE chave='qtd_minima'").fetchone()[0] or 5)
        alertas  = conn.execute("SELECT COUNT(*) FROM produtos WHERE quantidade <= ?", (qtd_min,)).fetchone()[0]
        return {'total_itens': total, 'entradas_hoje': entradas, 'saidas_hoje': saidas, 'alertas': alertas}

    # ── produtos list ──────────────────────────────────────────────────────
    if action == 'produtos_list':
        q   = params.get('q','').strip()
        cat = params.get('categoria','')
        sql = "SELECT * FROM produtos WHERE 1=1"
        args = []
        if q:
            sql += " AND (codigo LIKE ? OR descricao LIKE ? OR localizacao LIKE ?)"
            like = f'%{q}%'
            args += [like, like, like]
        if cat and cat != 'Todas':
            sql += " AND categoria = ?"
            args.append(cat)
        sql += " ORDER BY codigo"
        return rows_to_list(conn.execute(sql, args).fetchall())

    # ── produto create / entrada ───────────────────────────────────────────
    if action == 'produto_entrada':
        codigo      = params['codigo']
        descricao   = params['descricao']
        quantidade  = int(params['quantidade'])
        localizacao = params.get('localizacao','—')
        categoria   = params.get('categoria','Geral')

        existing = conn.execute("SELECT * FROM produtos WHERE codigo=?", (codigo,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE produtos SET quantidade=quantidade+?, ultima_mov=? WHERE codigo=?",
                (quantidade, today(), codigo)
            )
        else:
            conn.execute(
                "INSERT INTO produtos(codigo,descricao,localizacao,quantidade,categoria,ultima_mov) VALUES (?,?,?,?,?,?)",
                (codigo, descricao, localizacao, quantidade, categoria, today())
            )
        conn.execute(
            "INSERT INTO movimentacoes(tipo,codigo,quantidade,data) VALUES ('entrada',?,?,?)",
            (codigo, quantidade, today())
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM produtos WHERE codigo=?", (codigo,)).fetchone())

    # ── produto update ─────────────────────────────────────────────────────
    if action == 'produto_update':
        pid = params['id']
        fields = {k: v for k, v in params.items() if k != 'id' and k in
                  ('codigo','descricao','localizacao','quantidade','categoria')}
        if not fields:
            raise ValueError('Nenhum campo para atualizar')
        set_clause = ', '.join(f"{k}=?" for k in fields)
        values     = list(fields.values()) + [today(), pid]
        conn.execute(f"UPDATE produtos SET {set_clause}, ultima_mov=? WHERE id=?", values)
        conn.commit()
        return dict(conn.execute("SELECT * FROM produtos WHERE id=?", (pid,)).fetchone())

    # ── produto delete ─────────────────────────────────────────────────────
    if action == 'produto_delete':
        pid = params['id']
        conn.execute("DELETE FROM produtos WHERE id=?", (pid,))
        conn.commit()
        return {'ok': True}

    # ── romaneios list ─────────────────────────────────────────────────────
    if action == 'romaneios_list':
        roms = rows_to_list(conn.execute("SELECT * FROM romaneios ORDER BY id DESC").fetchall())
        for r in roms:
            r['itens'] = rows_to_list(conn.execute(
                "SELECT * FROM romaneio_itens WHERE romaneio_id=?", (r['id'],)
            ).fetchall())
        return roms

    # ── romaneio create ────────────────────────────────────────────────────
    if action == 'romaneio_create':
        pedido       = params['pedido']
        destinatario = params['destinatario']
        data_envio   = params.get('data_envio', today())
        itens        = params['itens']

        cur = conn.execute(
            "INSERT INTO romaneios(pedido,destinatario,data_envio,criado_em) VALUES (?,?,?,?)",
            (pedido, destinatario, data_envio, today())
        )
        rom_id = cur.lastrowid

        for item in itens:
            codigo    = item['codigo']
            qtd       = int(item['quantidade'])
            unidade   = item.get('unidade','UN')
            conn.execute(
                "INSERT INTO romaneio_itens(romaneio_id,codigo,quantidade,unidade) VALUES (?,?,?,?)",
                (rom_id, codigo, qtd, unidade)
            )
            # Baixa estoque
            conn.execute(
                "UPDATE produtos SET quantidade=MAX(0,quantidade-?), ultima_mov=? WHERE codigo=?",
                (qtd, today(), codigo)
            )
            conn.execute(
                "INSERT INTO movimentacoes(tipo,codigo,quantidade,data,obs) VALUES ('saida',?,?,?,?)",
                (codigo, qtd, today(), f'Romaneio {pedido}')
            )
        conn.commit()

        rom = dict(conn.execute("SELECT * FROM romaneios WHERE id=?", (rom_id,)).fetchone())
        rom['itens'] = rows_to_list(conn.execute(
            "SELECT * FROM romaneio_itens WHERE romaneio_id=?", (rom_id,)
        ).fetchall())
        return rom

    # ── config get ─────────────────────────────────────────────────────────
    if action == 'config_get':
        rows = conn.execute("SELECT chave, valor FROM config").fetchall()
        return {r['chave']: r['valor'] for r in rows}

    # ── config save ────────────────────────────────────────────────────────
    if action == 'config_save':
        for chave, valor in params.items():
            conn.execute(
                "INSERT INTO config(chave,valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
                (chave, str(valor))
            )
        conn.commit()
        rows = conn.execute("SELECT chave, valor FROM config").fetchall()
        return {r['chave']: r['valor'] for r in rows}

    # ── importar ───────────────────────────────────────────────────────────
    if action == 'importar':
        rows  = params.get('rows', [])
        count = 0
        for row in rows:
            codigo    = (row.get('codigo') or '').strip()
            if not codigo:
                continue
            descricao   = row.get('descricao', codigo)
            quantidade  = int(row.get('quantidade', 0) or 0)
            localizacao = row.get('localizacao', '—')
            categoria   = row.get('categoria', 'Geral')
            existing = conn.execute("SELECT id FROM produtos WHERE codigo=?", (codigo,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE produtos SET quantidade=quantidade+?, ultima_mov=? WHERE codigo=?",
                    (quantidade, today(), codigo)
                )
            else:
                conn.execute(
                    "INSERT INTO produtos(codigo,descricao,localizacao,quantidade,categoria,ultima_mov) VALUES (?,?,?,?,?,?)",
                    (codigo, descricao, localizacao, quantidade, categoria, today())
                )
            count += 1
        conn.commit()
        return {'importados': count, 'total': len(rows)}

    # ── movimentacoes list ─────────────────────────────────────────────────
    if action == 'movimentacoes_list':
        limit = int(params.get('limit', 50))
        rows  = conn.execute(
            "SELECT * FROM movimentacoes ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return rows_to_list(rows)

    raise ValueError(f"Ação desconhecida: {action}")


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "Nenhum input recebido"}))
        return

    try:
        payload = json.loads(raw)
        action  = payload.get('action')
        params  = payload.get('params', {})
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"JSON inválido: {e}"}))
        return

    conn = None
    try:
        conn = get_conn()
        init_db(conn)
        data = handle(action, params, conn)
        print(json.dumps({"ok": True, "data": data}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    main()
