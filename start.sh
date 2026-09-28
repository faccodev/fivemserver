#!/bin/bash
set -e

# Config paths
SERVER_ARTIFACTS="/server"
DATA_DIR="/server/data"
CONFIG_FILE="$DATA_DIR/server.cfg"

echo "Directory setup..."
cd $DATA_DIR

echo "--- DEBUG: Container File System ---"
ls -la $DATA_DIR
echo "--- DEBUG: Resources Directory ---"
ls -F $DATA_DIR/resources 2>/dev/null || echo "Resources directory not found!"
echo "------------------------------------"

# Helper to build connection string if env vars exist
if [ -n "$DB_HOST" ]; then
    MYSQL_CONNECTION_STRING="server=$DB_HOST;uid=$DB_USER;pwd=$DB_PASSWORD;database=$DB_NAME;port=$DB_PORT"
    echo "Generated MySQL Connection String from Environment Variables"
else
    echo "WARNING: No DB Environment Variables found."
fi

echo "--- Checking Resources ---"

# Only create the directories to allow sync via dashboard later
echo "Skiping initial sync. Creating required folders instead..."
mkdir -p "$DATA_DIR/resources"

# Delete legacy symlink if it still exists from old versions
if [ -h "$DATA_DIR/resources" ]; then
    rm -f "$DATA_DIR/resources"
    mkdir -p "$DATA_DIR/resources"
fi

echo "---------------------------------------------------"

check_http() {
    local service_host=$1
    local service_port=$2
    local path=${3:-"/"}
    local max_attempts=30
    local attempt=1

    echo "Checking HTTP service: $service_host:$service_port$path"
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f -o /dev/null "http://$service_host:$service_port$path"; then
            echo "  [OK] $service_host is reachable."
            return 0
        fi
        echo "  [WAIT] Attempt $attempt/$max_attempts: Waiting for $service_host..."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo "  [ERROR] Failed to connect to $service_host after $max_attempts attempts."
    # We warn but don't exit to allow start even if some external services are flaky, or uncomment exit 1
    # exit 1 
}

check_mysql() {
    local host=$1
    local user=$2
    local pass=$3
    local max_attempts=30
    local attempt=1
    
    echo "Checking MySQL service: $host"
    while [ $attempt -le $max_attempts ]; do
        if mysqladmin ping -h "$host" -u "$user" -p"$pass" --silent; then
            echo "  [OK] MySQL service is reachable."
            return 0
        fi
        echo "  [WAIT] Attempt $attempt/$max_attempts: Waiting for MySQL..."
        sleep 2
        attempt=$((attempt + 1))
    done
    echo "  [ERROR] Failed to connect to MySQL backend."
    exit 1
}

# Perform Health Checks
if [ -n "$DB_HOST" ]; then
    check_mysql "$DB_HOST" "$DB_USER" "$DB_PASSWORD"
fi

# php_assets (assets_server)
check_http "assets_server" "80" "/barbersv.json"

# mock_auth
check_http "mock_auth" "8082" "/"

# phpmyadmin (optional, but requested)
check_http "phpmyadmin" "80" "/"

echo "All service checks completed."
echo "---------------------------------------------------"

echo "Starting Sync Server..."
node /server/sync_server.js &

echo "Starting FiveM Server (via txAdmin)..."
exec "$SERVER_ARTIFACTS/run.sh" "+set" "txAdminPort" "40120" "+set" "txAdmin-oneTimePIN" "2336" "+set" "serverProfile" "default" "+set" "txAdminServerConfigPath" "$DATA_DIR/server.cfg" "+set" "txAdminPath" "/server/txData" "+set" "mysql_connection_string" "$MYSQL_CONNECTION_STRING" "+set" "sv_assetValidationMode" "disabled"
