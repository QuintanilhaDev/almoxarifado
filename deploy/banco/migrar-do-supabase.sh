#!/usr/bin/env bash
# Copia o banco ATUAL do Supabase (tabelas, funções e todos os dados) para o Postgres do servidor.
#
# Antes:
#  - PostgreSQL 17 instalado (o Supabase usa a 17; ver README) e o pg_dump 17 no PATH;
#  - a conexão do Supabase: painel → Project Settings → Database → Connection string (URI),
#    modo "Session pooler" (porta 5432). Ela tem a senha do banco: não salve em arquivo.
#
# Uso:
#   sudo -u postgres bash deploy/banco/migrar-do-supabase.sh 'SENHA_DO_BANCO_LOCAL'
#   (o script pede a conexão do Supabase sem mostrar na tela)
#
# O arquivo da cópia tem dados de funcionários (LGPD): fica só em /var/lib/maxhub/migracao,
# acessível apenas ao postgres, e pode ser apagado depois que tudo estiver conferido.
set -euo pipefail
SENHA=${1:?"informe a senha do usuário maxhub do banco local"}
SUPA=${SUPABASE_DB_URL:-}
[ -n "$SUPA" ] || { read -r -s -p "Conexão do Supabase (postgresql://...): " SUPA; echo; }
[ -n "$SUPA" ] || { echo "conexão vazia" >&2; exit 1; }

V=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
[ "$V" -ge "${PG_MIN:-17}" ] || { echo "Precisa do pg_dump 17 ou mais novo (este é $V). Veja o README." >&2; exit 1; }

PASTA=${MIGRACAO_DIR:-/var/lib/maxhub/migracao}
mkdir -p "$PASTA" && chmod 700 "$PASTA"
ARQ="$PASTA/supabase-$(date +%Y%m%d-%H%M).dump"

echo "1/4 Copiando do Supabase (só o schema public: tabelas, funções e dados)…"
pg_dump "$SUPA" --schema=public --no-owner --no-privileges --format=custom --file="$ARQ"

echo "2/4 Preparando o banco local…"
psql -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin create role maxhub login password '${SENHA//\'/\'\'}'; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role service_role nologin; exception when duplicate_object then null; end \$\$;
SQL
if psql -lqt | cut -d'|' -f1 | grep -qw maxhub; then
  echo "O banco maxhub já existe. Para refazer a cópia: sudo -u postgres dropdb maxhub" >&2
  exit 1
fi
createdb -O maxhub maxhub

echo "3/4 Restaurando no Postgres local…"
# o schema public já existe no banco novo: tira da lista só a criação dele (e o comentário)
LISTA="$PASTA/lista.txt"
pg_restore -l "$ARQ" | grep -vE ' SCHEMA - public | COMMENT - SCHEMA public ' > "$LISTA"
pg_restore --no-owner --role=maxhub --exit-on-error -L "$LISTA" -d maxhub "$ARQ" || {
  echo "Falhou ao restaurar. O banco local ficou incompleto: sudo -u postgres dropdb maxhub e tente de novo." >&2; exit 1; }
psql -q -d maxhub -c "alter schema public owner to maxhub"

echo "4/4 Conferindo…"
psql -d maxhub -At -c "select 'tabelas: ' || count(*) from information_schema.tables where table_schema='public'"
psql -d maxhub -At -c "select 'usuários: ' || count(*) from public.admins"
psql -d maxhub -At -c "select 'itens de estoque: ' || count(*) from public.stock_items"
echo "Pronto. Próximo passo: copiar os anexos (node deploy/banco/baixar-anexos.mjs)."
