#!/usr/bin/env bash
#===============================================================================
# SindicatoRP — Instalador do Painel (bootstrap)
#
# Prepara um servidor Ubuntu/Debian limpo e sobe o dashboard em modo de
# instalação. O resto (repositório de resources, token, artefatos FiveM,
# serviço do servidor) é feito pelo assistente web em /setup.
#
# Uso (a partir de um clone deste repositório):
#   sudo bash install.sh
#
# Uso direto (repositório privado → precisa de token com acesso a ele):
#   curl -fsSL -H "Authorization: token ghp_xxx" \
#     https://raw.githubusercontent.com/faccodev/sindicato_dashboard/main/install.sh \
#     | sudo GITHUB_TOKEN=ghp_xxx bash
#
# Rodar de novo é seguro: atualiza o código do painel, refaz o build e
# reinicia o dashboard sem apagar configuração nem dados.
#
# Variáveis opcionais:
#   GITHUB_TOKEN   token para clonar o repositório do painel (se for privado)
#   PANEL_REPO     repo do painel   (padrão: https://github.com/faccodev/sindicato_dashboard)
#   PANEL_BRANCH   branch do painel (padrão: main)
#   PANEL_PORT     porta do dashboard (padrão: 8081)
#   DASH_DOMAIN    se definido, configura Caddy com HTTPS para esse domínio
#===============================================================================
set -euo pipefail

PANEL_REPO="${PANEL_REPO:-https://github.com/faccodev/sindicato_dashboard}"
PANEL_BRANCH="${PANEL_BRANCH:-main}"
PANEL_PORT="${PANEL_PORT:-8081}"
DASH_DOMAIN="${DASH_DOMAIN:-}"

