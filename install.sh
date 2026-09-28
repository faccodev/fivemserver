#!/bin/bash
#===============================================================
# FiveM Server — Script de Instalação Linux Nativo
# Uso: ssh root@GAME_SERVER_IP 'bash -s' < install.sh
#      Ou: wget -qO- https://raw.githubusercontent.com/faccodev/sindicato_rp_coolify/main/install.sh | bash -
#===============================================================

set -e

#------------------------------------------
# CORES
#------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

#------------------------------------------
# VERIFICAÇÕES INICIAIS
#------------------------------------------
if [[ $EUID -ne 0 ]]; then
   err "Execute como root (sudo bash install.sh)"
fi

if ! command -v apt &> /dev/null; then
    err "Este script é feito para Debian/Ubuntu. Instale manualmente."
fi

#------------------------------------------
# PERGUNTAS DE CONFIGURAÇÃO
#------------------------------------------
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  FiveM Server — Instalação Linux Nativo${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

read -p "IP do servidor de BANCO DE DADOS: " DB_HOST
DB_HOST=${DB_HOST:-""}
[[ -z "$DB_HOST" ]] && err "IP do banco de dados é obrigatório."

read -p "Usuário MySQL [fivem]: " DB_USER
DB_USER=${DB_USER:-fivem}

read -p "Senha MySQL: " -s DB_PASSWORD
echo ""
[[ -z "$DB_PASSWORD" ]] && err "Senha do banco de dados é obrigatória."

read -p "Nome do banco [creative_tema_proprio]: " DB_NAME
DB_NAME=${DB_NAME:-creative_tema_proprio}

read -p "IP público do servidor de GAME [$(curl -s ifconfig.me 2>/dev/null || echo 'SEU_IP')]: " SERVER_IP
SERVER_IP=${SERVER_IP:-$(curl -s ifconfig.me)}
SERVER_IP=${SERVER_IP:-"SEU_IP_AQUI"}

read -p "Slots máximo [48]: " SV_MAXCLIENTS
SV_MAXCLIENTS=${SV_MAXCLIENTS:-48}

read -p "Porta do jogo [30120]: " GAME_PORT
GAME_PORT=${GAME_PORT:-30120}

read -p "URL do repositório GitHub: " GIT_REPO
GIT_REPO=${GIT_REPO:-https://github.com/faccodev/sindicatorp.git}

read -p "FiveM License Key (cfxk_...): " SV_LICENSE_KEY
SV_LICENSE_KEY=${SV_LICENSE_KEY:-""}

read -p "Steam Web API Key: " STEAM_WEB_API_KEY
STEAM_WEB_API_KEY=${STEAM_WEB_API_KEY:-""}

read -p "GitHub Token (ghp_...): " GIT_TOKEN
GIT_TOKEN=${GIT_TOKEN:-""}

read -p "Versão do artifact [25770-8ddccd4e4dfd6a760ce18651656463f961cc4761]: " ARTIFACT_VER
ARTIFACT_VER=${ARTIFACT_VER:-25770-8ddccd4e4dfd6a760ce18651656463f961cc4761}

echo ""
log "Configuração registrada. Iniciando instalação..."
sleep 2

#------------------------------------------
# PARTE 1: SISTEMA BASE
#------------------------------------------
log "Atualizando sistema..."
apt update && apt upgrade -y

log "Instalando dependências..."
apt install -y \
    curl git xz-utils wget gnupg2 ca-certificates \
    sudo nano htop iotop unzip zip \
    libmariadb3 libmariadb-dev \
    python3 python3-pip \
    zlib1g-dev libcurl4-openssl-dev \
    libstdc++6 libncurses5 \
    mariadb-client postgresql-client

log "Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || {
    warn "NodeSource falhou, tentando Node 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
}
apt install -y nodejs
log "Node.js: $(node --version) | npm: $(npm --version)"

#------------------------------------------
# CADDY
#------------------------------------------
log "Instalando Caddy..."
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
systemctl enable caddy
log "Caddy instalado."

#------------------------------------------
# PARTE 2: USUÁRIO E DIRETÓRIOS
#------------------------------------------
log "Criando usuário fivem..."
if ! id "fivem" &>/dev/null; then
    useradd -m -s /bin/bash fivem
else
    warn "Usuário fivem já existe."
fi

BASE_DIR="/opt/fivem"
DATA_DIR="$BASE_DIR/server-data"
TX_DIR="$BASE_DIR/txData"
LOG_DIR="/var/log/fivem"

mkdir -p "$DATA_DIR"
mkdir -p "$TX_DIR"
mkdir -p "$LOG_DIR"
chown -R fivem:fivem "$BASE_DIR"
chown -R fivem:fivem "$LOG_DIR"

#------------------------------------------
# PARTE 3: ARTIFACTS FIVEM
#------------------------------------------
log "Baixando artefatos FiveM..."
cd "$BASE_DIR"
ARTIFACT_URL="https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/$ARTIFACT_VER/fx.tar.xz"
log "URL: $ARTIFACT_URL"
rm -f fx.tar.xz version.json 2>/dev/null || true
curl -f -O "$ARTIFACT_URL" || err "Falha ao baixar artefatos. Verifique a versão."
tar -xf fx.tar.xz && rm fx.tar.xz version.json
[[ ! -f "$BASE_DIR/run.sh" ]] && err "Artifact não contém run.sh."
chown -R fivem:fivem "$BASE_DIR"
log "Artefatos instalados."

#------------------------------------------
# PARTE 4: CLONE DO REPOSITÓRIO DIRETO EM SERVER-DATA/
#------------------------------------------
log "Baixando código do repositório..."

AUTH_URL="$GIT_REPO"
if [[ -n "$GIT_TOKEN" ]]; then
    AUTH_URL="${GIT_REPO/https:\/\//https://x-access-token:$GIT_TOKEN@}"
fi

if [[ -d "$DATA_DIR/.git" ]]; then
    warn "Reposítorio já existe em $DATA_DIR. Fazendo pull..."
    sudo -u fivem git -C "$DATA_DIR" pull origin main
else
    log "Clonando repositório direto em $DATA_DIR (shallow clone)..."
    rm -rf "$DATA_DIR"
    mkdir -p "$DATA_DIR"
    sudo -u fivem git clone --depth 1 "$AUTH_URL" "$DATA_DIR" || err "Falha ao clonar repositório."
fi

chown -R fivem:fivem "$DATA_DIR"

# Cria script de sync simples
log "Criando script de sync..."
cat > "$DATA_DIR/sync.sh" << 'SYNCSCRIPT'
#!/bin/bash
set -e
DATA_DIR="/opt/fivem/server-data"
echo "[SYNC] Sincronizando código..."
cd "$DATA_DIR"
sudo -u fivem git pull origin main
echo "[SYNC] Atualizado — $(git log -1 --format='%h %s')"
SYNCSCRIPT
chmod +x "$DATA_DIR/sync.sh"
chown fivem:fivem "$DATA_DIR/sync.sh"

# Scripts auxiliares
[[ -f "$DATA_DIR/start.sh" ]] && chmod +x "$DATA_DIR/start.sh"
[[ -f "$DATA_DIR/fivemctl" ]] && {
    cp "$DATA_DIR/fivemctl" "$BASE_DIR/fivemctl"
    chmod +x "$BASE_DIR/fivemctl"
}

# VRP case sensitivity fix
VRP_LIB="$DATA_DIR/resources/vrp/lib"
if [[ -d "$VRP_LIB" ]]; then
    log "Corrigindo case sensitivity do VRP..."
    cd "$VRP_LIB"
    for file in tunnel.lua proxy.lua htmlEntities.lua tools.lua utils.lua; do
        [[ -f "$file" ]] && cp -f "$file" "${file^}"
    done
fi

#------------------------------------------
# PARTE 5: CONFIGURAÇÃO
#------------------------------------------
log "Criando arquivos de configuração..."

cat > "$DATA_DIR/.env" << 'ENVVARS'
DB_HOST=DB_HOST_PLACEHOLDER
DB_USER=DB_USER_PLACEHOLDER
DB_PASSWORD=DB_PASSWORD_PLACEHOLDER
DB_NAME=DB_NAME_PLACEHOLDER
DB_PORT=3306
SV_LICENSE_KEY=SV_LICENSE_PLACEHOLDER
STEAM_WEB_API_KEY=STEAM_API_PLACEHOLDER
GIT_REPO=GIT_REPO_PLACEHOLDER
GIT_TOKEN=GIT_TOKEN_PLACEHOLDER
SERVER_IP=SERVER_IP_PLACEHOLDER
SV_MAXCLIENTS=SV_MAXCLIENTS_PLACEHOLDER
GAME_PORT=GAME_PORT_PLACEHOLDER
ENVVARS

sed -i "s|DB_HOST_PLACEHOLDER|$DB_HOST|g" "$DATA_DIR/.env"
sed -i "s|DB_USER_PLACEHOLDER|$DB_USER|g" "$DATA_DIR/.env"
sed -i "s|DB_PASSWORD_PLACEHOLDER|$DB_PASSWORD|g" "$DATA_DIR/.env"
sed -i "s|DB_NAME_PLACEHOLDER|$DB_NAME|g" "$DATA_DIR/.env"
sed -i "s|SV_LICENSE_PLACEHOLDER|$SV_LICENSE_KEY|g" "$DATA_DIR/.env"
sed -i "s|STEAM_API_PLACEHOLDER|$STEAM_WEB_API_KEY|g" "$DATA_DIR/.env"
sed -i "s|GIT_REPO_PLACEHOLDER|$GIT_REPO|g" "$DATA_DIR/.env"
sed -i "s|GIT_TOKEN_PLACEHOLDER|$GIT_TOKEN|g" "$DATA_DIR/.env"
sed -i "s|SERVER_IP_PLACEHOLDER|$SERVER_IP|g" "$DATA_DIR/.env"
sed -i "s|SV_MAXCLIENTS_PLACEHOLDER|$SV_MAXCLIENTS|g" "$DATA_DIR/.env"
sed -i "s|GAME_PORT_PLACEHOLDER|$GAME_PORT|g" "$DATA_DIR/.env"
chmod 600 "$DATA_DIR/.env"
chown fivem:fivem "$DATA_DIR/.env"

# server.cfg
cat > "$DATA_DIR/server.cfg" << CFG
#============================================#
#        SindicatoRP - Configuração          #
#============================================#

endpoint_add_tcp "0.0.0.0:$GAME_PORT"
endpoint_add_udp "0.0.0.0:$GAME_PORT"
set mysql_connection_string "server=$DB_HOST;uid=$DB_USER;pwd=$DB_PASSWORD;database=$DB_NAME;port=3306"
sv_licenseKey "$SV_LICENSE_KEY"
set steam_webApiKey "$STEAM_WEB_API_KEY"
set txAdminPort 40120
set txAdmin-oneTimePIN 2336
set serverProfile "default"
set txAdminServerConfigPath "$DATA_DIR/server.cfg"
set txAdminPath "$TX_DIR"
set sv_assetValidationMode "disabled"
set sv_enforceGameBuild 0
sv_hostname "SindicatoRP"
sv_maxclients $SV_MAXCLIENTS

# Otimização — desabilita cache automático
set sv_projectCache ""
set cacheEnabled "false"
set sv_authMaxHopLevel 0

# Base resources
ensure mapmanager
ensure spawnmanager
ensure sessionmanager
ensure fivem
ensure baseevents
CFG

# resources.cfg
cat > "$DATA_DIR/resources.cfg" << RESCFG
# Resources carregados — gerado automaticamente
RESCFG

if [[ -d "$DATA_DIR/resources" ]]; then
    for dir in "$DATA_DIR/resources"/*/; do
        name=$(basename "$dir")
        [[ "$name" != _* ]] && echo "ensure $name" >> "$DATA_DIR/resources.cfg"
    done
fi

chown fivem:fivem "$DATA_DIR/server.cfg" "$DATA_DIR/resources.cfg"

#------------------------------------------
# PARTE 6: SYSTEMD SERVICES
#------------------------------------------
log "Criando serviços systemd..."

cat > /etc/systemd/system/fivem-server.service << 'SVC3'
[Unit]
Description=FiveM GTA RP Server
After=network.target
Documentation=https://docs.fivem.net/

[Service]
Type=simple
User=fivem
WorkingDirectory=/opt/fivem/server-data
EnvironmentFile=/opt/fivem/server-data/.env
ExecStartPre=/bin/sleep 2
ExecStart=/opt/fivem/run.sh \
    +set serverProfile default \
    +set txAdminPort 40120 \
    +set txAdmin-oneTimePIN 2336 \
    +set txAdminServerConfigPath /opt/fivem/server-data/server.cfg \
    +set mysql_connection_string "server=${DB_HOST};uid=${DB_USER};pwd=${DB_PASSWORD};database=${DB_NAME};port=${DB_PORT}" \
    +set sv_assetValidationMode disabled
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/fivem/server.log
StandardError=append:/var/log/fivem/server.log
LimitNOFILE=65536

ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
ReadWritePaths=/opt/fivem/txData
ReadWritePaths=/opt/fivem/server-data
ReadWritePaths=/var/log/fivem

[Install]
WantedBy=multi-user.target
SVC3

cat > /etc/systemd/system/fivem-mock-auth.service << 'SVC1'
[Unit]
Description=FiveM Mock Auth Server
After=network.target
PartOf=fivem-server.service

[Service]
Type=simple
User=fivem
WorkingDirectory=/opt/fivem
ExecStart=/usr/bin/node /opt/fivem/mock_auth.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
EnvironmentFile=/opt/fivem/server-data/.env
LimitNOFILE=65536

[Install]
WantedBy=fivem-server.service
SVC1

cat > /etc/systemd/system/fivem-dashboard.service << 'SVC2'
[Unit]
Description=FiveM Dashboard (Next.js)
After=network.target
PartOf=fivem-server.service

[Service]
Type=simple
User=fivem
WorkingDirectory=/opt/fivem/dashboard
ExecStartPre=/bin/sleep 3
ExecStart=/opt/fivem/dashboard/node_modules/.bin/next start -p 8081
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
EnvironmentFile=/opt/fivem/dashboard/.env

[Install]
WantedBy=fivem-server.service
SVC2

systemctl daemon-reload
log "Serviços systemd criados."

# sudoers para restart via dashboard
echo "fivem ALL=(ALL) NOPASSWD: /bin/systemctl restart fivem-server, /bin/systemctl stop fivem-server, /bin/systemctl start fivem-server" > /etc/sudoers.d/fivem
chmod 440 /etc/sudoers.d/fivem
log "Sudoers configurado."

#------------------------------------------
# PARTE 7: FIREWALL
#------------------------------------------
log "Configurando firewall..."
apt install -y ufw
ufw --force enable
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow $GAME_PORT/tcp
ufw allow $GAME_PORT/udp
ufw allow 40120/tcp
ufw allow from $DB_HOST to any port 3306
ufw reload
log "Firewall configurado."

#------------------------------------------
# PARTE 8: TESTE DE CONEXÃO COM DB
#------------------------------------------
log "Testando conexão com banco de dados..."
if mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --ssl-mode=DISABLED -e "SELECT 1;" 2>/dev/null; then
    log "Conexão com banco: OK"
else
    warn "Não foi possível conectar ao banco. Verifique bind-address e permissões."
fi

#------------------------------------------
# PARTE 9: DASHBOARD SETUP
#------------------------------------------
echo ""
read -p "Deseja configurar o Dashboard Next.js? (y/N): " SETUP_DASH
if [[ "$SETUP_DASH" =~ ^[Yy]$ ]]; then
    log "Configurando Dashboard..."

    if [[ -d "$DATA_DIR/dashboard" ]]; then
        cp -r "$DATA_DIR/dashboard" "$BASE_DIR/dashboard"
        if grep -q "output.*standalone" "$BASE_DIR/dashboard/next.config.js" 2>/dev/null; then
            sed -i "s/output: 'standalone',//" "$BASE_DIR/dashboard/next.config.js"
            sed -i "s/output: 'standalone'//" "$BASE_DIR/dashboard/next.config.js"
        fi
    else
        warn "Pasta dashboard não encontrada no repositório."
    fi

    if [[ -f "$BASE_DIR/dashboard/package.json" ]]; then
        cd "$BASE_DIR/dashboard"
        npm install --production 2>&1 | tail -3
        npm run build 2>&1 | tail -3

        cat > "$BASE_DIR/dashboard/.env" << 'ENVDASH'
PORT=8081
HOSTNAME=0.0.0.0
DASHBOARD_PASSWORD=CHANGE_ME_AFTER_INSTALL
GIT_REPO=GIT_REPO_PLACEHOLDER
GIT_TOKEN=GIT_TOKEN_PLACEHOLDER
DATA_DIR=/opt/fivem/server-data
DB_HOST=DB_HOST_PLACEHOLDER
DB_USER=DB_USER_PLACEHOLDER
DB_PASSWORD=DB_PASSWORD_PLACEHOLDER
DB_NAME=DB_NAME_PLACEHOLDER
DB_PORT=3306
ENVDASH

        sed -i "s|DB_HOST_PLACEHOLDER|$DB_HOST|g" "$BASE_DIR/dashboard/.env"
        sed -i "s|DB_USER_PLACEHOLDER|$DB_USER|g" "$BASE_DIR/dashboard/.env"
        sed -i "s|DB_PASSWORD_PLACEHOLDER|$DB_PASSWORD|g" "$BASE_DIR/dashboard/.env"
        sed -i "s|DB_NAME_PLACEHOLDER|$DB_NAME|g" "$BASE_DIR/dashboard/.env"
        sed -i "s|GIT_REPO_PLACEHOLDER|$GIT_REPO|g" "$BASE_DIR/dashboard/.env"
        sed -i "s|GIT_TOKEN_PLACEHOLDER|$GIT_TOKEN|g" "$BASE_DIR/dashboard/.env"
        sed -i "s|CHANGE_ME_AFTER_INSTALL|${DASHBOARD_PASSWORD:-CHANGE_ME_AFTER_INSTALL}|g" "$BASE_DIR/dashboard/.env"

        chmod 600 "$BASE_DIR/dashboard/.env"
        chown -R fivem:fivem "$BASE_DIR/dashboard"
        systemctl enable fivem-dashboard
        systemctl start fivem-dashboard
        log "Dashboard: enabled + started"
    fi
fi

#------------------------------------------
# PARTE 10: PROXY REVERSO (CADDY)
#------------------------------------------
log "Configurando Caddy..."
DASH_DOMAIN=${DASH_DOMAIN:-dash.$(hostname -d 2>/dev/null || echo "seuservidor.com")}
cat > /etc/caddy/Caddyfile << CADDYEOF
$DASH_DOMAIN {
    reverse_proxy localhost:8081
}
CADDYEOF
systemctl restart caddy
log "Caddy configurado."

#------------------------------------------
# PARTE 11: LIMPEZA AUTOMÁTICA
#------------------------------------------
log "Configurando limpeza automática..."
mkdir -p "$BASE_DIR/scripts"

cat > "$BASE_DIR/scripts/fivem-cleanup.sh" << 'CLEANUP'
#!/bin/bash
set -e
LOG_FILE="/var/log/fivem/cleanup.log"
DATA_DIR="/opt/fivem/server-data"
TX_DIR="/opt/fivem/txData"
LOG_DIR="/var/log/fivem"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "=== Iniciando limpeza ==="

journalctl --vacuum-time=3d 2>/dev/null && log "Journal limpo" || true
find "$LOG_DIR" -name "*.log" -mtime +5 -delete 2>/dev/null || true
[[ -d "$TX_DIR/cache" ]] && find "$TX_DIR/cache" -type f -mtime +1 -delete 2>/dev/null || true
[[ -d "$TX_DIR/data/cache" ]] && find "$TX_DIR/data/cache" -type f -mtime +1 -delete 2>/dev/null || true
find "$DATA_DIR" -name "core.*" -type f -delete 2>/dev/null || true
find "$TX_DIR" -name "tmp_*.json" -mtime +1 -delete 2>/dev/null || true

log "=== Limpeza concluída — disco: $(df -h "$DATA_DIR" | tail -1 | awk '{print $4}') ==="
CLEANUP

chmod +x "$BASE_DIR/scripts/fivem-cleanup.sh"

cat > /etc/systemd/system/fivem-cleanup.service << 'SVCCLN'
[Unit]
Description=FiveM Cleanup Script
[Service]
Type=oneshot
User=root
ExecStart=/opt/fivem/scripts/fivem-cleanup.sh
StandardOutput=journal
StandardError=journal
SVCCLN

cat > /etc/systemd/system/fivem-cleanup.timer << 'TIMER'
[Unit]
Description=FiveM Cleanup — toda segunda-feira às 03:00
[Timer]
OnCalendar=Mon *-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now fivem-cleanup.timer
log "Cleanup automático: enabled (segunda 03:00)"

#------------------------------------------
# FINALIZAÇÃO
#------------------------------------------
systemctl enable fivem-server

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Instalação concluída!${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo "Dados em:   /opt/fivem/server-data/  ← git clone direto (shallow)"
echo "Git sync:   /opt/fivem/server-data/sync.sh"
echo "Logs:      /var/log/fivem/"
echo ""
echo -e "${GREEN}PRÓXIMOS PASSOS:${NC}"
echo ""
echo "1. Reinicie: reboot"
echo "2. txAdmin:  http://$SERVER_IP:40120"
echo "3. Dashboard: https://$SERVER_IP:8081"
echo "4. Para sincronizar:  bash /opt/fivem/server-data/sync.sh"
echo "5. Para gerenciar:    fivemctl start|stop|restart|status|logs"
echo ""
echo -e "${YELLOW}IMPORTANTE: Altere a senha do dashboard!${NC}"
echo ""
