#!/usr/bin/env bash
# ============================================================
#  Déploiement PRÉPROD de staffing (appelé par la CI — branche "preprod")
#  Usage :  bash scripts/remote-deploy-preprod-staffing.sh <tag>
#  À COPIER dans /opt/small/deploy/scripts/ sur le VPS (cf. SETUP.md).
#  Volontairement séparé du chemin de production : service *-preprod,
#  variable STAFFING_PREPROD_TAG, healthcheck préprod, rollback si KO.
#  NB : le 401 de la porte BasicAuth est émis par Traefik AVANT l'app — un
#  conteneur KO peut passer ce healthcheck. Vérif fiable :
#  curl -u small:<mdp> https://<domaine-preprod>/login  (attendu 200).
# ============================================================
set -euo pipefail
TAG="${1:?tag}"
APP="staffing-preprod"
cd "$(dirname "$0")/.."                 # -> dossier deploy/ central du VPS
set -a; . ./.env; set +a
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ -f ./.ghcr.env ]; then
  set -a; . ./.ghcr.env; set +a
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
fi

STATE=".deployed_tag_${APP}"
PREV="$(cat "$STATE" 2>/dev/null || echo "")"
echo "[preprod] ${APP} : ${PREV:-(premier déploiement)} -> ${TAG}"

deploy_tag () {
  export STAFFING_PREPROD_TAG="$1"
  $COMPOSE pull "$APP"
  $COMPOSE up -d "$APP"
}

deploy_tag "$TAG"

URL="https://${DOMAIN_STAFFING_PREPROD}/login"
ok=0
for i in $(seq 1 24); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' "$URL" || true)"
  case "$code" in 200|301|302|401) ok=1; break;; esac
  sleep 5
done

if [ "$ok" != "1" ]; then
  if [ -n "$PREV" ]; then
    echo "[preprod] HEALTHCHECK KO -> rollback vers ${PREV}"
    deploy_tag "$PREV"
  else
    echo "[preprod] HEALTHCHECK KO (premier déploiement : pas de rollback possible)"
    echo "[preprod] Vérifier : DNS propagé ? staffing.preprod.env créé ? base staffing_preprod initialisée ?"
  fi
  exit 1
fi

echo "$TAG" > "$STATE"
docker image prune -f >/dev/null 2>&1 || true
echo "[preprod] OK : ${APP} en ${TAG}"
