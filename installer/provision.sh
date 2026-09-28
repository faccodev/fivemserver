#!/usr/bin/env bash
#===============================================================================
# Provisionamento do servidor FiveM — roda como usuário fivem.
# Chamado pelo assistente /setup do dashboard, mas também pode ser rodado à mão:
#
#   sudo -u fivem env GIT_REPO=... GIT_TOKEN=... bash installer/provision.sh
#
# Entrada (variáveis de ambiente):
#   GIT_REPO        https://github.com/dono/repo  (obrigatório)
#   GIT_BRANCH      branch (padrão: main)
#   GIT_TOKEN       token com leitura do repo (obrigatório se privado)
#   SERVER_MODE     txadmin | direct (padrão: txadmin)
#   SV_LICENSEKEY   cfxk_... (opcional; sobrescreve o do server.cfg)
#   MYSQL_CONNECTION_STRING (opcional; sobrescreve o do server.cfg)
#   STEAM_WEB_API_KEY, SV_MAXCLIENTS (opcionais; sobrescrevem o server.cfg)
#   DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME  banco para importar o .sql
#                   do repositório quando ele estiver vazio (opcional)
#   TXADMIN_ACCOUNT usuário:fivemId:bcrypt — conta master do txAdmin (opcional)
#   RESTART_DASHBOARD=1  reinicia o dashboard no final (usado pelo /setup)
#
# Progresso: stdout (o /setup grava em ~/.panel/provision.log) e o estado
# final em ~/.panel/provision.state (running | done | failed).
#===============================================================================
set -euo pipefail

FIVEM_HOME="${FIVEM_HOME:-/home/fivem}"
STATE_DIR="$FIVEM_HOME/.panel"
DATA_DIR="${DATA_DIR:-$FIVEM_HOME/server-data}"
FIVEM_DIR="$FIVEM_HOME/server"
TXDATA_DIR="$FIVEM_HOME/txData"
STATE_FILE="$STATE_DIR/provision.state"
PANEL_CFG="$STATE_DIR/panel.cfg"
SERVER_ENV="$STATE_DIR/server.env"
ARTIFACTS_API="https://changelogs-live.fivem.net/api/changelog/versions/linux/server"

GIT_BRANCH="${GIT_BRANCH:-main}"
SERVER_MODE="${SERVER_MODE:-txadmin}"

step() { echo; echo "==> $*"; }
fail() { echo "ERRO: $*" >&2; echo failed > "$STATE_FILE"; exit 1; }
trap 'echo failed > "$STATE_FILE"' ERR

[[ "$(id -un)" == "fivem" ]] || fail "rode como usuário fivem (sudo -u fivem ...)"
[[ -n "${GIT_REPO:-}" ]] || fail "GIT_REPO não informado"
echo running > "$STATE_FILE"

# systemd EnvironmentFile: KEY="valor" com \ e " escapados, sem expansão de $.
env_line() {
    local v="${2//\\/\\\\}"
    v="${v//\"/\\\"}"
    printf '%s="%s"\n' "$1" "$v"
}
# Token só via header desta execução; nunca gravado em .git/config.
# GIT_TERMINAL_PROMPT=0: sem token válido o git falha na hora em vez de
# esperar por um usuário/senha que ninguém vai digitar.
git_auth() {
    if [[ -n "${GIT_TOKEN:-}" ]]; then
        GIT_TERMINAL_PROMPT=0 \
        GIT_CONFIG_COUNT=1 \
        GIT_CONFIG_KEY_0="http.https://github.com/.extraHeader" \
        GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$GIT_TOKEN" | base64 -w0)" \
        git "$@"
    else
        GIT_TERMINAL_PROMPT=0 git "$@"
    fi
}
# Progresso do git legível no log: % do download a cada 5%, demais etapas só
# quando terminam. fflush() porque o mawk (awk do Ubuntu) bufferiza em arquivo.
git_progress() {
    tr '\r' '\n' | awk '
        /^[[:space:]]*$/ { next }
        /Receiving objects:/ {
            if (match($0, /[0-9]+%/)) {
                p = substr($0, RSTART, RLENGTH - 1) + 0
                if (p >= last + 5 || p == 100) { print; fflush(); last = p }
            }
            next
        }
        /^(remote: )?(Enumerating|Counting|Compressing|Resolving|Updating|Checking out)/ {
            if ($0 ~ /done/) { print; fflush() }
            next
        }
        { print; fflush() }'
}

