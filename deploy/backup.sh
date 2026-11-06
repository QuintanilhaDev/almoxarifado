#!/usr/bin/env bash
# Cópia de segurança diária do Max Hub: banco (pg_dump) + pasta de anexos.
# Guarda os últimos 14 dias em /var/backups/maxhub (ou BACKUP_DIR).
# Roda pelo maxhub-backup.timer (todo dia às 02:30). Para rodar na hora:
#   sudo systemctl start maxhub-backup
#
# Restaurar o banco:   sudo -u postgres pg_restore --clean --if-exists -d maxhub /var/backups/maxhub/banco-AAAAMMDD.dump
# Restaurar anexos:    sudo tar -xzf /var/backups/maxhub/anexos-AAAAMMDD.tar.gz -C /var/lib/maxhub
#
# IMPORTANTE: copie esta pasta para FORA do servidor também (outro disco, NAS da empresa…):
# backup que mora só na mesma máquina some junto se o disco der problema.
set -euo pipefail
DIR=${BACKUP_DIR:-/var/backups/maxhub}
DIAS=${BACKUP_DIAS:-14}
HOJE=$(date +%Y%m%d)
mkdir -p "$DIR" && chmod 700 "$DIR"

sudo -u postgres pg_dump --format=custom --file="$DIR/banco-$HOJE.dump.tmp" maxhub
mv "$DIR/banco-$HOJE.dump.tmp" "$DIR/banco-$HOJE.dump"
tar -czf "$DIR/anexos-$HOJE.tar.gz.tmp" -C /var/lib/maxhub arquivos
mv "$DIR/anexos-$HOJE.tar.gz.tmp" "$DIR/anexos-$HOJE.tar.gz"
chmod 600 "$DIR"/*

find "$DIR" -name 'banco-*.dump' -mtime +"$DIAS" -delete
find "$DIR" -name 'anexos-*.tar.gz' -mtime +"$DIAS" -delete
echo "Backup $HOJE: $(du -sh "$DIR/banco-$HOJE.dump" | cut -f1) de banco, $(du -sh "$DIR/anexos-$HOJE.tar.gz" | cut -f1) de anexos."
