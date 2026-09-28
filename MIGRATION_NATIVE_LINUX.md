# Migração: Docker/Coolify → Linux Nativo (Bare Metal)

Este guia move todos os serviços do Docker para execução direta no Linux, eliminando a camada de virtualização para máximo desempenho.

> **Arquitetura com banco dedicado.** O MariaDB roda em um servidor separado. O servidor de game só se conecta remotamente via `:3306`.

---

## Visão Geral da Arquitetura

```
ANTES (Docker em 1 servidor):
┌─────────────────────────────────────────┐
│  fivem | db | dashboard | mock_auth    │
│           (5 containers, 1 servidor)    │
└─────────────────────────────────────────┘

DEPOIS (2 servidores Linux nativos):
┌─────────────────────────┐        ┌─────────────────────────┐
│  SERVIDOR 1 (GAME)      │        │  SERVIDOR 2 (DB)        │
│  ─────────────────────  │        │  ─────────────────────  │
│  FiveM Server           │◄──────►│  MariaDB 10.5           │
│  mock_auth (:8082)     │ :3306  │                         │
│  Dashboard (:81)        │        │                         │
│  (Linux Nativo)         │        │  (Linux Nativo)         │
└─────────────────────────┘        └─────────────────────────┘
```

---

## Tempo Estimado: 45–75 minutos (divididos entre 2 servidores)

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 1 — SERVIDOR 2: BANCO DE DADOS
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

> **Execute esta parte primeiro.** O servidor de game precisa do banco no ar antes de subir.

## 1.1 — Acesse o servidor de banco

```bash
ssh root@IP_DO_SERVIDOR_DB
```

## 1.2 — Atualize o sistema

```bash
apt update && apt upgrade -y
```

## 1.3 — Instale o MariaDB

```bash
apt install -y mariadb-server mariadb-client
```

## 1.4 — Inicie e habilite

```bash
systemctl enable mariadb
systemctl start mariadb
systemctl status mariadb
```

## 1.5 — Hardening inicial

```bash
mysql_secure_installation
```

Responda:
- ** root password**: `<DB_PASSWORD>`
- **Remove anonymous users**: `Y`
- **Disallow root login remotely**: `N` ← importante, o game server vai acessar remotamente
- **Remove test database**: `Y`
- **Reload privilege tables**: `Y`

## 1.6 — Crie o banco, usuário e permissões

```bash
mysql -u root -p
```

```sql
CREATE DATABASE IF NOT EXISTS creative_tema_proprio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Usuário que o servidor de game vai usar
CREATE USER IF NOT EXISTS 'fivem'@'%' IDENTIFIED BY '<DB_PASSWORD>';

-- Permissão para acessar de qualquer IP (ou troque '%' pelo IP exato do game server)
GRANT ALL PRIVILEGES ON creative_tema_proprio.* TO 'fivem'@'%';
FLUSH PRIVILEGES;
EXIT;
```

> **Dica de segurança:** troque `'fivem'@'%'` por `'fivem'@'IP_DO_SERVIDOR_GAME'` para permitir acesso só daquele IP.

## 1.7 — Configure bind-address para aceitar conexões externas

```bash
nano /etc/mysql/mariadb.conf.d/50-server.cnf
```

Encontre a linha `bind-address` e mude para:

```ini
bind-address = 0.0.0.0
```

Se quiser aceitar só do servidor de game:

```ini
bind-address = IP_DO_SERVIDOR_GAME
```

## 1.8 — Reinicie

```bash
systemctl restart mariadb
```

## 1.9 — Teste conexão local

```bash
mysql -u fivem -p<DB_PASSWORD> -e "SELECT 1 AS test;"
```

Deve retornar `test = 1`.

## 1.10 — Libere a porta 3306 no firewall

```bash
# Se usar UFW:
ufw allow from IP_DO_SERVIDOR_GAME to any port 3306
ufw allow 22/tcp    # SSH
ufw enable

# Se usar iptables diretamente:
iptables -A INPUT -p tcp -s IP_DO_SERVIDOR_GAME --dport 3306 -j ACCEPT
```

## 1.11 — Importe dados existentes (se tiver backup do Docker)

```bash
# No servidor Docker antigo, exporte:
docker exec fivem-mysql mysqldump -u root -p<DB_PASSWORD> creative_tema_proprio > backup.sql

# Transfira para o servidor DB:
scp backup.sql root@IP_DO_SERVIDOR_DB:/tmp/

# No servidor DB, importe:
mysql -u root -p<DB_PASSWORD> creative_tema_proprio < /tmp/backup.sql
```

