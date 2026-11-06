# Max Hub no servidor da empresa (modelo integrado)

Tudo numa máquina só, como no esquema do SRV. ESTOQUE:

```
usuário ──HTTPS──▶ Apache :443 (proxy reverso + WAF ModSecurity/OWASP CRS)
                     └─▶ Max Hub 127.0.0.1:880 (Next.js)
                           ├─▶ PostgreSQL 127.0.0.1:5432
                           └─▶ anexos em /var/lib/maxhub/arquivos
```

Sem Vercel e sem Supabase: o sistema fala **direto com o Postgres** (`DATABASE_URL`). Os anexos ficam
numa pasta do servidor e o **tempo real** (telas que se atualizam sozinhas, avisos de chamado, auditoria
ao vivo) sai do próprio Max Hub, pelo Postgres (`LISTEN/NOTIFY`), numa conexão aberta com cada navegador
(`/api/tempo-real`). Só as portas 80 e 443 ficam abertas para a rede; 880 e 5432 respondem só dentro da máquina.

> O mesmo código continua funcionando na Vercel com o Supabase (sem `DATABASE_URL`). A troca é feita
> só pelas variáveis do `.env.production`, então dá para migrar sem pressa e voltar se for preciso.

| Arquivo | Para que serve |
| --- | --- |
| `apache/maxhub.conf` | HTTPS, cabeçalhos de segurança, encaminhamento para 127.0.0.1:880 e ajuste do tempo real |
| `apache/maxhub-modsecurity.conf` | Ajustes do WAF para o Max Hub (limites de envio e exceções conhecidas) |
| `maxhub.service` | Mantém o sistema rodando na porta 880 e o reinicia se cair ou se o servidor religar |
| `maxhub.env.example` | Modelo do `/opt/maxhub/.env.production` (senhas ficam só no servidor) |
| `atualizar.sh` | Publica a versão nova (ou volta para a anterior) sem tirar o sistema do ar durante o build |
| `maxhub-atualizar.timer` + `.service` | Publica sozinho cada commit novo na `main`, como a Vercel fazia |
| `banco/migrar-do-supabase.sh` | Copia o banco atual do Supabase (estrutura + dados) para o Postgres do servidor |
| `banco/baixar-anexos.mjs` | Copia os anexos do Storage do Supabase para a pasta do servidor |
| `banco/criar-banco.sh` | Cria o banco vazio (instalação nova, sem dados do Supabase) |
| `backup.sh` + `maxhub-backup.timer` | Cópia de segurança diária do banco e dos anexos (guarda 14 dias) |

## 1. Pacotes (Ubuntu Server 24.04)

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# PostgreSQL 17 (repositório oficial do PostgreSQL). O Supabase usa a versão 17;
# o Ubuntu 24.04 traz a 16, que não consegue copiar um banco 17.
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-17

