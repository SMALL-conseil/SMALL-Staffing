@AGENTS.md

# SMALL Staffing — gabarit standard des outils internes SMALL

Application créée depuis le template `staffing-template` (framework SMALL Big Change).
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
- Fichier `proxy.ts` (ex-`middleware.ts`, renommage Next 16 — même rôle : porte
  d'authentification). À reporter dans small-app-template.
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
# créer la base : psql -U postgres -c "CREATE DATABASE staffing;"
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
dépose un bundle `staffing-*.bundle` dans le dossier `claude-bridge` du poste,
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

## Métier de l'outil

Réplique fidèle du classeur « Staffing SMALL Paris.xlsx » : seuls les 3 registres
sont saisis (consultants, siège, missions) — tout le reste se RECALCULE.

### Modèle (lot s1)

`Person` (kind CONSULTANT|SIEGE ; grade FINS de `lib/types.ts`, jamais aplati ;
name unique PAR kind — une personne peut être les deux, ex. Elvire HOUDEVILLE ;
boondId pour la synchro s4) · `LongAbsence` (fenêtres soustraites du staffable) ·
`Mission` (client, dates, part 0–1, `rank` = ordre de saisie — fait foi pour la
carte de staffing).

### Moteur `lib/staffing.ts` — réplique certifiée de l'Excel

Golden tests dans `tests/golden/` (`npm test`) : extraits du classeur de référence,
0 écart sur ses 6 221 cellules et vues au moment de l'autopsie. **Ne jamais faire
évoluer le moteur sans les faire passer.** Sémantiques héritées à connaître :

- **Lundi de Pentecôte TRAVAILLÉ** (journée de solidarité — mai 2026 = 18 j.o.).
  Fériés calculés par année du mois ; l'Excel applique ceux de l'année pilotée à
  toutes ses matrices — identique sur l'année affichée, le moteur est plus juste
  ailleurs.
- **Départ effectif d'un Indép = MAX(fins de ses missions)** (règle cachée de la
  matrice Staffable) ; sans mission, jamais staffable ; mais reste compté en
  TÊTES du Suivi_Effectif tant que le registre n'a pas de date de départ.
- **Staffés ≠ somme par mission** : étendue en j.o. du min(débuts) au max(fins)
  des missions chevauchant le mois (les trous entre missions sont pontés),
  × MAX(Σ parts au 1er, Σ parts au dernier, Σ parts incluses), plafonné au
  staffable. Trois cellules 2026 (Chiara BELLATI, Zoé MARQUOIN) en dépendent.
- **Taux salariés mensuel** : numérateur = staffés des non-Indép (Rookie inclus,
  bizarrerie assumée) ; **YTD** : hors Rookie ET Indép. Dénominateurs toujours
  hors Rookie + Indép.
- **Carte** : LE client du mois = 1re mission (rank) chevauchant le mois, si
  staffés > 0 ; périmètre = départ registre non antérieur au 1er janvier.
- **Grade siège hors liste** (« DG SMALL Bordeaux ») : importé tel quel, compté
  dans AUCUNE ligne ni total du Suivi_Effectif (fidèle Excel).

### Pages (s2/s3 — lecture pour tout connecté, sauf « Registres & admin »)

Tableau de bord `/accueil` (KPIs mois courant + YTD, graphe 12 mois, table
mensuelle), Carte de staffing `/carte?annee=YYYY` (grille consultant × mois,
« IC » = staffable sans mission, « — » = hors effectif, couleurs clients
stables par ordre de 1re apparition), Intercontrat `/intercontrat`, Effectifs
`/effectifs?annee=YYYY` (têtes par grade × 13 mois, grades hors grilles
comptés nulle part). Les pages ne calculent RIEN : tout vient de
`lib/staffing.ts` via `lib/staffing-load.ts` ; aides d'affichage (dates
murales Paris, formats fr, palette clients) dans `lib/staffing-ui.ts`.
Graphe = SVG maison (`components/TauxChart.tsx`) : trait plein jusqu'au mois
courant, pointillé = prévisionnel.

### Registres ADMIN (s3 — la saisie qui remplace l'Excel)

`/admin/missions` : CRUD missions (rank d'ordre de saisie attribué à la
création, JAMAIS modifié ensuite — il fait foi pour la carte). `/admin/personnes` :
consultants/siège en LECTURE (registre alimenté par import Excel puis synchro
Boond s4) + CRUD des absences prolongées. Pattern template : routes API
(`app/api/missions*`, `app/api/absences*`, gate ADMIN) + composants client
`fetch` + `router.refresh()`. Validation centralisée dans `lib/staffing-admin.ts`
(pur, testé — part accepte la virgule « 0,8 », fin d'absence vide = ouverte).

### Livraison en « local d'abord » (tant que le VPS n'est pas greffé)

`claude-bridge/appliquer-local.ps1` : merge le bundle dans `main` et pousse
main SEULEMENT — preprod n'est pas touchée, aucune CI de déploiement ne part.
`livrer-staffing.ps1` (main + preprod → CI préprod) reprend du service une
fois le VPS greffé (runbook : voir projet claude.ai, doc Avancement_s2).

### Import initial

`npx tsx scripts/import-excel.ts "<chemin du xlsx>" [--replace]` — importe les
3 registres + absences, relie les managers, puis affiche les KPIs recalculés
depuis la base (à comparer à l'Excel). `lib/staffing-load.ts` = passerelle
base → moteur (réutilisée par les pages).
