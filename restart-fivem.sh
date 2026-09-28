#!/bin/bash
# ============================================================
# SindicatoRP - FiveM Server Restart Script
# ============================================================

# Kill existing FXServer processes
pkill -f FXServer 2>/dev/null || true
sleep 2

# Start the server
bash /root/sindicato_rp_coolify/start-fivem.sh