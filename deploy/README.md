# Max Hub no servidor próprio

Arquivos para rodar o sistema (Next.js) e a API do Supabase auto-hospedado num servidor Linux da empresa, no lugar da Vercel e do Supabase na nuvem. Nenhuma senha ou chave fica aqui: elas vão só no `/opt/maxhub/.env.production` do servidor.

| Arquivo | Para que serve |
| --- | --- |
| `nginx.conf.example` | HTTPS e encaminhamento: `hub.` → sistema, `banco.` → API do Supabase (só as rotas usadas) |
| `maxhub.service` | Mantém o sistema rodando e o reinicia se cair ou se o servidor religar |
| `atualizar.sh` | Publica a versão nova (ou volta para a anterior) sem tirar o sistema do ar durante o build |
| `maxhub-atualizar.timer` + `.service` | Publica sozinho cada commit novo na `main`, como a Vercel fazia |

## 1. Preparar (uma vez)

```bash
# Node.js 22 LTS, Nginx, certbot e git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git

# usuário próprio, sem senha de login
sudo adduser --system --group --home /opt/maxhub maxhub
sudo cp deploy/atualizar.sh /opt/maxhub/ && sudo chmod +x /opt/maxhub/atualizar.sh
sudo chown -R maxhub:maxhub /opt/maxhub

# o usuário maxhub pode reiniciar só o próprio serviço
echo 'maxhub ALL=(root) NOPASSWD: /usr/bin/systemctl restart maxhub' | sudo tee /etc/sudoers.d/maxhub
```

Criar `/opt/maxhub/.env.production` (dono `maxhub`, `chmod 600`) com as mesmas variáveis que hoje estão na Vercel, trocando as três do Supabase pelas do servidor:

```
NEXT_PUBLIC_SUPABASE_URL=https://banco.SEU-DOMINIO
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # ANON_KEY do Supabase auto-hospedado
SUPABASE_SERVICE_ROLE_KEY=...            # SERVICE_ROLE_KEY do Supabase auto-hospedado
SESSION_SECRET=...                       # o MESMO da Vercel (ninguém precisa entrar de novo)
MAX_LLM_API_KEY=...                      # e as demais MAX_LLM_* e GEO_* que existirem
```

As `NEXT_PUBLIC_*` entram no build. Se trocar alguma delas, rode `atualizar.sh` de novo, não basta reiniciar.

Se o servidor não conseguir abrir o próprio endereço público (comum atrás de NAT), aponte o nome do banco para ele mesmo: `echo '127.0.0.1 banco.SEU-DOMINIO' | sudo tee -a /etc/hosts`.

## 2. Ligar

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/maxhub   # trocar SEU-DOMINIO
sudo ln -s /etc/nginx/sites-available/maxhub /etc/nginx/sites-enabled/
sudo certbot --nginx -d hub.SEU-DOMINIO -d banco.SEU-DOMINIO

sudo cp deploy/maxhub.service deploy/maxhub-atualizar.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo -u maxhub /opt/maxhub/atualizar.sh            # primeiro build (uns 3 a 5 minutos)
sudo systemctl enable --now maxhub maxhub-atualizar.timer
```

## Dia a dia

- Versão nova: basta o push na `main`; em até 5 minutos o timer publica. Para publicar na hora: `sudo -u maxhub /opt/maxhub/atualizar.sh`.
- Deu problema na versão nova: `sudo -u maxhub /opt/maxhub/atualizar.sh voltar`.
- Logs do sistema: `journalctl -u maxhub -f`. Logs das publicações: `journalctl -u maxhub-atualizar`.
- Firewall: só 80 e 443 abertos para fora. 3000 (sistema), 8000 (API) e 5432 (PostgreSQL) ficam fechados.
