#!/usr/bin/env bash
#===============================================================================
# fivemserver — instalador de servidor FiveM com painel web
# https://github.com/faccodev/fivemserver
#
# Instalação (Ubuntu 22.04+/Debian 12+, x86_64, como root):
#
#   curl -fsSL https://raw.githubusercontent.com/faccodev/fivemserver/main/install.sh | sudo bash
#
# O instalador pergunta no terminal só o repositório de resources e o token
# do GitHub. Banco MariaDB local, usuários e senhas são criados sozinhos.
# Deixe o repositório em branco para configurar pelo navegador.
# Para instalar sem perguntas:
#
#   curl -fsSL https://raw.githubusercontent.com/faccodev/fivemserver/main/install.sh | sudo bash -s -- \
#     --repo https://github.com/voce/seu-servidor --token github_pat_xxx --license cfxk_xxx
#
# Opções:
#   --repo URL          repositório GitHub com server.cfg + resources/
#   --token TOKEN       token GitHub (só para repositório privado)
#   --branch NOME       branch (padrão: a padrão do repositório)
#   --password SENHA    senha do painel (padrão: gerada) — também é a do admin do txAdmin
#   --mode MODO         txadmin (padrão) | direct
#   --license CHAVE     license key cfxk_… (substitui a do server.cfg)
#   --steam-key CHAVE   Steam Web API key (opcional)
#   --max-clients N     slots do servidor (opcional; padrão: o do server.cfg)
#   --db-host/--db-port/--db-user/--db-pass/--db-name
#                       usar um MySQL externo em vez do MariaDB local (avançado)
#   --domain DOMINIO    configura HTTPS com Caddy para o painel
#   --title NOME        nome exibido no painel (padrão: FiveM Server)
#   --port PORTA        porta do painel (padrão: 8081)
#   --yes               não pergunta nada; sem --repo usa o assistente web
#
# Rodar de novo é seguro: atualiza o painel e mantém configuração e dados.
#===============================================================================
set -euo pipefail

PANEL_REPO="${PANEL_REPO:-https://github.com/faccodev/fivemserver}"
PANEL_BRANCH="${PANEL_BRANCH:-main}"

FIVEM_USER="fivem"
FIVEM_HOME="/home/fivem"
PANEL_DIR="$FIVEM_HOME/panel"
STATE_DIR="$FIVEM_HOME/.panel"
DASH_ENV="$STATE_DIR/dashboard.env"
LOG_DIR="/var/log/fivem"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}[aviso]${NC} $*"; }
die()  { echo -e "${RED}[erro]${NC} $*" >&2; exit 1; }
# Nenhuma falha silenciosa: mostra onde o script parou.
trap 'echo -e "${RED}[erro]${NC} falhou na linha $LINENO: $BASH_COMMAND" >&2' ERR

#------------------------------------------------------------------------------
# Opções
#------------------------------------------------------------------------------
REPO="" TOKEN="" BRANCH="" PASSWORD="" MODE="txadmin" LICENSE="" STEAM_KEY="" MAX_CLIENTS=""
DB_HOST="" DB_PORT="3306" DB_USER="" DB_PASS="" DB_NAME=""
DOMAIN="" TITLE="" PORT="" ASSUME_YES=0

need() { [[ $# -ge 2 && -n "$2" ]] || die "opção $1 precisa de um valor"; }
while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo)     need "$@"; REPO="$2"; shift 2 ;;
        --token)    need "$@"; TOKEN="$2"; shift 2 ;;
        --branch)   need "$@"; BRANCH="$2"; shift 2 ;;
        --password) need "$@"; PASSWORD="$2"; shift 2 ;;
        --mode)     need "$@"; MODE="$2"; shift 2 ;;
        --license)  need "$@"; LICENSE="$2"; shift 2 ;;
        --steam-key) need "$@"; STEAM_KEY="$2"; shift 2 ;;
        --max-clients) need "$@"; MAX_CLIENTS="$2"; shift 2 ;;
        --db-host)  need "$@"; DB_HOST="$2"; shift 2 ;;
        --db-port)  need "$@"; DB_PORT="$2"; shift 2 ;;
        --db-user)  need "$@"; DB_USER="$2"; shift 2 ;;
        --db-pass)  need "$@"; DB_PASS="$2"; shift 2 ;;
        --db-name)  need "$@"; DB_NAME="$2"; shift 2 ;;
        --domain)   need "$@"; DOMAIN="$2"; shift 2 ;;
        --title)    need "$@"; TITLE="$2"; shift 2 ;;
        --port)     need "$@"; PORT="$2"; shift 2 ;;
        --yes|-y)   ASSUME_YES=1; shift ;;
        -h|--help)  sed -n '2,35p' "$0" 2>/dev/null || true; exit 0 ;;
        *)          die "opção desconhecida: $1 (use --help)" ;;
    esac
