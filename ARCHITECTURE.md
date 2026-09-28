# SindicatoRP — Arquitetura Técnica

> Documento de referência para replicar ou corrigir a infraestrutura em um novo servidor.
> Atualizado em: 14/05/2026

---

## Visão Geral dos Serviços

| Serviço | Porta | Tipo | Status |
|---|---|---|---|
| Caddy (proxy) | 443/80 | HTTPS reverse proxy | ✅ |
| Dashboard Next.js | 8081 | Web app (dashboard) | ✅ |
| FiveM Server (FXServer) | 30120 | Game server | ✅ |
| txAdmin (monitor) | 40120 | Admin panel | ✅ |

---

## Caminhos Principais

```
/home/fivem/
├── server/              # Artefatos FXServer (binários Alpine Linux)
│   ├── run.sh           # Script de start
│   └── alpine/opt/cfx-server/
│       ├── FXServer                         # Executável
│       ├── ld-musl-x86_64.so.1             # Dynamic linker
│       └── citizen/system_resources/
│           ├── monitor/                    # txAdmin (recurso built-in)
│           │   ├── panel/                 # UI do txAdmin
│           │   └── web/                   # Assets NUI
│           └── chat/                       # Chat resource
│
├── server-data/         # Dados do servidor (git repo: sindicatop)
│   ├── files/
│   │   ├── server.cfg                    # Config principal
│   │   └── resources/                    # Pasta de recursos
│   │       ├── [base]/
│   │       ├── [sindicato]/
│   │       ├── [Monkey_Core]/ ... etc
│   │       └── vrp/
│   └── .git/                             # Repo git (sindicatop)
│
├── txData/              # Dados txAdmin (criado em runtime)
│   └── default/        # Perfil default do txAdmin
│
└── dashboard/           # Deploy do dashboard Next.js
    ├── .next/
    ├── package.json
    └── node_modules/
```

```
/root/sindicato_rp_coolify/   # Repo do dashboard (GitHub: faccodev/sindicato_dashboard)
├── dashboard/
│   ├── src/app/               # Rotas Next.js (App Router)
│   │   ├── api/
│   │   │   ├── auth/          # POST (login), DELETE (logout)
│   │   │   ├── sync/          # Git sync (clone/pull server-data)
│   │   │   ├── restart/       # Restart do FiveM
│   │   │   ├── backup/        # Backup management
│   │   │   ├── logs/          # Logs do servidor
│   │   │   └── ...
│   │   └── dashboard/         # Página principal
│   ├── next.config.js         # Next.js config (SEM standalone)
│   └── package.json
│
├── deploy-dashboard.sh        # Script de deploy
└── start-fivem.sh            # Script de start do FiveM
```

---

## Configurações por Serviço

### 1. Caddy (Reverse Proxy)

**Ficheiro:** `/etc/caddy/Caddyfile`

```caddy
dash.sindicatorp.com.br {
    reverse_proxy localhost:8081
}

cli.sindicatorp.com.br {
    reverse_proxy localhost:3001
}
```

