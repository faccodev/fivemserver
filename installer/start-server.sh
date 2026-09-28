#!/usr/bin/env bash
#===============================================================================
# ExecStart do fivem-server.service. Variáveis vêm de ~/.panel/server.env
# (escrito pelo provision.sh).
#
#   SERVER_MODE   txadmin (padrão) | direct
#   FIVEM_DIR     pasta dos artefatos (contém run.sh)
#   SERVER_DATA   pasta onde ficam server.cfg e resources/ (cwd do FXServer)
#   PANEL_CFG     cfg do painel: faz exec do server.cfg do repo + overrides
#   TXDATA_DIR    pasta de dados do txAdmin
#===============================================================================
set -euo pipefail

: "${FIVEM_DIR:?FIVEM_DIR não definido — rode a instalação pelo /setup}"
: "${SERVER_DATA:?SERVER_DATA não definido — rode a instalação pelo /setup}"
: "${PANEL_CFG:?PANEL_CFG não definido — rode a instalação pelo /setup}"

cd "$SERVER_DATA"
echo "[start-server] $(date '+%F %T') modo=${SERVER_MODE:-txadmin} data=$SERVER_DATA"

if [[ "${SERVER_MODE:-txadmin}" == "txadmin" ]]; then
    # txAdmin v8+: configuração por TXHOST_* (as convars antigas estão deprecadas).
    export TXHOST_DATA_PATH="${TXDATA_DIR:-/home/fivem/txData}"
    export TXHOST_TXA_PORT="${TXADMIN_PORT:-40120}"
    export TXHOST_GAME_NAME="fivem"
    exec "$FIVEM_DIR/run.sh"
fi

exec "$FIVEM_DIR/run.sh" +exec "$PANEL_CFG"