done
[[ "$MODE" == "txadmin" || "$MODE" == "direct" ]] || die "--mode deve ser txadmin ou direct"

#------------------------------------------------------------------------------
# Verificações
#------------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "execute como root: curl … | sudo bash"
command -v apt-get >/dev/null || die "suportado apenas em Debian/Ubuntu"
[[ "$(uname -m)" == "x86_64" ]] || die "o FXServer para Linux só existe para x86_64"

# Perguntas vão para o terminal mesmo quando o script chega por pipe (curl | bash).
TTY=""
if [[ $ASSUME_YES -eq 0 ]] && { : </dev/tty; } 2>/dev/null; then TTY=/dev/tty; fi
ask() {        # ask VAR "pergunta" [padrão]
    local __v; read -r -p "$2" __v <"$TTY"; printf -v "$1" '%s' "${__v:-${3:-}}"
}
ask_secret() { # ask_secret VAR "pergunta"
    local __v; read -r -s -p "$2" __v <"$TTY"; echo >"$TTY"; printf -v "$1" '%s' "$__v"
}

# Reinstalação: mantém porta e título já configurados.
env_get() {
    [[ -f "$DASH_ENV" ]] || return 0
    sed -n "s/^$1=\"\(.*\)\"$/\1/p" "$DASH_ENV" | sed 's/\\"/"/g; s/\\\\/\\/g'
}
PORT="${PORT:-$(env_get PORT)}"; PORT="${PORT:-8081}"
TITLE="${TITLE:-$(env_get PANEL_TITLE)}"; TITLE="${TITLE:-FiveM Server}"
ALREADY_CONFIGURED=0
[[ -n "$(env_get DASHBOARD_PASSWORD)" ]] && ALREADY_CONFIGURED=1

echo -e "\n${CYAN}${BOLD}fivemserver${NC} — servidor FiveM + painel web\n"

if ss -tlnH "sport = :$PORT" 2>/dev/null | grep -q . && ! systemctl is-active --quiet fivem-dashboard; then
    die "a porta $PORT já está em uso por outro processo. Use --port OUTRA."
fi

#------------------------------------------------------------------------------
# Perguntas (antes de instalar, para o resto rodar sem interrupção)
#------------------------------------------------------------------------------
if [[ -n "$TTY" && -z "$REPO" && $ALREADY_CONFIGURED -eq 0 ]]; then
    echo "Configuração do servidor. Deixe o repositório em branco para configurar depois pelo navegador."
    echo
    ask REPO "Repositório dos resources (https://github.com/usuario/repo): "
    if [[ -n "$REPO" ]]; then
        ask_secret TOKEN "Token do GitHub (Enter se o repositório for público): "
        ask BRANCH "Branch (Enter = padrão do repositório): "
        ask LICENSE "License key cfxk_… de portal.cfx.re (Enter = usar a do server.cfg): "
        ask STEAM_KEY "Steam Web API key (Enter = pular): "
        ask MAX_CLIENTS "Slots do servidor (Enter = usar o do server.cfg): "
        ask _mode "Usar txAdmin? [S/n]: " "s"
        [[ "$_mode" =~ ^[Nn] ]] && MODE="direct"
        ask_secret PASSWORD "Senha do painel (Enter = gerar automaticamente): "
    fi
    echo
fi

