#!/usr/bin/env bash
# ============================================================
#  Déploiement PRODUCTION de staffing (appelé par la CI via SSH — tags v*)
#  Usage :  bash scripts/remote-deploy-staffing.sh <tag>
#  À COPIER dans /opt/small/deploy/scripts/ sur le VPS (cf. SETUP.md).
#  Tire l'image GHCR, redémarre le service, healthcheck, rollback si KO.
# ============================================================
set -euo pipefail
TAG="${1:?tag}"
APP="staffing"
cd "$(dirname "$0")/.."                 # -> dossier deploy/ central du VPS
set -a; . ./.env; set +a
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ -f ./.ghcr.env ]; then
  set -a; . ./.ghcr.env; set +a
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
fi

STATE=".deployed_tag_${APP}"
PREV="$(cat "$STATE" 2>/dev/null || echo latest)"
echo "[deploy] ${APP} : ${PREV} -> ${TAG}"

deploy_tag () {
  export STAFFING_TAG="$1"
  $COMPOSE pull "$APP"
  $COMPOSE up -d "$APP"
}

deploy_tag "$TAG"

URL="https://${DOMAIN_STAFFING}/login"
ok=0
for i in $(seq 1 24); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' "$URL" || true)"
  case "$code" in 200|301|302|401) ok=1; break;; esac
  sleep 5
done

if [ "$ok" != "1" ]; then
  echo "[deploy] HEALTHCHECK KO -> rollback vers ${PREV}"
  deploy_tag "$PREV"
  exit 1
fi

echo "$TAG" > "$STATE"
docker image prune -f >/dev/null 2>&1 || true
echo "[deploy] OK : ${APP} en ${TAG}"
