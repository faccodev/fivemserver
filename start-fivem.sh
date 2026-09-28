#!/bin/bash
# ============================================================
# SindicatoRP - FiveM Server Start Script (with txAdmin)
# ============================================================

set -e

SERVER_DIR="/home/fivem/server"
DATA_DIR="/home/fivem/server-data"
CONFIG="$DATA_DIR/files/server.cfg"
LICENSE_KEY="${SV_LICENSEKEY:?defina SV_LICENSEKEY}"
CITIZEN_ROOT="$SERVER_DIR/alpine/alpine/opt/cfx-server/citizen/"

cd "$SERVER_DIR"
exec ./run.sh \
  +set citizen_dir "$CITIZEN_ROOT" \
  +set serverDataPath "$DATA_DIR" \
  +exec "$CONFIG" \
  +set sv_licenseKey "$LICENSE_KEY" \
  +set monitorMode true \
  +set citizen_root "$CITIZEN_ROOT"