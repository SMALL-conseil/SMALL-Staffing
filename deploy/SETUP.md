# Mise en ligne d'un nouvel outil SMALL — greffe sur le VPS mutualisé

Le VPS (/opt/small/deploy) fournit déjà : Traefik (TLS Let's Encrypt), PostgreSQL 16
partagé, réseaux `web`/`internal`, la porte BasicAuth préprod, les backups et le
registre GHCR. Mettre en ligne cet outil = le **greffer** dessus. ~30 min, une fois.

Prérequis : `scripts/rename-tool.ps1` déjà exécuté (le nom `staffing` remplacé
partout), le repo GitHub créé dans l'org avec son premier push.

## 1. DNS (IONOS — pas OVH)

Deux enregistrements A vers l'IP du VPS : `<outil>.small-conseil.com` et
`<outil>-preprod.small-conseil.com`.

## 2. Secrets GitHub du repo

Settings → Secrets and variables → Actions : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
(mêmes valeurs que les autres outils SMALL).

## 3. Sur le VPS (`ssh`, puis dans /opt/small/deploy)

```bash
# a) Base de données de l'outil (+ préprod)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U $POSTGRES_USER -d postgres \
  -c "CREATE DATABASE <outil>;" -c "CREATE DATABASE <outil>_preprod;"

# b) Variables centrales : ajouter au .env du VPS
#    <OUTIL>_IMAGE=ghcr.io/small-conseil/<outil>
#    DOMAIN_<OUTIL>=<outil>.small-conseil.com
#    DOMAIN_<OUTIL>_PREPROD=<outil>-preprod.small-conseil.com

# c) Fichiers d'env de l'outil (depuis le repo de l'outil, dossier deploy/)
#    -> copier <outil>.env.example  en /opt/small/deploy/<outil>.env  (chmod 600)
#    -> copier <outil>.preprod.env.example en /opt/small/deploy/<outil>.preprod.env
#    et remplir les CHANGEME (DATABASE_URL, AUTH_SECRET, SMTP...)

# d) Blocs de service : greffer le contenu de deploy/docker-compose.service.yml
#    (les 2 services) dans /opt/small/deploy/docker-compose.prod.yml

# e) Scripts de déploiement : copier
#    deploy/scripts/remote-deploy-<outil>.sh
#    deploy/scripts/remote-deploy-preprod-<outil>.sh
#    vers /opt/small/deploy/scripts/  (chmod +x)
```

⚠️ Pièges connus (payés par l'app Formation) :

- **Hash BasicAuth au format `{SHA}` uniquement** (jamais apr1/bcrypt) — les scripts
  sourcent le `.env` en bash et les `$` d'un hash apr1 cassent tout, y compris le
  backup nocturne. Générer : `printf '%s' 'Mdp' | openssl dgst -binary -sha1 | openssl base64`.
- **Le clone /opt/small ne se met pas à jour tout seul** : après toute modif des
  fichiers deploy/ d'un outil, re-copier les fichiers concernés sur le VPS.
- Ne jamais coller un bloc de commandes à la PREMIÈRE connexion SSH (les prompts
  avalent les lignes) : se connecter d'abord, coller ensuite.

## 4. Premier déploiement

```powershell
git checkout preprod ; git merge main ; git push origin preprod ; git checkout main
```

→ le workflow « Deploy Preprod » construit l'image et déploie la préprod.
Vérifier : `curl -u small:<mdp> https://<outil>-preprod.small-conseil.com/login` → 200.
Injecter les personas de recette : `scripts/seed-personas-preprod.sql` (garde-fou
anti-prod intégré). Puis, après recette : `git tag v0.1.0 ; git push origin v0.1.0`
→ production. **Le tag reste un geste humain.**

## 5. Données de préprod

Adapter `refresh-preprod-db.sh` de l'outil de référence (formation) si besoin d'un
rafraîchissement prod → préprod : DROP/CREATE `<outil>_preprod` + pg_dump de
`<outil>` + réinjection des personas. La prod n'est jamais touchée.