# Apache com WAF
sudo apt install -y apache2 libapache2-mod-security2 modsecurity-crs certbot python3-certbot-apache
sudo a2enmod ssl proxy proxy_http headers rewrite http2 security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
```

O Postgres já vem escutando só em `127.0.0.1:5432`. Não abra essa porta no firewall.

## 2. Usuário e pastas

```bash
sudo adduser --system --group --home /opt/maxhub maxhub
sudo mkdir -p /var/lib/maxhub/arquivos && sudo chown -R maxhub:maxhub /var/lib/maxhub
sudo cp deploy/atualizar.sh deploy/backup.sh /opt/maxhub/ && sudo chmod +x /opt/maxhub/*.sh
sudo chown -R maxhub:maxhub /opt/maxhub
# o usuário maxhub pode reiniciar só o próprio serviço
echo 'maxhub ALL=(root) NOPASSWD: /usr/bin/systemctl restart maxhub' | sudo tee /etc/sudoers.d/maxhub
```

## 3. Banco e anexos

Escolha **um** dos dois:

**a) Trazer tudo o que está hoje no Supabase** (o normal):

```bash
# dentro de uma cópia do código (git clone https://github.com/QuintanilhaDev/almoxarifado.git)
sudo -u postgres bash deploy/banco/migrar-do-supabase.sh 'SENHA_NOVA_DO_BANCO'
#   pede a "Connection string" do Supabase (Project Settings → Database → Session pooler)

npm ci   # só para o script dos anexos
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co SUPABASE_SERVICE_ROLE_KEY='...' \
STORAGE_DIR=/var/lib/maxhub/arquivos node deploy/banco/baixar-anexos.mjs
sudo chown -R maxhub:maxhub /var/lib/maxhub/arquivos
```

A cópia do banco tem dados de funcionários (LGPD). Ela fica em `/var/lib/maxhub/migracao`, acessível só
ao `postgres`. Apague essa pasta depois de conferir que está tudo certo. Nunca envie esse arquivo por
e-mail nem o coloque no GitHub (o repositório é público).

**b) Começar do zero:** `sudo -u postgres bash deploy/banco/criar-banco.sh 'SENHA_NOVA_DO_BANCO'`

## 4. Configuração

```bash
sudo cp deploy/maxhub.env.example /opt/maxhub/.env.production
sudo nano /opt/maxhub/.env.production      # preencher DATABASE_URL, SESSION_SECRET (o mesmo da Vercel), MAX_LLM_*, GEO_*
sudo chown maxhub:maxhub /opt/maxhub/.env.production && sudo chmod 600 /opt/maxhub/.env.production
```

Use o **mesmo `SESSION_SECRET` da Vercel**: assim ninguém precisa entrar de novo e os links já gerados
continuam valendo. **Não** coloque as variáveis do Supabase (`NEXT_PUBLIC_SUPABASE_*`,
`SUPABASE_SERVICE_ROLE_KEY`): é a ausência delas, junto com o `DATABASE_URL`, que liga o modo servidor próprio.

## 5. Apache + WAF

```bash
sudo cp deploy/apache/maxhub.conf /etc/apache2/sites-available/maxhub.conf
sudo cp deploy/apache/maxhub-modsecurity.conf /etc/apache2/maxhub-modsecurity.conf
sudo cp deploy/apache/maxhub-crs-setup.conf /etc/modsecurity/maxhub-crs-setup.conf
sudo a2dissite 000-default
# não anunciar a versão do Apache nas respostas
sudo sed -i 's/^ServerTokens .*/ServerTokens Prod/; s/^ServerSignature .*/ServerSignature Off/' /etc/apache2/conf-available/security.conf
sudo a2ensite maxhub
sudo certbot --apache -d estoque.grupomaxforte.com.br    # ou os caminhos do certificado da empresa no maxhub.conf
sudo apachectl configtest && sudo systemctl reload apache2
```

O WAF já começa **bloqueando**. Se alguma ação legítima for barrada (o usuário vê "403 Forbidden"):

```bash
sudo grep -o 'id "[0-9]*"' /var/log/apache2/modsec_audit.log | sort | uniq -c | sort -rn | head
```

Depois, acrescente a exceção no fim do `maxhub-modsecurity.conf`. Os casos conhecidos já estão lá:
anexos, tempo real e textos livres da Max e dos chamados. Para só observar por uns dias antes de bloquear,
troque `SecRuleEngine On` por `DetectionOnly`.

## 6. Ligar

```bash
sudo cp deploy/maxhub.service deploy/maxhub-atualizar.* deploy/maxhub-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo -u maxhub /opt/maxhub/atualizar.sh            # primeiro build (uns 3 a 5 minutos)
sudo systemctl enable --now maxhub maxhub-atualizar.timer maxhub-backup.timer
```

Conferir: `curl -I http://127.0.0.1:880/` (direto no sistema) e `https://estoque.grupomaxforte.com.br` no navegador.

## Dia a dia

- **Versão nova:** basta o push na `main`; em até 5 minutos o timer publica. Para publicar na hora: `sudo -u maxhub /opt/maxhub/atualizar.sh`.
- **A versão nova deu problema:** `sudo -u maxhub /opt/maxhub/atualizar.sh voltar`.
- **Logs:**
  - sistema: `journalctl -u maxhub -f`;
  - publicações: `journalctl -u maxhub-atualizar`;
  - Apache: `/var/log/apache2/maxhub-*.log`;
  - WAF: `/var/log/apache2/modsec_audit.log`.
- **Backup:** todo dia às 02:30, em `/var/backups/maxhub`. Copie essa pasta para fora do servidor também (outro disco ou o NAS da empresa).
- **Arquivo `.sql` novo no repositório** (quando o sistema ganhar uma tabela nova):
  `sudo -u postgres psql -d maxhub -c "set role maxhub" -f supabase/ARQUIVO.sql`.
- **Firewall:** só as portas 80 e 443 ficam abertas para fora.
