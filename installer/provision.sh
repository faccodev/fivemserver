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
git_auth() {
    if [[ -n "${GIT_TOKEN:-}" ]]; then
        GIT_CONFIG_COUNT=1 \
        GIT_CONFIG_KEY_0="http.https://github.com/.extraHeader" \
        GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$GIT_TOKEN" | base64 -w0)" \
        git "$@"
    else
        git "$@"
    fi
}

#------------------------------------------------------------------------------
step "1/5 Repositório de resources ($GIT_REPO @ $GIT_BRANCH)"
#------------------------------------------------------------------------------
REPO_URL="${GIT_REPO%.git}.git"
if [[ -d "$DATA_DIR/.git" ]]; then
    git -C "$DATA_DIR" remote set-url origin "$REPO_URL"
    git_auth -C "$DATA_DIR" fetch --depth 1 origin "$GIT_BRANCH"
    if [[ -n "$(git -C "$DATA_DIR" status --porcelain --untracked-files=no)" ]]; then
        # Edições feitas no servidor (ex.: editor de server.cfg) — guardadas antes do reset.
        PATCH="$STATE_DIR/local-changes-$(date +%Y%m%d%H%M%S).patch"
        git -C "$DATA_DIR" diff > "$PATCH"
        echo "Alterações locais salvas em $PATCH (aplique com: git -C $DATA_DIR apply $PATCH)"
    fi
    git -C "$DATA_DIR" reset --hard FETCH_HEAD
else
    if [[ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]]; then
        BACKUP="$DATA_DIR.bak-$(date +%Y%m%d%H%M%S)"
        echo "Pasta $DATA_DIR não está vazia e não é um repositório; movendo para $BACKUP"
        mv "$DATA_DIR" "$BACKUP"
    fi
    rm -rf "$DATA_DIR"
    git_auth clone --depth 1 --branch "$GIT_BRANCH" --progress "$REPO_URL" "$DATA_DIR" 2>&1 \
        | tr '\r' '\n' | awk '!/^(Receiving|Resolving|Updating|remote: (Counting|Compressing))/ || /done/'
fi
[[ -d "$DATA_DIR/.git" ]] || fail "clone não foi concluído"
# Desfaz um remote antigo com token embutido (instalações anteriores).
git -C "$DATA_DIR" remote set-url origin "$REPO_URL"
git -C "$DATA_DIR" log -1 --format='Commit: %h — %s (%an, %cr)'

#------------------------------------------------------------------------------
step "2/5 Localizando server.cfg"
#------------------------------------------------------------------------------
SERVER_CFG=""
for c in "$DATA_DIR/server.cfg" "$DATA_DIR/files/server.cfg"; do
    if [[ -f "$c" ]]; then SERVER_CFG="$c"; break; fi
done
if [[ -z "$SERVER_CFG" ]]; then
    SERVER_CFG="$(find "$DATA_DIR" -maxdepth 4 -name server.cfg -not -path '*/.git/*' -not -path '*/resources/*' | head -1)"
fi
[[ -n "$SERVER_CFG" ]] || fail "nenhum server.cfg encontrado no repositório"
SERVER_DATA="$(dirname "$SERVER_CFG")"
echo "server.cfg:  $SERVER_CFG"
echo "server-data: $SERVER_DATA"
[[ -d "$SERVER_DATA/resources" ]] || echo "AVISO: $SERVER_DATA/resources não existe"

# Ajustes de compatibilidade Linux (mesmos do sync):
rm -rf "$DATA_DIR/files/artifacts" 2>/dev/null || true  # artefatos Windows versionados no repo
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
step "3/5 Artefatos do FXServer"
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
step "4/5 Configuração do serviço"
#------------------------------------------------------------------------------
# panel.cfg: carrega o server.cfg do repo e aplica os overrides deste servidor.
# Fica fora do git, então sync/reset nunca apaga.
{
    echo "# Gerado pelo painel — não versionar (contém segredos)."
    printf 'exec "%s"\n' "$SERVER_CFG"
    [[ -n "${MYSQL_CONNECTION_STRING:-}" ]] && printf 'set mysql_connection_string "%s"\n' "$MYSQL_CONNECTION_STRING"
    [[ -n "${SV_LICENSEKEY:-}" ]] && printf 'sv_licenseKey "%s"\n' "$SV_LICENSEKEY"
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
step "5/5 Iniciando o servidor"
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