#------------------------------------------------------------------------------
step "1/6 Repositório de resources ($GIT_REPO @ $GIT_BRANCH)"
#------------------------------------------------------------------------------
REPO_URL="${GIT_REPO%.git}.git"
# Onde o git vive: a própria server-data ou, quando o repositório é a pasta
# resources em si (ver passo 2), server-data/resources.
REPO_DIR="$DATA_DIR"
if [[ ! -d "$DATA_DIR/.git" && -d "$DATA_DIR/resources/.git" ]]; then
    REPO_DIR="$DATA_DIR/resources"
fi
if [[ -d "$REPO_DIR/.git" ]]; then
    git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
    git_auth -C "$REPO_DIR" fetch --progress --depth 1 origin "$GIT_BRANCH" 2>&1 | git_progress
    if [[ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]]; then
        # Edições feitas no servidor (ex.: editor de server.cfg) — guardadas antes do reset.
        PATCH="$STATE_DIR/local-changes-$(date +%Y%m%d%H%M%S).patch"
        git -C "$REPO_DIR" diff > "$PATCH"
        echo "Alterações locais salvas em $PATCH (aplique com: git -C $REPO_DIR apply $PATCH)"
    fi
    git -C "$REPO_DIR" reset --hard FETCH_HEAD
else
    if [[ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]]; then
        BACKUP="$DATA_DIR.bak-$(date +%Y%m%d%H%M%S)"
        echo "Pasta $DATA_DIR não está vazia e não é um repositório; movendo para $BACKUP"
        mv "$DATA_DIR" "$BACKUP"
    fi
    rm -rf "$DATA_DIR"
    echo "Clonando (repositórios grandes podem levar vários minutos)..."
    git_auth clone --depth 1 --branch "$GIT_BRANCH" --progress "$REPO_URL" "$DATA_DIR" 2>&1 | git_progress
fi
[[ -d "$REPO_DIR/.git" ]] || fail "clone não foi concluído"
# Desfaz um remote antigo com token embutido (instalações anteriores).
git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
git -C "$REPO_DIR" log -1 --format='Commit: %h — %s (%an, %cr)'

#------------------------------------------------------------------------------
step "2/6 Localizando server.cfg"
#------------------------------------------------------------------------------
# Sem server.cfg no repositório (é comum ficar fora do git por ter segredos),
# o painel gera um em $STATE_DIR — fora do git, então sync nunca apaga nem
# conflita, e edições feitas na aba server.cfg sobrevivem a reinstalações.
GENERATED_CFG="$STATE_DIR/server.cfg"