- Porta 443 (TLS automático via Let's Encrypt)
- Sem necessidade de reload ao fazer deploy — proxy é dinâmico

---

### 2. Dashboard Next.js

**Deploy:** `/home/fivem/dashboard/`

**Start:**
```bash
cd /home/fivem/dashboard
PORT=8081 \
DASHBOARD_PASSWORD='<DASHBOARD_PASSWORD>' \
GIT_TOKEN='ghp_...' \
GIT_REPO='https://github.com/faccodev/sindicatorp' \
DATA_DIR='/home/fivem/server-data' \
npm start
```

**Build + Deploy (deploy-dashboard.sh):**
```bash
cd /root/sindicato_rp_coolify/dashboard
npm run build                              # Gera .next/
rm -rf /home/fivem/dashboard
cp -r .next /home/fivem/dashboard/
cp package.json /home/fivem/dashboard/
cd /home/fivem/dashboard && npm install
# Restart manual do processo na 8081
```

**Configurações de ambiente:**

| Variável | Descrição |
|---|---|
| `PORT` | Porta onde o Next.js escuta (8081) |
| `DASHBOARD_PASSWORD` | Senha de acesso ao dashboard |
| `GIT_TOKEN` | Token GitHub para clonar sindicatop |
| `GIT_REPO` | URL do repo server-data |
| `DATA_DIR` | Caminho para server-data (`/home/fivem/server-data`) |

**next.config.js (CORRETO — sem standalone):**
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
```

> ⚠️ **NÃO usar `output: 'standalone'`** — não empacota arquivos estáticos (`/_next/static/`), causa 404 em produção.

---

### 3. FiveM Server (FXServer)

**Start (start-fivem.sh):**
```bash
cd /home/fivem/server
./run.sh \
  +set serverDataPath "/home/fivem/server-data" \
  +exec "/home/fivem/server-data/files/server.cfg" \
  +set sv_licenseKey "<LICENSE_KEY>" \
  +set monitorMode true \
  +set citizen_root "/home/fivem/server/alpine/opt/cfx-server/citizen/"
```

**Flags obrigatórios:**
- `serverDataPath` — pasta onde estão server.cfg e resources
- `monitorMode true` — **ativa o txAdmin**
- `citizen_root` — caminho para a pasta citizen (necessário para o txAdmin inicializar)
- `sv_licenseKey` — license key do servidor (keymaster.fivem.net)

**server.cfg (excerto relevante):**
```cfg
endpoint_add_tcp "0.0.0.0:30120"
endpoint_add_udp "0.0.0.0:30120"
set mysql_connection_string "server=...;database=sindicatorp;..."

ensure fivem
ensure monitor        # ← NECESSÁRIO para o txAdmin
ensure chat
ensure vrp
# ... outros resources
```

---

### 4. txAdmin

**URL:** `http://<IP>:40120` ou através do painel do FiveM

**PIN inicial:** `2336` (definido nos flags)

**txData:** `/home/fivem/server/alpine/txData/default/` (criado automaticamente)

**Para reconfigurar txAdmin:**
```bash
# Apagar txData e reiniciar — txAdmin gera novo PIN
rm -rf /home/fivem/server/alpine/txData
```

---

## Git Sync (server-data)

O dashboard tem uma rota `/api/sync` que faz git pull do repo `sindicatop` em `/home/fivem/server-data`.

**Fluxo:**
1. `POST /api/sync` recebe token GitHub via `GIT_TOKEN`
2. Faz `git fetch --depth 1 origin main`
3. Se fast-forward: `git pull --ff-only`
4. Se falhar: `git reset --hard origin/main`
5. Corrige permissões: `chown -R fivem:fivem`

**Caminhos no sync route:**
- `DATA_DIR = '/home/fivem/server-data'` (cwd para comandos git)
- Clone vai para `/home/fivem/server-data` — **NÃO** `/opt/fivem/server-data`

---

## Checklist de start (ordem de subida)

```bash
# 1. Caddy (geralmente já rodando)
caddy reload --config /etc/caddy/Caddyfile

# 2. Dashboard
cd /home/fivem/dashboard && npm start &
# ou via deploy-dashboard.sh

# 3. FiveM Server + txAdmin
bash /root/sindicato_rp_coolify/start-fivem.sh
```

---

## Verificações pós-start

```bash
# Portas abertas
ss -tlnp | grep -E '30120|40120|8081|443'

# Teste dashboard
curl -s -o /dev/null -w "%{http_code}" https://dash.sindicatorp.com.br/

# Teste txAdmin
curl -s -o /dev/null -w "%{http_code}" http://localhost:40120/

# Teste FiveM redirect
curl -s -o /dev/null -w "%{http_code}" http://localhost:30120/

# Logs FiveM
tail -f /tmp/fivem.log
```

---

## Problemas Comuns

### Dashboard 404 em chunks
- **Causa:** `output: 'standalone'` no next.config.js
- **Fix:** Remover standalone, build vai para `.next/` padrão, copiar para `/home/fivem/dashboard/`

### txAdmin não sobe (porta 40120 não abre)
- **Causa:** Falta `monitorMode true` ou `citizen_root` nos flags
- **Fix:** `+set monitorMode true +set citizen_root "/home/fivem/server/alpine/opt/cfx-server/citizen/"`

### Server.cfg não encontrado
- **Causa:** Caminho relativo. `+exec files/server.cfg` funciona se cwd for `/home/fivem/server`
- **Fix:** Usar caminho absoluto: `+exec "/home/fivem/server-data/files/server.cfg"`

### git clone vai para /opt em vez de /home
- **Causa:** Rotas de API usam `cwd: DATA_DIR` por padrão; clone precisa de `cwd` no root
- **Fix:** Clone usa `shRoot()` (sem cwd) para operations no diretório pai

---

## Repos Git

| Repo | URL | Conteúdo |
|---|---|---|
| `sindicato_dashboard` | github.com/faccodev/sindicato_dashboard | Código do dashboard Next.js |
| `sindicatop` | github.com/faccodev/sindicatorp | Resources do servidor e server.cfg |

---

## Credenciais (mantidas em memória, nunca em código)

- Dashboard password: `<DASHBOARD_PASSWORD>`
- GitHub token: `<GITHUB_TOKEN>`
- MySQL: `server=104.234.63.121; database=sindicatorp; user=root; password=<MYSQL_PASSWORD>`
- FiveM license key: `<LICENSE_KEY>`
- txAdmin PIN: `2336`