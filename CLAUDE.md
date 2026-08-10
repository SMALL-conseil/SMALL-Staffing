@AGENTS.md

# SMALL App — gabarit standard des outils internes SMALL

Application créée depuis le template `small-app-template` (framework SMALL Big Change).
Ce fichier documente l'invariant du framework : stack, conventions, charte, workflow de
livraison, et les pièges déjà rencontrés sur les outils précédents. Compléter la section
« Métier » au fil du développement de l'outil.

## Stack technique (NE PAS dévier sans décision d'équipe)

- **Next.js 16** (App Router) + TypeScript, React 19
- **Prisma 5.22** + **PostgreSQL** — ⚠️ Prisma volontairement figé en 5.22 (pas v7) ;
  migrations versionnées dans `prisma/migrations/`, appliquées par `prisma migrate deploy`
  au démarrage du conteneur (`deploy/app/entrypoint.sh`)
- **NextAuth v5 (beta 31)** — sessions JWT, Credentials (email/mdp) + Microsoft Entra ID
  optionnel (variables vides = bouton Microsoft inactif ; le SSO n'accepte que les comptes
  déjà en base)
- **Tailwind CSS v4** — composants custom (pas de Shadcn/UI), thème **Brume** dans
  `app/globals.css` (tokens + classes `card`, `btn`, `badge`, `kicker`, `titre-page`,
  `titre-formation`, `titre-section`, `hl`, `field-input`…)
- `nodemailer` (gabarit email de marque dans `lib/email.ts`), `ical-generator`, `xlsx`,
  `date-fns`, `lucide-react` (icônes outline)

## Conventions du framework

- **Champs « énumérés » en String** côté Prisma, pseudo-enums dans `lib/types.ts`
  (`Role`…). Commentaires Prisma : `//` ou `///` uniquement, jamais `/* */`.
- ⚠️ **Toute évolution du schéma = une migration versionnée** (jamais `prisma db push`
  hors bac à sable local). Vérification après chaque évolution :
  `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma`
  → « No difference detected ».
- Rôles : gates serveur dans chaque page/route admin (`session.user.role !== "ADMIN"` →
  redirect/403) ; navigation par rôle dans `components/Sidebar.tsx` ; anti-verrouillage
  sur son propre rôle Admin (`app/api/users/[id]`).
- Heures « murales » Europe/Paris : le conteneur tourne en UTC — tout affichage d'heure
  passe par un formatteur à timeZone explicite (`lib/utils.ts`), et tout ICS utilise
  `floating: true`.
- Emails : `SMTP_USER`/`SMTP_PASS` vides = envois « simulés » loggés (mécanisme
  d'étanchéité préprod — à conserver) ; `SMTP_FROM` = même adresse que `SMTP_USER`,
  chevron `>` final obligatoire. ⚠️ Auth SMTP basique coupée par Microsoft fin 2026 →
  prévoir la bascule Graph `sendMail`.

## Charte graphique SMALL (thème Brume — déjà câblée dans globals.css)

Blanc #FFFFFF · Anthracite rgb(30,31,28) · Gris moyen rgb(172,172,171) ·
Jaune fluo #DAFF00 (accents/CTA) · Vieux rose rgb(211,183,171) · Beiges
rgb(240,213,189)/rgb(249,238,228) · Crème rgb(255,247,239) · Gris foncé rgb(121,120,108).
Titres : Libre Caslon Text (700 normal ; l'italique n'existe qu'en 400 → intertitres).
Corps : Trebuchet MS. Icônes outline (lucide). Contrastes WCAG AA (gris texte #68675C+).
Adresse : 28 Place Saint Georges, 75009 Paris (jamais l'ancienne adresse Malesherbes).

## Démarrer en local

```powershell
npm ci ; npx prisma generate
# créer la base : psql -U postgres -c "CREATE DATABASE small_app;"
cp .env.example .env   # puis remplir DATABASE_URL
npx prisma migrate deploy ; npx tsx prisma/seed.ts
npm run dev            # http://localhost:3000
```

Comptes seed : `admin@small-conseil.fr` / `membre@small-conseil.fr` (mdp `Smallchange2024!`).
⚠️ Le seed n'est pas déclaré dans package.json : `npx tsx prisma/seed.ts`, pas `prisma db seed`.

## Workflow de livraison (identique pour tous les outils SMALL)

On ne pousse JAMAIS directement en production :
1. dev + commit sur `main`
2. `git checkout preprod ; git merge main ; git push ; git checkout main`
   → CI « Deploy Preprod » → préprod (BasicAuth équipe) → recette (personas)
3. après validation : `git tag vX.Y.Z ; git push origin vX.Y.Z` → production.
   **Le tag v\* est un geste humain — jamais posé par un script ni par Claude.**

Livraison assistée par Claude : Claude développe dans son sandbox (build vérifié),
dépose un bundle `small-app-*.bundle` dans le dossier `claude-bridge` du poste,
double-clic sur `livrer.ps1` (fourni dans `claude-bridge/` de ce repo). GitHub fait
foi ; le bundle est la valise de Claude, jamais un mécanisme de synchro.

## Pièges déjà payés sur les outils SMALL (à lire une fois)

- Repo local **hors OneDrive**, toujours (verrous `.git\index.lock`, restaurations
  intempestives). Convention : `C:\Dev\<outil>`.
- Windows : arrêter `npm run dev` avant `npx prisma generate` (EPERM sur le moteur
  Prisma verrouillé) ; PowerShell enchaîne les `;` même après un échec — lire les
  sorties intermédiaires.
- Hash BasicAuth préprod : format `{SHA}` obligatoire (jamais apr1/bcrypt) — les `$`
  cassent les scripts du VPS qui sourcent le `.env`.
- Le clone `/opt/small` du VPS ne se met pas à jour tout seul : toute modif de
  `deploy/` doit être recopiée sur le VPS.
- Healthcheck préprod : le 401 de la porte BasicAuth est émis par Traefik avant l'app —
  vérif fiable = `curl -u small:<mdp> .../login` (attendu 200).
- Sandbox Claude : npm registry bloqué → `npm ci --registry=https://registry.yarnpkg.com` ;
  vérifier une bascule de version préprod via une **route introduite par le lot**
  (404→403), pas via l'empreinte des assets de /login.
- Rôles applicatifs : jamais écrasés par une éventuelle synchro externe ; après
  reconstruction de base, les reposer via `/admin/utilisateurs`.

## Métier de l'outil (à compléter)

_Décrire ici les modèles, pages et règles métier au fur et à mesure — c'est la partie
de ce fichier qui appartient à l'outil, tout ce qui précède appartient au framework._