**Banco dedicado pronto.** Agora pro servidor de game.

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 2 — SERVIDOR 1: GAME SERVER
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 2.1 — Acesse o servidor de game

```bash
ssh root@IP_DO_SERVIDOR_GAME
```

## 2.2 — Atualize o sistema

```bash
apt update && apt upgrade -y
```

## 2.3 — Instale dependências

```bash
# Base
apt install -y curl git xz-utils wget gnupg2 ca-certificates

# Node.js 20 (dashboard + mock_auth)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Bibliotecas FiveM
apt install -y \
    libmariadb3 libmariadb-dev \
    python3 python3-pip \
    zip unzip \
    zlib1g-dev libcurl4-openssl-dev \
    libstdc++6 libncurses5
```

Verifique:
```bash
node --version   # v20.x.x
npm --version
```

## 2.4 — Crie o usuário e diretórios

```bash
useradd -m -s /bin/bash fivem

mkdir -p /opt/fivem/server-data
mkdir -p /opt/fivem/txData
mkdir -p /var/log/fivem
mkdir -p /opt/fivem/dashboard

chown -R fivem:fivem /opt/fivem
chown -R fivem:fivem /var/log/fivem
```

---

## 2.5 — Baixe os artefatos do FiveM

```bash
cd /opt/fivem
su fivem

ARTIFACT_URL="https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/25770-8ddccd4e4dfd6a760ce18651656463f961cc4761/fx.tar.xz"
curl -f -O "$ARTIFACT_URL"
tar -xf fx.tar.xz
rm fx.tar.xz version.json

ls /opt/fivem/
# Deve ter: run.sh, fxServer, CitizenV...
```

## 2.6 — Clone o repositório e copie os arquivos

```bash
git clone https://github.com/faccodev/sindicatorp.git /tmp/sindicato_tmp

cp -r /tmp/sindicato_tmp/files/* /opt/fivem/server-data/
cp /tmp/sindicato_tmp/sync.sh /opt/fivem/server-data/
cp /tmp/sindicato_tmp/sync_server.js /opt/fivem/server-data/
cp /tmp/sindicato_tmp/start.sh /opt/fivem/server-data/
cp /tmp/sindicato_tmp/docker/mock_auth.js /opt/fivem/

chmod +x /opt/fivem/server-data/start.sh
chmod +x /opt/fivem/server-data/sync.sh
chmod +x /opt/fivem/mock_auth.js
```

## 2.7 — Configure as variáveis de ambiente

```bash
nano /opt/fivem/server-data/.env
```

```env
# Banco REMOTO — IP do servidor DB
DB_HOST=IP_DO_SERVIDOR_DB
DB_USER=fivem
DB_PASSWORD=<DB_PASSWORD>
DB_NAME=creative_tema_proprio
DB_PORT=3306

SV_LICENSE_KEY=<LICENSE_KEY>
STEAM_WEB_API_KEY=A8B24EBCAA195B347900C09BE4688FFE
GIT_REPO=https://github.com/faccodev/sindicatorp.git
GIT_TOKEN=<GITHUB_TOKEN>
```

## 2.8 — Execute o sync (popula resources do GitHub)

```bash
cd /opt/fivem/server-data
export $(cat .env | xargs) && bash sync.sh
```

Isso clona o repo, cria symlinks e duplica arquivos VRP pra case sensitivity.

## 2.9 — Crie o server.cfg

```bash
nano /opt/fivem/server-data/server.cfg
```

```cfg
#============================================#
#        SindicatoRP - Configuração          #
#============================================#

endpoint_add_tcp "0.0.0.0:30120"
endpoint_add_udp "0.0.0.0:30120"

# MySQL — IP do servidor de banco!
set mysql_connection_string "server=IP_DO_SERVIDOR_DB;uid=fivem;pwd=<DB_PASSWORD>;database=creative_tema_proprio;port=3306"

# Licença e Auth
sv_licenseKey "<LICENSE_KEY>"
set steam_webApiKey "A8B24EBCAA195B347900C09BE4688FFE"

# txAdmin
set txAdminPort 40120
set txAdmin-oneTimePIN 2336
set serverProfile "default"
set txAdminServerConfigPath "/opt/fivem/server-data/server.cfg"
set txAdminPath "/opt/fivem/txData"

# Desabilitado para dev
set sv_assetValidationMode "disabled"
set sv_enforceGameBuild 0

# Rede
sv_hostname "SindicatoRP"
sv_maxclients 48
sv_onesync_enabled false

# Base resources
ensure mapmanager
ensure spawnmanager
ensure sessionmanager
ensure fivem
ensure baseevents

# Resources do repo
exec /opt/fivem/server-data/resources.cfg
```

