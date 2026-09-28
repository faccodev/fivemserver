# SindicatoRP - Servidor GTA V FiveM (Linux Nativo)

Servidor FiveM GTA RP rodando em **Linux nativo** com systemd, Caddy (HTTPS automático) e MariaDB externo.

## Arquitetura

```
┌─────────────────────────┐        ┌─────────────────────────┐
│  SERVIDOR GAME          │        │  SERVIDOR DB (externo) │
│  ─────────────────────  │        │  ─────────────────────  │
│  FiveM Server (:30120)   │◄──────►│  MariaDB (:5432)        │
│  txAdmin (:40120)       │  TCP   │                         │
│  Dashboard (:8081+Caddy) │        │                         │
│  mock_auth (:8082)       │        │                         │
│  Caddy (443/80)         │        │                         │
└─────────────────────────┘        └─────────────────────────┘
```

## Estrutura do Repositório

| Arquivo | Descrição |
|---|---|
| `install.sh` | Script de instalação principal (roda no servidor de game) |
| `setup-db.sh` | Script de instalação do MariaDB (roda no servidor de banco) |
| `fivemctl` | Gerenciamento dia-a-dia do servidor |
| `mock_auth.js` | Servidor mock de autenticação |
| `dashboard/` | Painel administrativo Next.js |

## Instalação Rápida

### 1. Servidor de Banco (setup-db.sh)

```bash
ssh root@IP_DO_BANCO
bash -s < setup-db.sh
```

### 2. Servidor de Game (install.sh)

```bash
ssh root@IP_DO_GAME
bash -s < install.sh
```

O script solicita:
- IP do banco de dados
- Credenciais MySQL (usuário, senha, nome do banco)
- License key do FiveM
- URL do repositório GitHub (com token se privado)
- Slots máximo e porta do jogo

## fivemctl — Gestão Contínua

```bash
fivemctl start        # Inicia todos os serviços
fivemctl stop         # Para todos os serviços
fivemctl restart      # Reinicia todos os serviços
fivemctl status       # Status de todos os serviços
fivemctl logs         # Logs em tempo real
fivemctl logs server  # Logs do servidor FiveM
fivemctl sync         # Sincroniza código do GitHub
fivemctl update       # Atualiza artefatos FiveM
fivemctl cleanup      # Limpa logs/crashes/cache
fivemctl backup       # Backup rápido
fivemctl backup --full # Backup com todos os resources
fivemctl info         # Informações do servidor
```

## Acesso

| Serviço | URL |
|---|---|
| txAdmin | `http://IP:40120` |
| Dashboard | `https://dash.seudominio.com.br` |
| Jogo | `IP:30120` |

## Variáveis de Ambiente

O arquivo `.env` em `/opt/fivem/server-data/.env` contém todos os segredos:

```env
DB_HOST=IP_DO_BANCO
DB_USER=mariadb
DB_PASSWORD=sua_senha
DB_NAME=default
DB_PORT=5432
SV_LICENSE_KEY=cfxk_...
STEAM_WEB_API_KEY=...
GIT_REPO=https://github.com/faccodev/sindicatorp.git
GIT_TOKEN=ghp_...
SERVER_IP=IP_DO_GAME
SV_MAXCLIENTS=48
GAME_PORT=30120
```

## Diretórios

| Caminho | Descrição |
|---|---|
| `/opt/fivem/` | Binários e artefatos FiveM |
| `/opt/fivem/server-data/` | Configs, resources e .env |
| `/opt/fivem/txData/` | Dados do txAdmin |
| `/var/log/fivem/` | Logs do servidor |

## Troubleshooting

### Banco de dados não conecta
```bash
mysql -h IP_DO_BANCO -P 5432 -u mariadb -p'SUA_SENHA' --ssl-mode=DISABLED -e "SELECT 1;"
```

### FiveM não sobe (porta 30120 não abre)
```bash
journalctl -u fivem-server -n 50
cat /var/log/fivem/server.log
```

### Dashboard JS/CSS bugado
```bash
# Rebuild do dashboard
cd /opt/fivem/dashboard
npm run build
systemctl restart fivem-dashboard
```

### txAdmin pede PIN novamente
O txAdmin pode pedir novo PIN se o perfil foi recriado. Acesse `http://IP:40120`.

## Atualização

```bash
fivemctl sync    # Puxa código do GitHub
fivemctl update  # Atualiza artefatos FiveM
fivemctl restart # Reinicia servidor
```