# generate_cfg <pasta resources>: cfg mínimo que inicia tudo o que existe.
generate_cfg() {
    local res="$1" d name
    cat <<'CFG'
# server.cfg gerado pelo fivemserver porque o repositório não tem um.
# Edite na aba "server.cfg" do painel. sv_licenseKey, mysql_connection_string,
# steam_webApiKey e sv_maxclients configurados no painel vêm do panel.cfg.

endpoint_add_tcp "0.0.0.0:30120"
endpoint_add_udp "0.0.0.0:30120"

sv_hostname "FiveM Server"
sets sv_projectName "FiveM Server"
sets sv_projectDesc "Servidor FiveM"
sv_maxclients 48
set onesync on
sv_scriptHookAllowed 0

CFG
    echo "# Banco, bibliotecas e framework primeiro"
    for name in oxmysql mysql-async ghmattimysql ox_lib vrp es_extended qb-core; do
        if [[ -n "$(find "$res" -maxdepth 2 -type d -name "$name" -print -quit)" ]]; then
            echo "ensure $name"
        fi
    done
    echo
    echo "# Demais resources ([categoria] inicia tudo que está dentro da pasta)"
    for d in "$res"/*/; do
        name="$(basename "$d")"
        if [[ "$name" == \[*\] || -f "$d/fxmanifest.lua" || -f "$d/__resource.lua" ]]; then
            echo "start $name"
        fi
    done
}

SERVER_CFG=""
for c in "$REPO_DIR/server.cfg" "$REPO_DIR/files/server.cfg"; do
    if [[ -f "$c" ]]; then SERVER_CFG="$c"; break; fi
done
if [[ -z "$SERVER_CFG" ]]; then
    SERVER_CFG="$(find "$REPO_DIR" -maxdepth 4 -name server.cfg -not -path '*/.git/*' -not -path '*/resources/*' | head -1)"
fi

if [[ -n "$SERVER_CFG" ]]; then
    SERVER_DATA="$(dirname "$SERVER_CFG")"
    echo "server.cfg do repositório: $SERVER_CFG"
else
    # Pasta resources mais rasa do repositório define onde o FXServer roda.
    RES_DIR="$(find "$REPO_DIR" -maxdepth 3 -type d -name resources -not -path '*/.git/*' -not -path '*/resources/*' \
        | awk -F/ '{ print NF " " $0 }' | sort -n | head -1 | cut -d' ' -f2-)"
    if [[ -n "$RES_DIR" ]]; then
        SERVER_DATA="$(dirname "$RES_DIR")"
    elif [[ -n "$(find "$REPO_DIR" -mindepth 2 -maxdepth 3 \( -name fxmanifest.lua -o -name __resource.lua \) -not -path '*/.git/*' -print -quit)" ]]; then
        # O próprio repositório é a pasta resources ([categorias] e resources na
        # raiz). txAdmin e FXServer exigem uma pasta resources/ de verdade (link
        # não serve), então o clone passa a morar em server-data/resources.
        # mv no mesmo disco é instantâneo, mesmo para repositórios de GBs.
        if [[ "$REPO_DIR" == "$DATA_DIR" ]]; then
            echo "O repositório é a própria pasta resources; movendo para $DATA_DIR/resources..."
            MOVE_TMP="$FIVEM_HOME/.server-data-move-$$"
            mv "$DATA_DIR" "$MOVE_TMP"
            mkdir -p "$DATA_DIR"
            mv "$MOVE_TMP" "$DATA_DIR/resources"
            REPO_DIR="$DATA_DIR/resources"
        fi
        RES_DIR="$REPO_DIR"
        SERVER_DATA="$DATA_DIR"
        rm -rf "$FIVEM_HOME/server-root"  # layout antigo (link simbólico)
    else
        echo "Conteúdo da raiz do repositório:"
        ls -la "$REPO_DIR" | head -40
        fail "o repositório não tem server.cfg, nem pasta resources/, nem resources (fxmanifest.lua) na raiz"
    fi
    if [[ -f "$GENERATED_CFG" ]]; then
        echo "Repositório sem server.cfg; usando o gerado antes: $GENERATED_CFG"
    else
        EXAMPLE="$(find "$REPO_DIR" -maxdepth 4 -type f \( -iname 'server.cfg.*' -o -iname 'server.example.cfg' -o -iname 'server-example.cfg' \) \
            -not -path '*/.git/*' -not -path '*/resources/*' | head -1)"
        if [[ -n "$EXAMPLE" ]]; then
            cp "$EXAMPLE" "$GENERATED_CFG"
            echo "Repositório sem server.cfg; criado a partir de $EXAMPLE"
        else
            generate_cfg "$RES_DIR" > "$GENERATED_CFG"
            echo "Repositório sem server.cfg; gerado com $(grep -cE '^(ensure|start) ' "$GENERATED_CFG") resources/categorias."
        fi
        echo "AVISO: revise o server.cfg gerado na aba \"server.cfg\" do painel (nome, convars do seu framework)."
    fi
    chmod 600 "$GENERATED_CFG"
    SERVER_CFG="$GENERATED_CFG"
fi
echo "server.cfg:  $SERVER_CFG"
echo "server-data: $SERVER_DATA"
[[ -d "$SERVER_DATA/resources" ]] || echo "AVISO: $SERVER_DATA/resources não existe"
if [[ -z "${SV_LICENSEKEY:-}" ]] && ! grep -qiE '^[[:space:]]*(set[[:space:]]+)?sv_licenseKey' "$SERVER_CFG"; then
    echo "AVISO: nenhuma license key (sv_licenseKey). O FXServer não inicia sem ela — informe em Configuração."
fi

# Ajustes de compatibilidade Linux (mesmos do sync):
rm -rf "$REPO_DIR/files/artifacts" 2>/dev/null || true  # artefatos Windows versionados no repo
VRP_LIB="$SERVER_DATA/resources/vrp/lib"
if [[ -d "$VRP_LIB" ]]; then
    # vRP referencia estes módulos com maiúscula; Linux diferencia caixa.
    for f in tunnel proxy tools utils; do
        if [[ -f "$VRP_LIB/$f.lua" && ! -e "$VRP_LIB/${f^}.lua" ]]; then
            cp "$VRP_LIB/$f.lua" "$VRP_LIB/${f^}.lua"
        fi
    done
    echo "vRP: aliases de maiúscula criados em $VRP_LIB"
fi

#------------------------------------------------------------------------------
step "3/6 Banco de dados"
#------------------------------------------------------------------------------
if [[ -z "${DB_NAME:-}" ]]; then
    echo "Sem banco configurado; pulando."
else
    export MYSQL_PWD="${DB_PASSWORD:-}"
    DBQ=(mariadb -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME")
    TABLES="$("${DBQ[@]}" -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()' 2>&1)" \
        || fail "não consegui conectar no banco $DB_NAME em $DB_HOST: $TABLES"
    if [[ "$TABLES" != "0" ]]; then
        echo "Banco $DB_NAME já tem $TABLES tabelas; nada a importar."
    else
        # Primeiro .sql encontrado nos lugares usuais do repositório.
        # Só na raiz ou em pastas de banco: .sql de resources não são o banco do servidor.
        SQL_FILE=""
        for dir in "$REPO_DIR" "$REPO_DIR"/{db,sql,database,banco} "$REPO_DIR"/files/{db,sql,database,banco}; do
            [[ -d "$dir" ]] || continue
            SQL_FILE="$(find "$dir" -maxdepth 1 -type f \( -iname '*.sql' -o -iname '*.sql.gz' \) | sort | head -1)"
            if [[ -n "$SQL_FILE" ]]; then break; fi
        done
        if [[ -z "$SQL_FILE" ]]; then
            echo "Banco vazio e nenhum .sql na raiz ou em db/, sql/, database/ do repositório. Os resources criam as tabelas ou importe pelo painel."
        else
            echo "Banco vazio: importando $(basename "$SQL_FILE")..."
            if [[ "$SQL_FILE" == *.gz ]]; then
                gunzip -c "$SQL_FILE" | "${DBQ[@]}" || fail "falha ao importar $SQL_FILE"
            else
                "${DBQ[@]}" < "$SQL_FILE" || fail "falha ao importar $SQL_FILE"
            fi
            echo "Importado: $("${DBQ[@]}" -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()') tabelas."
        fi
    fi
    unset MYSQL_PWD
fi

#------------------------------------------------------------------------------
step "4/6 Artefatos do FXServer"
#------------------------------------------------------------------------------
if [[ -x "$FIVEM_DIR/run.sh" && -z "${FORCE_ARTIFACT:-}" ]]; then
    echo "Já instalados ($(cat "$FIVEM_DIR/.artifact-version" 2>/dev/null || echo 'versão desconhecida')). Use FORCE_ARTIFACT=1 para atualizar."
else
    INFO="$(curl -fsSL "$ARTIFACTS_API")" || fail "não consegui consultar $ARTIFACTS_API"
    VERSION="$(node -e 'const j=JSON.parse(process.argv[1]);console.log(j.recommended)' "$INFO")"
    URL="$(node -e 'const j=JSON.parse(process.argv[1]);console.log(j.recommended_download)' "$INFO")"
    echo "Baixando build recomendada $VERSION..."
    TMP="$(mktemp -d)"
    curl -fSL --progress-bar -o "$TMP/fx.tar.xz" "$URL" 2>&1 | tr '\r' '\n' | tail -1
    rm -rf "$FIVEM_DIR.new" && mkdir -p "$FIVEM_DIR.new"
    tar -xJf "$TMP/fx.tar.xz" -C "$FIVEM_DIR.new"
    rm -rf "$TMP"
    [[ -x "$FIVEM_DIR.new/run.sh" ]] || fail "artefato baixado não contém run.sh"
    echo "$VERSION" > "$FIVEM_DIR.new/.artifact-version"
    # Troca atômica: o servidor antigo continua no disco até a nova build estar pronta.
    rm -rf "$FIVEM_DIR.old"
    if [[ -d "$FIVEM_DIR" ]]; then mv "$FIVEM_DIR" "$FIVEM_DIR.old"; fi
    mv "$FIVEM_DIR.new" "$FIVEM_DIR"
    rm -rf "$FIVEM_DIR.old"
    echo "FXServer $VERSION instalado em $FIVEM_DIR"
fi

#------------------------------------------------------------------------------
step "5/6 Configuração do serviço"
#------------------------------------------------------------------------------
# panel.cfg: carrega o server.cfg do repo e aplica os overrides deste servidor.
# Fica fora do git, então sync/reset nunca apaga.
{
    echo "# Gerado pelo painel — não versionar (contém segredos)."
    printf 'exec "%s"\n' "$SERVER_CFG"
    [[ -n "${MYSQL_CONNECTION_STRING:-}" ]] && printf 'set mysql_connection_string "%s"\n' "$MYSQL_CONNECTION_STRING"
    [[ -n "${SV_LICENSEKEY:-}" ]] && printf 'sv_licenseKey "%s"\n' "$SV_LICENSEKEY"
    [[ -n "${STEAM_WEB_API_KEY:-}" ]] && printf 'set steam_webApiKey "%s"\n' "$STEAM_WEB_API_KEY"
    [[ -n "${SV_MAXCLIENTS:-}" ]] && printf 'sv_maxclients %s\n' "$SV_MAXCLIENTS"
    true
} > "$PANEL_CFG"
chmod 600 "$PANEL_CFG"

{
    echo "# Gerado por provision.sh — lido pelo fivem-server.service"
    env_line SERVER_MODE "$SERVER_MODE"
    env_line FIVEM_DIR "$FIVEM_DIR"
    env_line SERVER_DATA "$SERVER_DATA"
    env_line SERVER_CFG "$SERVER_CFG"
    env_line PANEL_CFG "$PANEL_CFG"
    env_line TXDATA_DIR "$TXDATA_DIR"
    env_line TXADMIN_PORT "40120"
    [[ -n "${TXADMIN_ACCOUNT:-}" ]] && env_line TXHOST_DEFAULT_ACCOUNT "$TXADMIN_ACCOUNT"
    [[ -n "${SV_LICENSEKEY:-}" ]] && env_line TXHOST_DEFAULT_CFXKEY "$SV_LICENSEKEY"
    true
} > "$SERVER_ENV"
chmod 600 "$SERVER_ENV"
echo "Modo: $SERVER_MODE"
echo "Config do serviço: $SERVER_ENV"

#------------------------------------------------------------------------------
step "6/6 Iniciando o servidor"
#------------------------------------------------------------------------------
sudo -n systemctl enable fivem-server >/dev/null 2>&1 || true
sudo -n systemctl restart fivem-server || fail "não consegui iniciar fivem-server (sudoers do painel instalado?)"
sleep 5
if systemctl is-active --quiet fivem-server; then
    echo "fivem-server: ativo"
else
    echo "AVISO: fivem-server não está ativo. Últimas linhas do log:"
    tail -n 30 /var/log/fivem/server.log 2>/dev/null || true
fi

if [[ "$SERVER_MODE" == "txadmin" ]]; then
    echo
    echo "txAdmin: http://<ip-do-servidor>:40120"
    echo "  No primeiro acesso escolha 'Existing Server Data' e use:"
    echo "    Server Data Folder: $SERVER_DATA"
    echo "    CFG File Path:      $PANEL_CFG"
fi

echo
echo "Provisionamento concluído."
echo done > "$STATE_FILE"

if [[ "${RESTART_DASHBOARD:-}" == "1" ]]; then
    # Dá tempo do assistente ler o estado final antes do painel reiniciar.
    sleep 4
    sudo -n systemctl --no-block restart fivem-dashboard || true
fi