if [[ -n "$REPO" ]]; then
    [[ -z "$PASSWORD" || ${#PASSWORD} -ge 8 ]] || die "a senha do painel precisa ter pelo menos 8 caracteres"
    [[ -z "$MAX_CLIENTS" || "$MAX_CLIENTS" =~ ^[0-9]+$ ]] || die "--max-clients deve ser um número"
    [[ -z "$LICENSE" || "$LICENSE" =~ ^cfxk_[A-Za-z0-9_]+$ ]] || die "license key deve começar com cfxk_"
    [[ -z "$DB_HOST" || ( -n "$DB_USER" && -n "$DB_NAME" ) ]] || die "banco: informe pelo menos host, usuário e nome"

    # Normaliza e valida o acesso antes de instalar qualquer coisa.
    REPO="${REPO%/}"; REPO="${REPO%.git}"
    [[ "$REPO" =~ ^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$ ]] \
        || die "repositório deve ser https://github.com/usuario/repo"
    SLUG="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    REPO_INFO="$(mktemp)"
    auth=(); [[ -n "$TOKEN" ]] && auth=(-H "Authorization: Bearer $TOKEN")
    code="$(curl -s -o "$REPO_INFO" -w '%{http_code}' "${auth[@]}" -H 'User-Agent: fivemserver' "https://api.github.com/repos/$SLUG")"
    case "$code" in
        200) ;;
        401) rm -f "$REPO_INFO"; die "token do GitHub inválido ou expirado" ;;
        404) rm -f "$REPO_INFO"; die "repositório $SLUG não encontrado ou sem acesso (privado? informe --token)" ;;
        *)   rm -f "$REPO_INFO"; die "GitHub respondeu HTTP $code ao consultar $SLUG" ;;
    esac
    if [[ -z "$BRANCH" ]]; then
        BRANCH="$(sed -n 's/.*"default_branch": *"\([^"]*\)".*/\1/p' "$REPO_INFO" | head -1)"
    fi
    rm -f "$REPO_INFO"
    log "Repositório OK: $SLUG ($BRANCH)"
fi

#------------------------------------------------------------------------------
# 1. Pacotes
#------------------------------------------------------------------------------
log "Instalando dependências do sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git rsync tar xz-utils screen \
    mariadb-client apache2-utils openssl logrotate >/dev/null
if [[ -z "$DB_HOST" ]]; then
    apt-get install -y -qq mariadb-server >/dev/null
    systemctl enable --now mariadb >/dev/null 2>&1
fi

NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
    log "Instalando Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi

#------------------------------------------------------------------------------
# 2. Usuário e pastas
#------------------------------------------------------------------------------
id "$FIVEM_USER" &>/dev/null || useradd -m -s /bin/bash "$FIVEM_USER"
usermod -aG systemd-journal "$FIVEM_USER" 2>/dev/null || true
install -d -o "$FIVEM_USER" -g "$FIVEM_USER" \
    "$FIVEM_HOME/server" "$FIVEM_HOME/server-data" "$FIVEM_HOME/txData" "$FIVEM_HOME/backups" "$LOG_DIR"
install -d -m 700 -o "$FIVEM_USER" -g "$FIVEM_USER" "$STATE_DIR"

#------------------------------------------------------------------------------
# 3. Código do painel
#------------------------------------------------------------------------------
SCRIPT_DIR=""
[[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]] && SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/dashboard/package.json" && "$SCRIPT_DIR" != "$PANEL_DIR" ]]; then
    log "Copiando painel de $SCRIPT_DIR..."
    rsync -a --delete --exclude node_modules --exclude .next --exclude .git "$SCRIPT_DIR/" "$PANEL_DIR/"
elif [[ -d "$PANEL_DIR/.git" ]]; then
    log "Atualizando painel..."
    sudo -u "$FIVEM_USER" git -C "$PANEL_DIR" fetch -q --depth 1 origin "$PANEL_BRANCH"
    sudo -u "$FIVEM_USER" git -C "$PANEL_DIR" reset -q --hard FETCH_HEAD
else
    log "Baixando painel..."
    rm -rf "$PANEL_DIR"
    git clone -q --depth 1 --branch "$PANEL_BRANCH" "$PANEL_REPO" "$PANEL_DIR"
fi
chown -R "$FIVEM_USER:$FIVEM_USER" "$PANEL_DIR"
chmod +x "$PANEL_DIR"/installer/*.sh

log "Compilando o painel (leva alguns minutos)..."
BUILD_LOG="$STATE_DIR/build.log"
sudo -u "$FIVEM_USER" -H bash -c "cd '$PANEL_DIR/dashboard' && npm ci --no-audit --no-fund --loglevel=error && npm run build" >"$BUILD_LOG" 2>&1 \
    || { tail -n 30 "$BUILD_LOG"; die "build do painel falhou — log completo em $BUILD_LOG"; }

#------------------------------------------------------------------------------
# 4. Configuração do painel
#------------------------------------------------------------------------------
# systemd EnvironmentFile: KEY="valor" com \ e " escapados (mesmo formato do painel).
env_set() {
    local key="$1" val="$2" tmp
    val="${val//\\/\\\\}"; val="${val//\"/\\\"}"
    tmp="$(mktemp)"
    grep -v "^$key=" "$DASH_ENV" > "$tmp" 2>/dev/null || true
    printf '%s="%s"\n' "$key" "$val" >> "$tmp"
    install -m 600 -o "$FIVEM_USER" -g "$FIVEM_USER" "$tmp" "$DASH_ENV"
    rm -f "$tmp"
}
env_del() { if [[ -f "$DASH_ENV" ]]; then sed -i "/^$1=/d" "$DASH_ENV"; fi; }

[[ -f "$DASH_ENV" ]] || install -m 600 -o "$FIVEM_USER" -g "$FIVEM_USER" /dev/null "$DASH_ENV"
env_set PORT "$PORT"
env_set PANEL_TITLE "$TITLE"
env_set DATA_DIR "$FIVEM_HOME/server-data"
env_set PANEL_DIR "$PANEL_DIR"
[[ -n "$(env_get JWT_SECRET)" ]] || env_set JWT_SECRET "$(openssl rand -hex 32)"

#--- Banco de dados --------------------------------------------------------------
# Padrão: MariaDB local com banco/usuário/senha gerados. Reinstalar reaproveita
# as credenciais do dashboard.env; --db-host usa um banco externo.
DB_CREATED=0
if [[ -z "$DB_HOST" && -n "$(env_get DB_HOST)" && "$(env_get DB_HOST)" != "127.0.0.1" ]]; then
    # Instalação anterior configurada com banco externo: mantém.
    DB_HOST="$(env_get DB_HOST)"; DB_PORT="$(env_get DB_PORT)"; DB_USER="$(env_get DB_USER)"
    DB_PASS="$(env_get DB_PASSWORD)"; DB_NAME="$(env_get DB_NAME)"
elif [[ -z "$DB_HOST" ]]; then
    DB_HOST="127.0.0.1"; DB_PORT="3306"
    DB_NAME="$(env_get DB_NAME)"; DB_NAME="${DB_NAME:-fivem}"
    DB_USER="$(env_get DB_USER)"; DB_USER="${DB_USER:-fivem}"
    DB_PASS="$(env_get DB_PASSWORD)"
    if [[ -z "$DB_PASS" ]]; then DB_PASS="$(openssl rand -hex 16)"; DB_CREATED=1; fi
    log "Preparando banco MariaDB local ($DB_NAME)..."
    # root acessa pelo socket local; a senha gerada é hex, segura dentro das aspas SQL.
    mariadb -uroot <<SQL || die "não consegui criar o banco no MariaDB"
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
fi
env_set DB_HOST "$DB_HOST"; env_set DB_PORT "$DB_PORT"; env_set DB_USER "$DB_USER"
env_set DB_PASSWORD "$DB_PASS"; env_set DB_NAME "$DB_NAME"

#--- Servidor ----------------------------------------------------------------------
GENERATED_PASSWORD=""
SETUP_TOKEN="$(env_get SETUP_TOKEN)"
if [[ -n "$REPO" ]]; then
    PASSWORD="${PASSWORD:-$(env_get DASHBOARD_PASSWORD)}"
    if [[ -z "$PASSWORD" ]]; then
        PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
        GENERATED_PASSWORD="$PASSWORD"
    fi
    env_set DASHBOARD_PASSWORD "$PASSWORD"
    env_set GIT_REPO "$REPO"
    env_set GIT_BRANCH "$BRANCH"
    env_set GIT_TOKEN "$TOKEN"
    env_set SERVER_MODE "$MODE"
    if [[ -n "$LICENSE" ]]; then env_set SV_LICENSEKEY "$LICENSE"; fi
    if [[ -n "$STEAM_KEY" ]]; then env_set STEAM_WEB_API_KEY "$STEAM_KEY"; fi
    if [[ -n "$MAX_CLIENTS" ]]; then env_set SV_MAXCLIENTS "$MAX_CLIENTS"; fi
    env_del SETUP_TOKEN
    SETUP_TOKEN=""
elif [[ $ALREADY_CONFIGURED -eq 0 && -z "$SETUP_TOKEN" ]]; then
    SETUP_TOKEN="$(openssl rand -hex 16)"
    env_set SETUP_TOKEN "$SETUP_TOKEN"
fi

#------------------------------------------------------------------------------
# 5. Serviços
#------------------------------------------------------------------------------
log "Configurando serviços..."
cat > /etc/systemd/system/fivem-dashboard.service <<EOF
[Unit]
Description=fivemserver — painel web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$FIVEM_USER
WorkingDirectory=$PANEL_DIR/dashboard
EnvironmentFile=$DASH_ENV
Environment=NODE_ENV=production
ExecStart=$PANEL_DIR/dashboard/node_modules/.bin/next start -p \${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/fivem-server.service <<EOF
[Unit]
Description=fivemserver — FiveM (FXServer)
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

# O painel roda como fivem e só controla estes serviços.
SYSTEMCTL="$(command -v systemctl)"
cat > /etc/sudoers.d/fivemserver <<EOF
$FIVEM_USER ALL=(root) NOPASSWD: $SYSTEMCTL start fivem-server, $SYSTEMCTL stop fivem-server, $SYSTEMCTL restart fivem-server, $SYSTEMCTL enable fivem-server, $SYSTEMCTL --no-block restart fivem-dashboard
EOF
chmod 440 /etc/sudoers.d/fivemserver
visudo -cf /etc/sudoers.d/fivemserver >/dev/null || { rm -f /etc/sudoers.d/fivemserver; die "sudoers inválido"; }

# Rotação do log do servidor
cat > /etc/logrotate.d/fivemserver <<EOF
$LOG_DIR/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    copytruncate
}
EOF

systemctl daemon-reload
systemctl enable fivem-dashboard >/dev/null 2>&1

#------------------------------------------------------------------------------
# 6. Firewall (só se o ufw já estiver ativo) e HTTPS opcional
#------------------------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    log "Liberando portas no ufw..."
    for rule in 22/tcp 80/tcp 443/tcp "$PORT/tcp" 30120/tcp 30120/udp 40120/tcp; do ufw allow "$rule" >/dev/null; done
fi

if [[ -n "$DOMAIN" ]]; then
    log "Configurando HTTPS (Caddy) para $DOMAIN..."
    if ! command -v caddy >/dev/null; then
        apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
        curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update -qq && apt-get install -y -qq caddy >/dev/null
    fi
    grep -q "^$DOMAIN " /etc/caddy/Caddyfile 2>/dev/null \
        || printf '\n%s {\n    reverse_proxy localhost:%s\n}\n' "$DOMAIN" "$PORT" >> /etc/caddy/Caddyfile
    systemctl enable --now caddy >/dev/null 2>&1
    systemctl reload caddy
fi

#------------------------------------------------------------------------------
# 7. Servidor FiveM (quando configurado pelo terminal)
#------------------------------------------------------------------------------
if [[ -n "$REPO" ]]; then
    TXADMIN_ACCOUNT=""
    if [[ "$MODE" == "txadmin" ]]; then
        hash="$(printf '%s' "$PASSWORD" | htpasswd -niBC 10 admin | cut -d: -f2)"
        TXADMIN_ACCOUNT="admin::${hash/#\$2y\$/\$2a\$}"
    fi
    enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
    MYSQL="mysql://$(enc "$DB_USER"):$(enc "$DB_PASS")@$DB_HOST:$DB_PORT/$(enc "$DB_NAME")?charset=utf8mb4"
    log "Instalando o servidor FiveM..."
    sudo -u "$FIVEM_USER" -H env \
        GIT_REPO="$REPO" GIT_BRANCH="$BRANCH" GIT_TOKEN="$TOKEN" SERVER_MODE="$MODE" \
        SV_LICENSEKEY="${LICENSE:-$(env_get SV_LICENSEKEY)}" \
        STEAM_WEB_API_KEY="${STEAM_KEY:-$(env_get STEAM_WEB_API_KEY)}" \
        SV_MAXCLIENTS="${MAX_CLIENTS:-$(env_get SV_MAXCLIENTS)}" \
        MYSQL_CONNECTION_STRING="$MYSQL" TXADMIN_ACCOUNT="$TXADMIN_ACCOUNT" \
        DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASS" DB_NAME="$DB_NAME" \
        bash "$PANEL_DIR/installer/provision.sh" 2>&1 | tee "$STATE_DIR/provision.log" \
        || die "instalação do servidor falhou — veja $STATE_DIR/provision.log"
fi

systemctl restart fivem-dashboard

#------------------------------------------------------------------------------
# Pronto
#------------------------------------------------------------------------------
for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || warn "o painel ainda não respondeu: journalctl -u fivem-dashboard -n 50"

PUBLIC_IP="$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
BASE_URL="http://$PUBLIC_IP:$PORT"
[[ -n "$DOMAIN" ]] && BASE_URL="https://$DOMAIN"

# Credenciais num arquivo só do root, para consulta depois.
CRED_FILE=/root/fivemserver-credenciais.txt
{
    echo "# fivemserver — credenciais geradas em $(date '+%F %T')"
    echo "Painel:        $BASE_URL"
    if [[ -n "$(env_get DASHBOARD_PASSWORD)" ]]; then echo "Senha painel:  $(env_get DASHBOARD_PASSWORD)  (txAdmin: usuário admin, mesma senha)"; fi
    echo "MySQL host:    $DB_HOST:$DB_PORT"
    echo "MySQL banco:   $DB_NAME"
    echo "MySQL usuário: $DB_USER"
    echo "MySQL senha:   $DB_PASS"
    echo "Config:        $DASH_ENV"
} > "$CRED_FILE"
chmod 600 "$CRED_FILE"

echo -e "\n${CYAN}${BOLD}Pronto!${NC}\n"
if [[ -n "$SETUP_TOKEN" ]]; then
    echo "Termine a instalação no navegador:"
    echo -e "  ${GREEN}${BOLD}$BASE_URL/setup?token=$SETUP_TOKEN${NC}"
    echo "  (este link dá acesso total ao painel até a instalação terminar — não compartilhe)"
else
    echo -e "Painel:   ${GREEN}${BOLD}$BASE_URL${NC}"
    if [[ -n "$GENERATED_PASSWORD" ]]; then
        echo -e "Senha:    ${YELLOW}${BOLD}$GENERATED_PASSWORD${NC}  (gerada — anote)"
    fi
    if [[ -n "$REPO" && "$MODE" == "txadmin" ]]; then
        echo -e "txAdmin:  ${GREEN}http://$PUBLIC_IP:40120${NC}  (usuário admin, mesma senha do painel)"
        echo "          No primeiro acesso escolha 'Existing Server Data' com os caminhos mostrados acima."
    fi
    echo -e "FiveM:    connect $PUBLIC_IP:30120"
fi
echo
echo "Banco MariaDB: $DB_NAME em $DB_HOST (usuário $DB_USER)."
echo "Todas as credenciais: sudo cat $CRED_FILE"
echo
