#!/usr/bin/env bash
# Cria o banco do Max Hub VAZIO (instalação nova, sem trazer dados do Supabase).
# Para trazer os dados atuais, use migrar-do-supabase.sh no lugar deste.
#
# Uso (no servidor, na pasta do código):
#   sudo -u postgres bash deploy/banco/criar-banco.sh 'SENHA_DO_BANCO'
set -euo pipefail
SENHA=${1:?"informe a senha do usuário maxhub do banco"}
DIR=$(cd "$(dirname "$0")/../../supabase" && pwd)

psql -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin create role maxhub login password '${SENHA//\'/\'\'}'; exception when duplicate_object then null; end \$\$;
-- papéis que os arquivos .sql citam nas permissões (vêm do Supabase; aqui ninguém entra com eles)
do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role service_role nologin; exception when duplicate_object then null; end \$\$;
SQL
createdb -O maxhub maxhub 2>/dev/null || echo "banco maxhub já existe (seguindo)"

# a ordem importa: cada arquivo usa o que os anteriores criaram
for f in schema estoque baixa_e_usuarios maxhub categorias max_aprendizado compras pedidos_e_notas \
         desligamento fornecedores compras_pedidos controle_rh contratos_e_devolucoes chamados indices; do
  [ -f "$DIR/$f.sql" ] || continue
  echo "→ $f.sql"
  psql -v ON_ERROR_STOP=1 -q -d maxhub -c "set role maxhub" -f "$DIR/$f.sql"
done
echo "Banco maxhub pronto."