## 2.10 — Crie o resources.cfg

```bash
nano /opt/fivem/server-data/resources.cfg
```

Liste seus resources:
```
ensure vrp
ensure [resource_1]
ensure [resource_2]
# ... seus outros resources
```

## 2.11 — Teste conexão com o banco remoto

Antes de subir o FiveM, teste se conecta no banco:

```bash
apt install -y mariadb-client

mysql -h IP_DO_SERVIDOR_DB -u fivem -p<DB_PASSWORD> -e "SELECT 1;"
```

Deve funcionar sem erro.

---

## 2.12 — Teste o FiveM manualmente

```bash
cd /opt/fivem

./run.sh \
  +set serverProfile default \
  +set txAdminPort 40120 \
  +set txAdmin-oneTimePIN 2336 \
  +set txAdminServerConfigPath /opt/fivem/server-data/server.cfg \
  +set mysql_connection_string "server=IP_DO_SERVIDOR_DB;uid=fivem;pwd=<DB_PASSWORD>;database=creative_tema_proprio;port=3306" \
  +set sv_assetValidationMode disabled
```

Se subir, tá funcionando. Tecle `Ctrl+C` pra parar.

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 3 — SERVICES SYSTEMD
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 3.1 — mock_auth (porta 8082)

```bash
nano /etc/systemd/system/fivem-mock-auth.service
```

```ini
[Unit]
Description=FiveM Mock Auth Server
After=network.target

[Service]
Type=simple
User=fivem
WorkingDirectory=/opt/fivem
ExecStart=/usr/bin/node /opt/fivem/mock_auth.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/fivem/mock_auth.log
StandardError=append:/var/log/fivem/mock_auth.log

[Install]
WantedBy=multi-user.target
```

## 3.2 — Dashboard (porta 81)

Primeiro, built o dashboard no seu PC local e envie:

```bash
# No seu PC:
cd dashboard
npm install
npm run build

scp -r .next/standalone fivem@IP_DO_SERVIDOR_GAME:/tmp/dashboard/
scp -r .next/static fivem@IP_DO_SERVIDOR_GAME:/tmp/dashboard/.next/
```

No servidor:

```bash
cp -r /tmp/dashboard/* /opt/fivem/dashboard/
chown -R fivem:fivem /opt/fivem/dashboard

nano /opt/fivem/dashboard/.env
```

```env
PORT=81
HOSTNAME=0.0.0.0
DASHBOARD_PASSWORD=<DASHBOARD_PASSWORD>
GIT_REPO=https://github.com/faccodev/sindicatorp.git
GIT_TOKEN=<GITHUB_TOKEN>
DATA_DIR=/opt/fivem/server-data
DB_HOST=IP_DO_SERVIDOR_DB
DB_USER=fivem
DB_PASSWORD=<DB_PASSWORD>
DB_NAME=creative_tema_proprio
DB_PORT=3306
```

```bash
nano /etc/systemd/system/fivem-dashboard.service
```

```ini
[Unit]
Description=FiveM Dashboard (Next.js)
After=network.target fivem-mock-auth.service

[Service]
Type=simple
User=fivem
WorkingDirectory=/opt/fivem/dashboard
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/fivem/dashboard.log
StandardError=append:/var/log/fivem/dashboard.log
EnvironmentFile=/opt/fivem/dashboard/.env

[Install]
WantedBy=multi-user.target
```

## 3.3 — FiveM Server (portas 30120, 40120)

```bash
nano /etc/systemd/system/fivem-server.service
```

```ini
[Unit]
Description=FiveM GTA RP Server
After=network.target fivem-mock-auth.service
Wants=fivem-mock-auth.service

[Service]
Type=simple
User=fivem
WorkingDirectory=/opt/fivem/server-data
EnvironmentFile=/opt/fivem/server-data/.env
ExecStart=/opt/fivem/run.sh \
    +set serverProfile default \
    +set txAdminPort 40120 \
    +set txAdmin-oneTimePIN 2336 \
    +set txAdminServerConfigPath /opt/fivem/server-data/server.cfg \
    +set mysql_connection_string "server=${DB_HOST};uid=${DB_USER};pwd=${DB_PASSWORD};database=${DB_NAME};port=${DB_PORT}" \
    +set sv_assetValidationMode disabled
Restart=always
RestartSec=10
StandardOutput=append:/var/log/fivem/server.log
StandardError=append:/var/log/fivem/server.log
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

## 3.4 — Ative todos os services

```bash
systemctl daemon-reload
systemctl enable fivem-mock-auth
systemctl enable fivem-dashboard
systemctl enable fivem-server

