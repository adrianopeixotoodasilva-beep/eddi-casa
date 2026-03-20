# EDDI Casa — Sistema de Estoque

## Estrutura de arquivos

```
eddi-casa/
├── iniciar.bat       ← CLIQUE AQUI para iniciar no Windows
├── server.js         ← Servidor Node.js
├── db_bridge.py      ← Conexão com o banco SQLite
├── public/
│   └── index.html    ← Interface web
└── eddi_casa.db      ← Banco de dados (criado automaticamente)
```

---

## Como usar no Windows

### Passo 1 — Instalar Node.js
1. Acesse: https://nodejs.org/
2. Baixe a versão **LTS**
3. Instale normalmente (Next > Next > Finish)

### Passo 2 — Instalar Python
1. Acesse: https://www.python.org/downloads/
2. Clique em **Download Python**
3. Na instalação, marque **"Add Python to PATH"** ✅ (importante!)
4. Clique em **Install Now**

### Passo 3 — Iniciar o sistema
1. Extraia a pasta `eddi-casa` em qualquer lugar do computador
2. Dê **duplo clique** no arquivo `iniciar.bat`
3. Uma janela preta vai abrir mostrando o servidor rodando
4. Abra o navegador e acesse: **http://localhost:3000**

> ⚠️ Não feche a janela preta enquanto estiver usando o sistema.

---

## O banco de dados

O arquivo `eddi_casa.db` é criado automaticamente na primeira execução.
Todos os dados ficam salvos nesse arquivo — não delete ele.

Tabelas criadas:
- `produtos` — cadastro de estoque
- `movimentacoes` — histórico de entradas e saídas
- `romaneios` — romaneios emitidos
- `romaneio_itens` — itens de cada romaneio
- `config` — configurações da empresa

---

## Solução de problemas

**"node não é reconhecido"** → Reinstale o Node.js de nodejs.org

**"python não é reconhecido"** → Reinstale o Python marcando "Add Python to PATH"

**Porta 3000 ocupada** → Edite `server.js` e troque `3000` por `3001`
