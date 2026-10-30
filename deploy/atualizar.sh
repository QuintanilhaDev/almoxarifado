#!/usr/bin/env bash
# Publica a versão mais nova do Max Hub no servidor próprio.
#
# Cada versão é montada numa pasta separada (releases/<commit>) e só entra no ar
# depois do build terminar sem erro. Assim o sistema não fica fora do ar durante
# o build, e voltar para a versão anterior é só rodar:  atualizar.sh voltar
#
# Uso:
#   sudo -u maxhub /opt/maxhub/atualizar.sh          # publica o último commit da main
#   sudo -u maxhub /opt/maxhub/atualizar.sh voltar   # volta para a versão anterior
#   sudo -u maxhub /opt/maxhub/atualizar.sh --se-mudou  # só publica se houver commit novo (para o timer)
set -euo pipefail

BASE=/opt/maxhub
REPO=https://github.com/QuintanilhaDev/almoxarifado.git
BRANCH=main
MANTER=3 # quantas versões antigas guardar

cd "$BASE"
mkdir -p releases

reiniciar() {
  sudo /usr/bin/systemctl restart maxhub
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/login; then
      echo "Max Hub no ar: $(readlink current)"
      return 0
    fi
    sleep 2
  done
  echo "O sistema não respondeu depois de reiniciar. Veja: journalctl -u maxhub -n 100" >&2
  return 1
}

if [ "${1:-}" = "voltar" ]; then
  atual=$(readlink -f current)
  anterior=$(ls -1dt releases/*/ | sed 's:/$::' | while read -r d; do
    [ "$(readlink -f "$d")" != "$atual" ] && echo "$d" && break
  done)
  [ -n "$anterior" ] || { echo "Não há versão anterior guardada." >&2; exit 1; }
  ln -sfn "$anterior" current
  reiniciar
  exit 0
fi

sha=$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -c1-12)
[ -n "$sha" ] || { echo "Não consegui ler o GitHub." >&2; exit 1; }

if [ "${1:-}" = "--se-mudou" ] && [ "$(basename "$(readlink -f current 2>/dev/null || echo nada)")" = "$sha" ]; then
  exit 0
fi

destino="releases/$sha"
if [ ! -f "$destino/.next/BUILD_ID" ]; then
  rm -rf "$destino"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$destino"
  # as variáveis NEXT_PUBLIC_* entram no build, então o .env precisa estar lá antes
  ln -s "$BASE/.env.production" "$destino/.env.production"
  (cd "$destino" && npm ci --no-audit --no-fund && npm run build)
fi

ln -sfn "$destino" current
reiniciar

# limpa as versões mais antigas, guardando a atual e as $MANTER mais recentes
atual=$(readlink -f current)
ls -1dt releases/*/ | sed 's:/$::' | tail -n +$((MANTER + 1)) | while read -r d; do
  [ "$(readlink -f "$d")" != "$atual" ] && rm -rf "$d"
done