systemctl start fivem-mock-auth
systemctl start fivem-dashboard
systemctl start fivem-server

systemctl status fivem-mock-auth
systemctl status fivem-dashboard
systemctl status fivem-server
```

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 4 — FIREWALL (UFW)
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## No servidor de game:

```bash
ufw allow 22/tcp          # SSH
ufw allow 80/tcp           # Dashboard
ufw allow 30120/tcp        # FiveM TCP
ufw allow 30120/udp        # FiveM UDP
ufw allow 40120/tcp        # txAdmin
ufw allow from IP_DO_SERVIDOR_DB to any port 3306  # MySQL (origem DB)

ufw enable
ufw status
```

## No servidor de banco:

```bash
ufw allow 22/tcp
ufw allow from IP_DO_SERVIDOR_GAME to any port 3306
ufw enable
```

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 5 — VERIFICAÇÕES FINAIS
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```bash
# No servidor de game:
ss -tlnp | grep -E '(30120|40120|81|8082)'
journalctl -u fivem-server -f
tail -f /var/log/fivem/server.log

# Testes de conectividade:
curl http://localhost:8082         # mock_auth → true
curl http://localhost:81           # dashboard → HTML

# Testa banco do game server:
mysql -h IP_DO_SERVIDOR_DB -u fivem -p<DB_PASSWORD> -e "SELECT 1;"
```

**Acesse:**
- Dashboard: `http://IP_DO_SERVIDOR_GAME:81`
- txAdmin: `http://IP_DO_SERVIDOR_GAME:40120`
- FiveM (jogo): `IP_DO_SERVIDOR_GAME:30120`

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 6 — MIGRAÇÃO DOS DADOS DO DOCKER
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Dados txData e Resources:

```bash
# No servidor Docker antigo:
docker cp fivem-custom:/server/txData /tmp/txData_backup
docker cp fivem-custom:/server/data /tmp/data_backup

# Transfira pro servidor de game:
scp -r /tmp/txData_backup/* root@IP_DO_SERVIDOR_GAME:/opt/fivem/txData/
scp -r /tmp/data_backup/* root@IP_DO_SERVIDOR_GAME:/opt/fivem/server-data/

# Permissões:
chown -R fivem:fivem /opt/fivem/txData
chown -R fivem:fivem /opt/fivem/server-data
```

---

#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARTE 7 — ROLLBACK (VOLTA PRO DOCKER)
#━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Se precisar voltar pro Docker:

```bash
cd /caminho/do/projeto
docker compose down
docker compose up -d
```

---

## Ganho de Performance Esperado

| Aspecto | Docker (Coolify) | Linux Nativo |
|---------|-----------------|--------------|
| CPU overhead | ~2-5% | ~0% |
| Rede (game server) | Bridge NAT | Direto |
| E/S disco | Camada virtual | Direto |
| Memória | ~150MB overhead Docker | ~0 overhead |
| MariaDB | Compartilhado c/ outros | Dedicado = muito melhor |
| Latência rede | +1-3ms | Mínimo |

Com **banco dedicado**, o MariaDB rende muito mais — sem competir por CPU/memória com o FiveM. Isso é o maior ganho dessa arquitetura.

---

## Problemas Comuns

### "Can't connect to MySQL server"
```
# No game server, teste:
mysql -h IP_DO_SERVIDOR_DB -u fivem -p<DB_PASSWORD> -e "SELECT 1;"

# No DB server, verifique:
ss -tlnp | grep 3306
# Deve mostrar 0.0.0.0:3306 ou IP:3306
```

Se não estiver escutando, verifique `bind-address` no MariaDB.

### "FiveM não inicia"
```bash
journalctl -u fivem-server -e
tail -100 /var/log/fivem/server.log
ss -tlnp | grep 30120   # porta em uso?
```

### "Dashboard não carrega"
```bash
cd /opt/fivem/dashboard
node server.js   # ve o erro direto
```

---

*Guia criado com base na estrutura do projeto `sindicato_rp_coolify` — FiveM + MariaDB (dedicado) + Next.js Dashboard*
