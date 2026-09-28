#!/bin/bash
#===============================================================
# MariaDB — Script de Instalação (Servidor Dedicado)
# Uso: ssh root@DB_SERVER_IP 'bash -s' < setup-db.sh
#===============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

#------------------------------------------
# VERIFICAÇÕES
#------------------------------------------
if [[ $EUID -ne 0 ]]; then
   err "Execute como root."
fi

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MariaDB — Instalação Dedicada${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

#------------------------------------------
# PERGUNTAS
#------------------------------------------
read -p "IP do servidor GAME que vai acessar este banco: " GAME_IP
GAME_IP=${GAME_IP:-""}
if [[ -z "$GAME_IP" ]]; then
    err "IP do servidor de game é obrigatório."
fi

read -p "Senha do root MySQL: " -s MYSQL_ROOT_PWD
echo ""
if [[ -z "$MYSQL_ROOT_PWD" ]]; then
    err "Senha obrigatória."
fi

read -p "Nome do banco [creative_tema_proprio]: " DB_NAME
DB_NAME=${DB_NAME:-creative_tema_proprio}

read -p "Usuário para o game server [fivem]: " DB_USER
DB_USER=${DB_USER:-fivem}

read -p "Senha do usuário $DB_USER: " -s DB_USER_PWD
echo ""
DB_USER_PWD=${DB_USER_PWD:-$MYSQL_ROOT_PWD}

read -p "Porta MySQL [3306]: " MYSQL_PORT
MYSQL_PORT=${MYSQL_PORT:-3306}

#------------------------------------------
# INSTALAÇÃO
#------------------------------------------
log "Atualizando sistema..."
apt update && apt upgrade -y

log "Instalando MariaDB..."
apt install -y mariadb-server mariadb-client

log "Iniciando MariaDB..."
systemctl enable mariadb
systemctl start mariadb
systemctl status mariadb --no-pager || true

sleep 2

#------------------------------------------
# HARDENING
#------------------------------------------
log "Aplicando segurança básica..."

mysql -u root << SQL1
-- Remove anonymous
DELETE FROM mysql.user WHERE User='';

-- Desabilita root remoto (só localhost)
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

-- Remove database test
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';

FLUSH PRIVILEGES;
SQL1

log "Root password..."
mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$MYSQL_ROOT_PWD';" 2>/dev/null || \
    mysql -u root -p"$MYSQL_ROOT_PWD" -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$MYSQL_ROOT_PWD';" 2>/dev/null || \
    mysql -e "SET PASSWORD FOR 'root'@'localhost' = PASSWORD('$MYSQL_ROOT_PWD');" 2>/dev/null || true

#------------------------------------------
# CRIAR BANCO E USUÁRIO
#------------------------------------------
log "Criando banco e usuário..."

mysql -u root -p"$MYSQL_ROOT_PWD" << SQL2
CREATE DATABASE IF NOT EXISTS $DB_NAME
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- Usuario com acesso do servidor de game
CREATE USER IF NOT EXISTS '$DB_USER'@'$GAME_IP' IDENTIFIED BY '$DB_USER_PWD';
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_USER_PWD';

GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'$GAME_IP';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'%';

FLUSH PRIVILEGES;
SQL2

log "Banco '$DB_NAME' e usuário '$DB_USER' criados."

#------------------------------------------
# CONFIGURAÇÃO DE PERFORMANCE
#------------------------------------------
log "Configurando performance..."

# Estimativa de RAM disponível
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))
if [[ $TOTAL_RAM_GB -lt 2 ]]; then
    TOTAL_RAM_GB=2
fi

# innodb_buffer_pool_size = 50-70% da RAM disponível
INNODB_SIZE=$((TOTAL_RAM_GB * 60 / 100))G
[[ $INNODB_SIZE == "0G" ]] && INNODB_SIZE="1G"

# Aplica tuning
cat >> /etc/mysql/mariadb.conf.d/99-fivem.cnf << CNF
[mysqld]
# --- FiveM Tuning ---
innodb_buffer_pool_size = $INNODB_SIZE
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
max_connections = 150
max_allowed_packet = 64M
query_cache_size = 0
query_cache_type = 0

# --- Segurança ---
bind-address = 0.0.0.0
port = $MYSQL_PORT
CNF

#------------------------------------------
# FIREWALL
#------------------------------------------
log "Configurando firewall..."

apt install -y ufw

ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow $MYSQL_PORT/tcp  # MySQL

# Só libera MySQL pro IP do game
ufw delete allow 3306/tcp 2>/dev/null || true
ufw allow from $GAME_IP to any port $MYSQL_PORT proto tcp

ufw reload

log "Firewall configurado."

#------------------------------------------
# TESTE
#------------------------------------------
log "Testando conexão..."
sleep 1

# Testa local
if mysql -u root -p"$MYSQL_ROOT_PWD" -e "SELECT 1;" 2>/dev/null; then
    log "Conexão local: OK"
else
    warn "Conexão local falhou. Verifique a senha do root."
fi

#------------------------------------------
# FINALIZAÇÃO
#------------------------------------------
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MariaDB — Instalação Concluída${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo "Banco:          $DB_NAME"
echo "Usuário:        $DB_USER"
echo "Host do game:   $GAME_IP"
echo "Porta:          $MYSQL_PORT"
echo "Buffer Pool:    $INNODB_SIZE"
echo ""
echo "Testar do game server:"
echo "  mysql -h $GAME_IP -u $DB_USER -p'$DB_USER_PWD' -e 'SELECT 1;'"
echo ""
echo "Ver todos os bancos:"
echo "  mysql -u root -p'$MYSQL_ROOT_PWD'"
echo ""
echo "Conectar remotamente (de fora):"
echo "  mysql -h IP_DO_SERVIDOR_DB -u $DB_USER -p'$DB_USER_PWD' $DB_NAME"
echo ""

# Reinicia pra aplicar configs
read -p "Deseja reiniciar o MariaDB agora? (Y/n): " DO_RESTART
if [[ "$DO_RESTART" =~ ^[Nn]$ ]]; then
    echo "Reinicie manualmente: systemctl restart mariadb"
else
    systemctl restart mariadb
    systemctl status mariadb --no-pager || true
fi
