# fivemserver

Instalador de servidor **FiveM** para Linux com painel web. Um comando instala tudo: FXServer, txAdmin, banco MariaDB e o painel. Depois disso o servidor sincroniza os resources direto do seu repositório no GitHub.

## Instalação

Em um servidor **Ubuntu 22.04+ ou Debian 12+ (x86_64)**, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/faccodev/fivemserver/main/install.sh | sudo bash
```

O instalador faz só algumas perguntas:

| Pergunta | Obrigatório? |
|---|---|
| Repositório dos resources (`https://github.com/usuario/repo`) | Sim (ou Enter para configurar pelo navegador) |
| Token do GitHub | Só se o repositório for privado |
| License key `cfxk_…` ([portal.cfx.re](https://portal.cfx.re)) | Não, se já estiver no seu `server.cfg` |
| Steam Web API key, slots | Não |
| Senha do painel | Não. Enter gera uma senha forte |

Todo o resto é criado automaticamente: banco de dados, usuário e senha do MySQL, senha do painel, conta admin do txAdmin, serviços do sistema e o `.env`. No final, o terminal mostra o endereço do painel e a senha. As credenciais ficam salvas em `/root/fivemserver-credenciais.txt`.

### Sem perguntas

Passe as opções direto no comando, útil para automação:

```bash
curl -fsSL https://raw.githubusercontent.com/faccodev/fivemserver/main/install.sh | sudo bash -s -- \
  --repo https://github.com/usuario/meu-servidor \
  --token github_pat_xxxxxxxx \
  --license cfxk_xxxxxxxx
```

| Opção | Descrição |
|---|---|
| `--repo URL` | Repositório GitHub com `server.cfg` e `resources/` |
| `--token TOKEN` | Token GitHub (só para repositório privado) |
| `--branch NOME` | Branch. Padrão: a branch padrão do repositório |
| `--license CHAVE` | License key `cfxk_…`. Substitui a do `server.cfg` |
| `--steam-key CHAVE` | Steam Web API key |
| `--max-clients N` | Slots. Substitui o `sv_maxclients` do `server.cfg` |
| `--password SENHA` | Senha do painel e do admin do txAdmin. Padrão: gerada |
| `--mode txadmin\|direct` | Com txAdmin (padrão) ou FXServer direto |
| `--domain DOMINIO` | Coloca o painel em HTTPS com Caddy (o domínio precisa apontar para o servidor) |
| `--title NOME` | Nome exibido no painel |
| `--port PORTA` | Porta do painel. Padrão: `8081` |
| `--db-host`, `--db-port`, `--db-user`, `--db-pass`, `--db-name` | Usar um MySQL externo em vez do MariaDB local |
| `--yes` | Não pergunta nada. Sem `--repo`, a configuração é feita pelo navegador |

### Pelo navegador

Se você deixar o repositório em branco, o instalador sobe só o painel e mostra um link único de configuração (`http://IP:8081/setup?token=…`). O assistente pede as mesmas informações, valida o acesso ao GitHub e mostra a instalação em tempo real.

## Como o repositório de resources deve estar

Qualquer repositório com a pasta `resources/`, na raiz ou em uma subpasta. O `server.cfg` ao lado dela é opcional:

```
meu-servidor/
├── server.cfg
└── resources/
    ├── [base]/
    └── meu-resource/
```

Se o repositório for a **própria pasta resources** (categorias `[base]`, `[jobs]`… direto na raiz), o clone fica em `/home/fivem/server-data/resources`, e `/home/fivem/server-data` vira a pasta do servidor.

**Sem `server.cfg` no repositório** (comum quando ele fica fora do git por ter senhas), o painel cria um em `/home/fivem/.panel/server.cfg`. Se houver um exemplo (`server.cfg.example`, `server.example.cfg`), ele serve de base. Se não houver, o painel gera um que inicia o banco e o framework primeiro (`oxmysql`, `vrp`, `es_extended`, `qb-core`…) e depois todas as pastas `[categoria]` e resources. Esse arquivo fica fora do git (o sync não mexe nele) e pode ser editado na aba **server.cfg** do painel.

Opcional: se o repositório tiver um arquivo `.sql` fora de `resources/` (por exemplo `db/database.sql`) e o banco estiver vazio, ele é **importado automaticamente** na primeira instalação.

Você não precisa mudar o `server.cfg` para este servidor. O instalador cria um `panel.cfg` fora do git. Ele carrega o seu `server.cfg` e depois aplica a conexão do banco local, a license key, a Steam key e os slots. Assim o sync nunca apaga essas configurações.

## O painel

- **Monitor:** CPU, memória, disco, rede e estado do servidor
- **Logs:** console do servidor em tempo real
- **Banco de dados:**
  - backup (`.sql.gz` baixado no navegador), restore e sync do repositório
  - exportar/importar o `playersDB.json` (jogadores, bans, warns, whitelist) e o `admins.json` do txAdmin
- **server.cfg:** editor do `server.cfg` do repositório e dos overrides locais (`panel.cfg`), com "salvar e reiniciar"
- **Arquivos:** navegador e visualizador de arquivos do servidor
- **Armazenamento:** uso de disco e limpeza de cache e logs
- **Configuração:** troca repositório, token, license key e modo, e reinstala

Para receber cada backup também no Discord, adicione `BACKUP_WEBHOOK_URL="https://discord.com/api/webhooks/…"` em `/home/fivem/.panel/dashboard.env` e rode `sudo systemctl restart fivem-dashboard`.

## txAdmin

No modo padrão, o txAdmin fica em `http://IP:40120`, com usuário **`admin`** e a mesma senha do painel. No primeiro acesso, escolha **Existing Server Data** e use os caminhos mostrados no fim da instalação:

- **Server Data Folder:** a pasta do seu `server.cfg` dentro de `/home/fivem/server-data`
- **CFG File Path:** `/home/fivem/.panel/panel.cfg`

## Onde fica cada coisa

| Caminho | Conteúdo |
|---|---|
| `/home/fivem/server` | FXServer (build recomendada) |
| `/home/fivem/server-data` | Clone do seu repositório de resources |
| `/home/fivem/txData` | Dados do txAdmin (`admins.json`, `default/data/playersDB.json`) |
| `/home/fivem/backups` | Backups do banco |
| `/home/fivem/panel` | Código deste painel |
| `/home/fivem/.panel/dashboard.env` | Configuração do painel (senhas, token, banco) |
| `/home/fivem/.panel/panel.cfg` | Overrides do `server.cfg` |
| `/var/log/fivem/server.log` | Log do servidor (rotação diária, 7 dias) |

Serviços:

```bash
sudo systemctl status fivem-server fivem-dashboard
sudo journalctl -u fivem-dashboard -f
```

## Atualizar

Rode o mesmo comando de instalação. Ele atualiza o painel e mantém a configuração, o banco e os dados:

```bash
curl -fsSL https://raw.githubusercontent.com/faccodev/fivemserver/main/install.sh | sudo bash
```

## Portas

| Porta | Uso |
|---|---|
| `30120` TCP/UDP | Jogo |
| `40120` TCP | txAdmin |
| `8081` TCP | Painel (ou 80/443 com `--domain`) |

Se o `ufw` estiver ativo, o instalador libera essas portas. Em provedores com firewall próprio (AWS, Oracle, Hetzner…), libere-as no painel do provedor.

## Segurança

- O painel roda como o usuário `fivem`, sem root. Ele só pode iniciar, parar e reiniciar os serviços `fivem-server` e `fivem-dashboard`.
- O token do GitHub não é gravado no `.git/config`; é enviado só no momento de cada sincronização.
- O MariaDB local só aceita conexões de `127.0.0.1`.
- O link `/setup?token=…` dá acesso total até a instalação terminar. Não compartilhe.
- Para usar HTTPS, instale com `--domain`.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Esqueci a senha do painel | `sudo grep DASHBOARD_PASSWORD /home/fivem/.panel/dashboard.env` |
| Perdi o link de configuração | `sudo grep SETUP_TOKEN /home/fivem/.panel/dashboard.env` |
| Servidor não sobe | `sudo tail -n 100 /var/log/fivem/server.log` |
| Painel não abre | `sudo journalctl -u fivem-dashboard -n 100` |
| Build do painel falhou | `sudo cat /home/fivem/.panel/build.log` |
| Instalação do servidor falhou | `sudo cat /home/fivem/.panel/provision.log` |
