#!/bin/bash
# ============================================================
# SindicatoRP - FiveM Server Stop Script
# ============================================================

pkill -f FXServer 2>/dev/null && echo "FiveM encerrado" || echo "Nenhum processo encontrado"