#!/bin/sh
set -e

echo "[staffing] Application des migrations Prisma..."
# Applique les migrations versionnées. Pour un tout premier démarrage sans
# migrations versionnées (déconseillé), remplacer temporairement par :
#   npx prisma db push
npx prisma migrate deploy
echo "[staffing] Démarrage de Next.js sur le port 3000..."
exec npm run start
