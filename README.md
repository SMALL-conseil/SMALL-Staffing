# staffing-template — gabarit des outils internes SMALL

Socle standard du framework SMALL Big Change : Next.js 16 + Prisma/PostgreSQL +
NextAuth (email/mdp + SSO Microsoft optionnel) + charte graphique Brume + chaîne de
déploiement complète (préprod sur la branche `preprod`, production sur les tags `v*`,
VPS mutualisé Docker/Traefik). Créer un nouvel outil = **10 minutes de personnalisation,
~30 minutes de mise en ligne.**

## Créer un nouvel outil

1. **GitHub → « Use this template »** → nouveau repo dans l'org `SMALL-conseil`
   (nom en kebab-case, ex. `veille-ia`).
2. Cloner **hors OneDrive** : `git clone https://github.com/SMALL-conseil/<outil>.git C:\Dev\<outil>`
3. **Personnaliser** (remplace `staffing` partout + renomme les fichiers porteurs) :
   ```powershell
   cd C:\Dev\<outil>
   .\scripts\rename-tool.ps1 -Name "<outil>" -DisplayName "<Nom affiché>"
   git add -A ; git commit -m "chore: personnalisation du gabarit" ; git push
   ```
4. **Dev local** : voir `CLAUDE.md` § « Démarrer en local » (PostgreSQL 16, `.env`,
   migrations, seed, `npm run dev`). Comptes démo : `admin@small-conseil.fr` /
   `membre@small-conseil.fr` (mdp `Smallchange2024!`).
5. **Mise en ligne** : dérouler `deploy/SETUP.md` (DNS IONOS, secrets GitHub Actions,
   greffe sur le VPS mutualisé, premier déploiement préprod, personas de recette).

## Ce que le gabarit contient

- **Charte Brume** prête (tokens, typos Libre Caslon/Trebuchet, composants) —
  pages d'exemple : accueil (cartes KPI), gestion des utilisateurs avec rôles
  (ADMIN/MEMBER, anti-verrouillage), emplacement reporting.
- **Auth** : formulaire email/mdp + bouton Microsoft Entra ID (optionnel, comptes
  préexistants uniquement), middleware de protection globale.
- **Base** : schéma User minimal + migration versionnée + seed ; conventions Prisma
  du framework (String pseudo-enums, migrations obligatoires).
- **Emails** : socle SMTP O365 avec mode « simulé » (préprod) + gabarit HTML de marque.
- **Déploiement** : Dockerfile multi-stage, workflows CI préprod/prod, scripts de
  déploiement avec healthcheck + rollback, BasicAuth préprod, personas SQL, envs par
  environnement.
- **Workflow Claude** : `claude-bridge/livrer.ps1` + `tester.ps1` (livraison par bundle
  en un double-clic), `CLAUDE.md` chargé de tous les pièges déjà payés.

## Règles d'or (détail dans CLAUDE.md)

Jamais de push direct en prod — `main` → `preprod` (CI auto) → recette → tag `v*`
(geste humain). Toute évolution de schéma = migration versionnée. Repo hors OneDrive.
GitHub fait foi.
