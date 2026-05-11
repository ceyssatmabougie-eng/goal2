# Goal 2

Application de planification pour construire les feuilles de route des mediateurs, optimiser les trajets et limiter a deux mediateurs par vehicule, avec authentification et base de donnees Supabase.

## Stack

- `React 19` + `Vite` + `TypeScript`
- `Supabase` pour l'authentification et la base
- `transport.data.gouv.fr` / `Clermont Auvergne Metropole` comme source GTFS T2C

## Demarrage

1. Installer les dependances :

   ```bash
   npm install
   ```

2. Verifier `.env.local`, deja prepare dans ce dossier.

3. Lancer l'application :

   ```bash
   npm run dev
   ```

4. Appliquer le schema Supabase :

   ```bash
   supabase db push
   ```

## Ce qui est en place

- Ecran de connexion Supabase avec mot de passe ou lien magique
- Tableau de bord metier `Goal 2`
- Structure metier pour mediateurs, vehicules, feuilles de route et imports GTFS
- Migration SQL avec RLS et contrainte bloquante a plus de deux mediateurs par vehicule
- References officielles GTFS T2C integrees dans l'interface

## Source GTFS T2C

- Dataset : https://transport.data.gouv.fr/datasets/syndicat-mixte-des-transports-en-commun-de-lagglomeration-clermontoise-smtc-ac-reseau-t2c-gtfs-gtfs-rt
- Export GTFS : https://opendata.clermontmetropole.eu/api/v2/catalog/datasets/gtfs-smtc/alternative_exports/gtfs
