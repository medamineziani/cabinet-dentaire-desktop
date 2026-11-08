# Cabinet Dentaire

Application Desktop Windows de gestion d'un cabinet dentaire. Fonctionne sans Internet : toutes les données restent sur le poste.

Dérivée du projet `cabinet-medical-saas`, qui reste inchangé dans son propre dossier.

## Démarrer

```bash
npm install
npm run db:generate
npm run dev
```

Double-clic : `Lancer-Cabinet-Dentaire.bat` (installe les dépendances au premier lancement).
Installation chez le cabinet : voir [INSTALLATION.md](INSTALLATION.md).

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | application en développement |
| `npm run typecheck` | vérification TypeScript |
| `npm test` | 22 tests d'intégration des règles métier |
| `npm run build` puis `node tests/e2e.mjs` | parcours complet dans la vraie application |
| `node tests/e2e-extra.mjs` | déplacement de rendez-vous, restauration, vues secrétaire |
| `npm run dist` | installateur Windows dans `release/` |

## Architecture

```
prisma/              schéma SQLite et migrations SQL
src/shared/          constantes, rôles et permissions, schémas Zod
src/main/            processus principal (seul à accéder à la base)
  db/                ouverture, migrations, client Prisma généré
  ipc/               routeur, contrôle session / permission / validation
  security/          session et verrouillage automatique
  services/          métier : auth, patients, clinical, finance, documents, insights, backup, settings
src/preload/         pont minimal (un seul canal IPC)
src/renderer/src/    React : pages, components, hooks, lib
tests/               tests d'intégration et de parcours
```

Chaque action passe par `dispatch` (`src/main/ipc/procedure.ts`) : liste blanche, session, permission du rôle, validation Zod. L'interface n'accède jamais à la base.

Types de l'API : déduits du routeur (`src/main/ipc/router.ts`), rien à déclarer deux fois. Pour ajouter une action : l'écrire dans un service avec `proc({ access, input, run })`.

Migrations : ajouter `prisma/migrations/000N_nom.sql` (via `prisma migrate diff`). Elles s'appliquent au démarrage, dans une transaction.

## Rôles

| | Administrateur | Dentiste | Secrétaire |
|---|---|---|---|
| Patients, rendez-vous, factures, stock | oui | oui | oui |
| Dossier médical, consultations, odontogramme | oui | oui | **non** |
| Dépenses | oui | lecture | saisie |
| Annuler une facture | oui | selon paramètres | non |
| Statistiques | oui | oui | non |
| Personnel, paramètres, sauvegardes, journal | oui | non | non |

La matrice complète est dans `src/shared/permissions.ts`.

## Sécurité

- Aucun compte par défaut : l'administrateur est créé au premier lancement.
- Mots de passe hachés (bcrypt, coût 12). Blocage 15 min après 5 échecs. Verrouillage après 30 min d'inactivité.
- Electron : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP, requêtes réseau externes bloquées.
- Requêtes SQL paramétrées par Prisma. Contenu des PDF échappé.
- Sauvegardes : AES-256-GCM, clé dérivée par scrypt. Phrase secrète gardée par le coffre Windows pour les sauvegardes automatiques.
- Journal des actions : qui, quoi, quand, sans contenu médical.

**La base SQLite de travail n'est pas chiffrée sur le disque.** Activez BitLocker sur le poste du cabinet.

## Conformité

Ce logiciel n'est **pas certifié** et aucune conformité n'est revendiquée. Il fournit des moyens (contrôle d'accès, journal, sauvegardes chiffrées, données locales). La conformité à la loi marocaine 09-08 (CNDP), au RGPD le cas échéant, et aux règles sur les données de santé reste à vérifier par le cabinet avec un conseil spécialisé.

## Limites connues

- Mono-poste : la base n'est pas partagée entre plusieurs ordinateurs.
- Installateur non signé : Windows SmartScreen affiche un avertissement au premier lancement.
- Pas d'icône personnalisée : déposer `resources/icon.ico` pour en ajouter une.