FIVEM_USER="fivem"
FIVEM_HOME="/home/fivem"
PANEL_DIR="$FIVEM_HOME/panel"          # código do painel (este repo)
STATE_DIR="$FIVEM_HOME/.panel"         # config e estado (fora do git)
LOG_DIR="/var/log/fivem"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()  { echo -e "${RED}[ERRO]${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Execute como root (sudo bash install.sh)."
command -v apt-get >/dev/null || die "Este instalador suporta apenas Debian/Ubuntu."
[[ "$(uname -m)" == "x86_64" ]] || die "FXServer para Linux só existe para x86_64."

echo -e "\n${CYAN}== SindicatoRP — instalação do painel ==${NC}\n"

# Se o painel já roda fora do systemd (instalação manual antiga), não brigamos pela porta.
if ss -tlnH "sport = :$PANEL_PORT" 2>/dev/null | grep -q . && ! systemctl is-active --quiet fivem-dashboard; then
    die "A porta $PANEL_PORT já está em uso por um processo fora do serviço fivem-dashboard.
       Pare esse processo (ou use PANEL_PORT=outra) e rode de novo."
fi

#------------------------------------------------------------------------------
# 1. Pacotes do sistema
#------------------------------------------------------------------------------
log "Instalando dependências do sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    ca-certificates curl git rsync tar xz-utils screen \
    mariadb-client apache2-utils openssl >/dev/null

NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
    log "Instalando Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node -v) / npm $(npm -v)"

#------------------------------------------------------------------------------
# 2. Usuário e diretórios
#------------------------------------------------------------------------------
if ! id "$FIVEM_USER" &>/dev/null; then
    log "Criando usuário $FIVEM_USER..."
    useradd -m -s /bin/bash "$FIVEM_USER"
fi
# Leitura do journal (logs do serviço) sem root
usermod -aG systemd-journal "$FIVEM_USER" 2>/dev/null || true

install -d -o "$FIVEM_USER" -g "$FIVEM_USER" \
    "$FIVEM_HOME/server" "$FIVEM_HOME/server-data" "$FIVEM_HOME/txData" "$LOG_DIR"
install -d -m 700 -o "$FIVEM_USER" -g "$FIVEM_USER" "$STATE_DIR"

#------------------------------------------------------------------------------
# 3. Código do painel
#------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/dashboard/package.json" && "$SCRIPT_DIR" != "$PANEL_DIR" ]]; then
    log "Copiando painel de $SCRIPT_DIR..."
    rsync -a --delete \
        --exclude node_modules --exclude .next --exclude .git \
        "$SCRIPT_DIR/" "$PANEL_DIR/"
elif [[ -d "$PANEL_DIR/.git" ]]; then
    log "Atualizando painel ($PANEL_BRANCH)..."
    auth_args=()
    [[ -n "${GITHUB_TOKEN:-}" ]] && auth_args=(-c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
    sudo -u "$FIVEM_USER" git "${auth_args[@]}" -C "$PANEL_DIR" fetch --depth 1 origin "$PANEL_BRANCH"
    sudo -u "$FIVEM_USER" git -C "$PANEL_DIR" reset --hard FETCH_HEAD
else
    if [[ -z "${GITHUB_TOKEN:-}" && -r /dev/tty ]]; then
        read -r -s -p "Token do GitHub com acesso a $PANEL_REPO (Enter se for público): " GITHUB_TOKEN </dev/tty
        echo
    fi
    log "Clonando painel de $PANEL_REPO..."
    auth_args=()
    [[ -n "${GITHUB_TOKEN:-}" ]] && auth_args=(-c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
    rm -rf "$PANEL_DIR"
    # O token vai só no header desta chamada; não fica gravado em .git/config.
    git "${auth_args[@]}" clone --depth 1 --branch "$PANEL_BRANCH" "$PANEL_REPO" "$PANEL_DIR" \
        || die "Falha ao clonar $PANEL_REPO. Repositório privado? Passe GITHUB_TOKEN."
fi
chown -R "$FIVEM_USER:$FIVEM_USER" "$PANEL_DIR"
chmod +x "$PANEL_DIR"/installer/*.sh

log "Instalando dependências e compilando o dashboard (pode levar alguns minutos)..."
sudo -u "$FIVEM_USER" -H bash -c "cd '$PANEL_DIR/dashboard' && npm ci --no-audit --no-fund --loglevel=error && npm run build" \
    || die "Build do dashboard falhou."

#------------------------------------------------------------------------------
# 4. Configuração do painel (preservada entre execuções)
#------------------------------------------------------------------------------
DASH_ENV="$STATE_DIR/dashboard.env"
SETUP_TOKEN=""
if [[ ! -f "$DASH_ENV" ]]; then
    SETUP_TOKEN="$(openssl rand -hex 16)"
    cat > "$DASH_ENV" <<EOF
# Gerado pelo instalador. Editado pelo assistente /setup.
PORT="$PANEL_PORT"
DATA_DIR="$FIVEM_HOME/server-data"
PANEL_DIR="$PANEL_DIR"
SETUP_TOKEN="$SETUP_TOKEN"
EOF
    chown "$FIVEM_USER:$FIVEM_USER" "$DASH_ENV"
    chmod 600 "$DASH_ENV"
else
    SETUP_TOKEN="$(sed -n 's/^SETUP_TOKEN="\(.*\)"$/\1/p' "$DASH_ENV")"
fi

#------------------------------------------------------------------------------
# 5. Serviços systemd
#------------------------------------------------------------------------------
log "Criando serviços systemd..."
cat > /etc/systemd/system/fivem-dashboard.service <<EOF
[Unit]
Description=SindicatoRP Dashboard (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$FIVEM_USER
WorkingDirectory=$PANEL_DIR/dashboard
EnvironmentFile=$STATE_DIR/dashboard.env
Environment=NODE_ENV=production
ExecStart=$PANEL_DIR/dashboard/node_modules/.bin/next start -p \${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# O servidor só é habilitado pelo provision.sh, depois que o repositório e o
# server.cfg existirem.
cat > /etc/systemd/system/fivem-server.service <<EOF
[Unit]
Description=SindicatoRP FiveM Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$FIVEM_USER
EnvironmentFile=$STATE_DIR/server.env
ExecStart=$PANEL_DIR/installer/start-server.sh
Restart=on-failure
RestartSec=10
LimitNOFILE=65536
StandardOutput=append:$LOG_DIR/server.log
StandardError=append:$LOG_DIR/server.log

[Install]
WantedBy=multi-user.target
EOF
[[ -f "$STATE_DIR/server.env" ]] || install -m 600 -o "$FIVEM_USER" -g "$FIVEM_USER" /dev/null "$STATE_DIR/server.env"

# O painel roda como fivem e só pode controlar estes dois serviços.
SYSTEMCTL="$(command -v systemctl)"
cat > /etc/sudoers.d/fivem-panel <<EOF
$FIVEM_USER ALL=(root) NOPASSWD: $SYSTEMCTL start fivem-server, $SYSTEMCTL stop fivem-server, $SYSTEMCTL restart fivem-server, $SYSTEMCTL enable fivem-server, $SYSTEMCTL enable --now fivem-server, $SYSTEMCTL --no-block restart fivem-dashboard
EOF
chmod 440 /etc/sudoers.d/fivem-panel
visudo -cf /etc/sudoers.d/fivem-panel >/dev/null || { rm -f /etc/sudoers.d/fivem-panel; die "sudoers inválido."; }

systemctl daemon-reload
systemctl enable fivem-dashboard >/dev/null 2>&1
systemctl restart fivem-dashboard

#------------------------------------------------------------------------------
# 6. Firewall (só mexe se o ufw já estiver ativo) e Caddy opcional
#------------------------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    log "Liberando portas no ufw..."
    for rule in 22/tcp 80/tcp 443/tcp "$PANEL_PORT/tcp" 30120/tcp 30120/udp 40120/tcp; do
        ufw allow "$rule" >/dev/null
    done
fi

if [[ -n "$DASH_DOMAIN" ]]; then
    log "Configurando Caddy para $DASH_DOMAIN..."
    if ! command -v caddy >/dev/null; then
        apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
        curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update -qq && apt-get install -y -qq caddy >/dev/null
    fi
    if ! grep -q "^$DASH_DOMAIN " /etc/caddy/Caddyfile 2>/dev/null; then
        printf '\n%s {\n    reverse_proxy localhost:%s\n}\n' "$DASH_DOMAIN" "$PANEL_PORT" >> /etc/caddy/Caddyfile
    fi
    systemctl enable --now caddy >/dev/null 2>&1
    systemctl reload caddy
fi

#------------------------------------------------------------------------------
# 7. Pronto
#------------------------------------------------------------------------------
log "Aguardando o dashboard subir..."
for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PANEL_PORT/" && break
    sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$PANEL_PORT/" || warn "Dashboard ainda não respondeu. Veja: journalctl -u fivem-dashboard -n 50"

PUBLIC_IP="$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
BASE_URL="http://$PUBLIC_IP:$PANEL_PORT"
[[ -n "$DASH_DOMAIN" ]] && BASE_URL="https://$DASH_DOMAIN"

echo -e "\n${CYAN}== Painel instalado ==${NC}\n"
if [[ -n "$SETUP_TOKEN" ]]; then
    echo "Abra o assistente para terminar a instalação:"
    echo -e "  ${GREEN}$BASE_URL/setup?token=$SETUP_TOKEN${NC}"
    echo
    echo "Esse link é a única forma de acessar o assistente. Não compartilhe."
else
    echo "Painel já configurado; código atualizado e reiniciado."
    echo -e "  ${GREEN}$BASE_URL${NC}"
fi
echo
