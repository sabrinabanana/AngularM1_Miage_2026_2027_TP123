# Guitar Practice Cloud - Contexte permanent du projet

> Document de référence à consulter avant toute modification.  
> Dernière mise à jour : 15 novembre 2026.

## Règle de maintenance

Ce fichier doit être mis à jour à chaque évolution importante du projet :

- nouvelle ou modification de route HTTP ;
- changement de modèle MongoDB ou de contrat JSON ;
- nouvelle fonctionnalité frontend ;
- changement de commande de démarrage, de test ou de build ;
- modification de l'authentification, des permissions ou des fichiers manipulés.

Après chaque changement, actualiser la date et ajouter une ligne dans
« Historique des mises à jour ». Ne pas y placer de mot de passe, de JWT,
d'URI MongoDB ou de contenu issu d'un fichier `.env`.

## Vue d'ensemble

Guitar Practice Cloud est une application Angular + Express + MongoDB orientée
pratique et partage de pistes audio.

```text
frontend-starter/   Application Angular
backend/            API Express et modèles Mongoose
backend/data/uploads/
                    Fichiers audio stockés sur disque
MongoDB Atlas       Utilisateurs et métadonnées des pistes
```

Les octets audio ne sont pas stockés dans MongoDB. Le document `Track` conserve
le nom technique du fichier, qui reste masqué par défaut, ainsi que ses
métadonnées.

## Comprendre le stockage et un futur déploiement cloud

### Fonctionnement actuel en local

Lorsqu'un utilisateur téléverse un son, le frontend Angular envoie le fichier
au backend Express avec `POST /api/tracks`. Le backend écrit actuellement les
octets dans `backend/data/uploads/`, sur le disque de la machine qui exécute le
backend. MongoDB Atlas conserve seulement les informations nécessaires pour
retrouver la piste : titre, propriétaire, type, taille, visibilité et nom
technique du fichier.

Lors d'une lecture, Angular demande `GET /api/tracks/:id/audio`. Le backend
vérifie l'authentification et les droits, retrouve le fichier sur son disque,
puis le renvoie au navigateur. Une piste privée est réservée à son propriétaire
; une piste publique peut être lue par tout utilisateur authentifié.

Cela signifie que la visibilité publique est gérée par l'API, mais que la
disponibilité du fichier dépend encore de la machine du backend. Si cette
machine est éteinte, si le backend est arrêté ou si son dossier
`data/uploads/` est perdu, MongoDB peut encore contenir la métadonnée alors que
le son lui-même est introuvable.

### Faut-il plusieurs clouds ?

Il ne faut pas obligatoirement trois fournisseurs cloud différents. Il faut
plutôt distinguer trois rôles, qui peuvent être hébergés chez un seul
fournisseur ou chez plusieurs services spécialisés :

1. **Frontend Angular** : les fichiers JavaScript, HTML et CSS construits par
   `ng build`. Il peut être hébergé sur un service de pages statiques.
2. **Backend Express** : le serveur qui exécute les routes, vérifie les JWT,
   applique les permissions et communique avec MongoDB. Il doit être hébergé
   sur un service capable d'exécuter Node.js.
3. **Fichiers audio** : un stockage persistant, de préférence un stockage
   objet comme Amazon S3, Cloudflare R2, Google Cloud Storage, Azure Blob
   Storage ou Cloudinary. Il est séparé du disque temporaire du serveur.

MongoDB Atlas est déjà un service cloud pour les utilisateurs et les
métadonnées. Une architecture finale possible est donc :

```text
Navigateur
   |
   v
Frontend Angular hébergé
   |
   v
Backend Express hébergé
   |                  \
   v                   v
MongoDB Atlas       Stockage objet audio
```

Le frontend et le backend peuvent être déployés chez le même fournisseur ou
chez deux fournisseurs différents. Le stockage audio peut également être
fourni par le même cloud, mais il doit rester un espace de stockage persistant
distinct du système de fichiers local du serveur. Le choix dépendra du prix,
des limites de stockage, de la simplicité et des exigences du projet.

### Décision pour le projet

Pour les développements et démonstrations locales, le dossier
`backend/data/uploads/` reste suffisant. En fin de projet, nous pourrons
envisager un déploiement cloud complet : frontend Angular hébergé, backend
Express hébergé, MongoDB Atlas et stockage objet persistant pour les fichiers
audio. Cette migration sera une étape séparée ; elle nécessitera notamment de
remplacer l'écriture locale par un envoi vers le stockage objet et de conserver
dans MongoDB une clé ou une référence vers ce fichier.

## Démarrage local

Prérequis : Node.js 22 ou plus récent, MongoDB Atlas et Git.

Backend :

```bash
cd backend
cp .env.example .env
# renseigner MONGODB_URI et éventuellement JWT_SECRET dans .env
npm install
npm start
```

Le backend écoute sur `http://localhost:3000`.

Frontend, dans un second terminal :

```bash
cd frontend-starter
npm install
npm start
```

Le frontend écoute sur `http://localhost:4200` et utilise
`proxy.conf.json` pour transmettre `/api` au backend.

Compte de démonstration : `demo@example.com` / `Demo1234!`.

## Commandes de validation

```bash
cd backend
npm test

cd ../frontend-starter
npm test
npm run build
```

## Architecture backend

Fichiers principaux :

- `backend/src/server.js` : connexion MongoDB, préparation du compte de
  démonstration et démarrage du serveur ;
- `backend/src/app.js` : middleware, authentification JWT, routes, uploads et
  gestion des erreurs ;
- `backend/src/models/User.js` : utilisateur et hash bcrypt ;
- `backend/src/models/Track.js` : métadonnées audio et visibilité ;
- `backend/test/api.test.js` : tests Node natifs de l'API et des schémas.

### Authentification

Les routes protégées exigent :

```text
Authorization: Bearer <JWT>
```

Le JWT contient l'identifiant utilisateur dans `sub`. Le secret reste
uniquement dans le backend. Les mots de passe sont hachés avec bcrypt et le
champ `passwordHash` n'est pas sélectionné par défaut.

### Routes HTTP

Base : `http://localhost:3000/api`.

| Méthode | Route | Authentification | Corps / paramètres | Résultat |
|---|---|---|---|---|
| GET | `/health` | Non | Aucun | `{ status: "ok" }` |
| POST | `/auth/register` | Non | JSON : `name`, `email`, `password` | `201 { token, user }` |
| POST | `/auth/login` | Non | JSON : `email`, `password` | `200 { token, user }` |
| GET | `/users/me` | Oui | Aucun | Profil courant |
| PUT | `/users/me` | Oui | JSON : `name` | Profil mis à jour |
| GET | `/tracks?page=1&limit=5` | Oui | Pistes du propriétaire courant | Page de pistes personnelles |
| GET | `/tracks?page=1&limit=5&public=true` | Oui | Pistes avec `isPublic: true` | Page de pistes publiques |
| POST | `/tracks` | Oui | Multipart : `audio`, `title`, `isPublic` | `201 Track` |
| GET | `/tracks/:id/audio` | Oui | Aucun | Flux audio si propriétaire ou piste publique |
| DELETE | `/tracks/:id` | Oui | Aucun | `204` si la piste appartient à l'utilisateur |

Les listes paginées ont la forme :

```json
{
  "items": [],
  "page": 1,
  "limit": 5,
  "total": 0,
  "pages": 1
}
```

Formats audio acceptés : MP3, WAV, OGG et M4A, avec une taille maximale de
25 Mo.

### Modèle `Track`

| Champ | Type | Règle |
|---|---|---|
| `ownerId` | ObjectId | Utilisateur propriétaire, obligatoire |
| `title` | String | Obligatoire, nettoyé |
| `originalName` | String | Nom d'origine du fichier |
| `storedName` | String | Nom technique local, non exposé par défaut |
| `mimeType` | String | Type MIME audio |
| `size` | Number | Taille en octets |
| `isPublic` | Boolean | `false` par défaut |
| `createdAt`, `updatedAt` | Date | Gérés par Mongoose |

Une piste privée n'est lisible que par son propriétaire. Une piste publique peut
être listée dans Explorer et son audio peut être lu par tout utilisateur
authentifié. La suppression reste réservée au propriétaire.

## Architecture frontend

Routes Angular :

| URL | Composant | Protection |
|---|---|---|
| `/` | Redirection vers `/tracks` | - |
| `/login` | `LoginPageComponent` | Publique |
| `/register` | `RegisterPageComponent` | Publique |
| `/tracks` | `TracksPageComponent` | `authGuard` |
| `/profile` | `ProfilePageComponent` | `authGuard` |

Fichiers importants :

- `src/app/routes.ts` : routes Angular ;
- `src/app/components/app/` : navigation et mode clair/sombre ;
- `src/app/components/tracks-page/` : upload, pagination, exploration, lecture
  et suppression ;
- `src/app/shared/services/auth.service.ts` : session et profil ;
- `src/app/shared/services/track.service.ts` : appels HTTP des pistes ;
- `src/app/shared/interceptors/auth.interceptor.ts` : ajout du JWT ;
- `src/app/shared/models/` : types échangés avec l'API ;
- `src/styles.css` : styles globaux et thèmes.

`TracksPageComponent` utilise des Angular Signals pour l'état de chargement,
les erreurs, la pagination, les pistes, la visibilité et la lecture audio.
`TrackService.list(page, limit, publicOnly)` transmet le filtre public ;
`TrackService.upload(file, title, visibility)` transmet `visibility` dans le
`FormData` et conserve `isPublic` pour compatibilité avec les anciennes
réponses.

La page `/friends` utilise `FriendService` pour rechercher des utilisateurs,
envoyer des invitations, afficher les demandes envoyées et reçues, accepter ou
refuser des demandes et retirer une amitié. Les pistes peuvent avoir
`visibility` égal à `private`, `public` ou `friends`;
`GET /api/tracks?friends=true` affiche les pistes réservées aux amis acceptés.

## Conventions à préserver

- Ne jamais journaliser de mot de passe, JWT, secret ou URI MongoDB.
- Garder les autorisations côté backend : le frontend ne constitue pas une
  protection suffisante.
- Conserver les types Angular synchronisés avec les réponses API.
- Mettre à jour les tests lorsqu'un contrat ou un comportement change.
- Utiliser les styles et les variables de thème existants afin de garder tous
  les textes lisibles en mode clair et sombre.
- Documenter les changements fonctionnels dans `RAPPORT_IA_MODELE.md` et
  mettre à jour ce fichier de contexte.

## Documents associés

- [README.md](README.md) : installation rapide ;
- [API_CONTRACT.md](API_CONTRACT.md) : contrat HTTP ;
- [RAPPORT_IA_MODELE.md](RAPPORT_IA_MODELE.md) : journal des travaux ;
- [ATLAS_SETUP.md](ATLAS_SETUP.md) : configuration MongoDB Atlas ;
- `backend/AGENTS.md`, `backend/CLAUDE.md`, `backend/GEMINI.md` : consignes
  spécifiques du backend.

## Historique des mises à jour

### 14 octobre 2026

- Création de ce document de contexte permanent.
- Documentation de l'architecture Angular, Express et MongoDB.
- Documentation des routes d'authentification, de profil et de pistes.
- Documentation de la gestion publique/privée, des commandes et des règles de
  maintenance.
- Explication du stockage local actuel des fichiers audio et de ses limites.
- Ajout d'une piste d'évolution possible vers un déploiement cloud en fin de
  projet, avec séparation des rôles frontend, backend et stockage audio.
- Renforcement du parsing de `isPublic` lors d'un upload pour accepter les
  valeurs booléennes et les valeurs de formulaire courantes.
- Liaison de la case de visibilité à un signal Angular alimenté directement
  par `event.target.checked`, afin de garantir la valeur envoyée à l'API.
- Après une modification backend, arrêter puis redémarrer le processus
  `npm start` déjà actif : un simple rebuild frontend ne recharge pas
  `backend/src/app.js`.
- Le lecteur audio utilise la WebAudio API : source média, filtre graves,
  filtre aigus, panoramique stéréo et `AnalyserNode`, avec visualiseur canvas.
- La Mission 3 ajoute le modèle `Friendship`, les routes `/api/friends/*`, la
  recherche `/api/users/search` et la visibilité `friends` des pistes.
- L'identité affichée vient de `/api/users/me` ou de `user` dans la réponse de
  login/register (`id`, `name`, `email`, `createdAt`). Le JWT contient `sub` et
  `email` pour l'authentification, mais le frontend utilise `/api/users/me`
  comme source de profil à jour.
- La recherche d'utilisateurs est exclusivement backend, authentifiée,
  limitée à 20 résultats, limitée à 80 caractères, insensible à la casse,
  échappée contre les regex et exclut l'utilisateur courant. Le frontend
  déclenche cette route via `FriendService` avec un debounce de 300 ms.
- L'audit Mission 3 a été réalisé : le JWT contient `sub` et `email`, le
  profil complet vient de `/api/users/me`, et les projections utilisateur
  excluent `passwordHash`.
- 15 novembre 2026, TP4 (détails dans `REPORT.md`, contrat dans
  `API_CONTRACT.md`) : recherche de pistes (`q`) et `/api/tracks/recent` ;
  partage piste par piste (`Track.sharedWith`, `PATCH /api/tracks/:id`,
  `DELETE /api/tracks/:id/shares/:userId`) ; fil `/api/friends/activity` ;
  téléchargement (`?download=true`) et couverture (`cover`,
  `/api/tracks/:id/cover`). Nouveaux composants Angular :
  `track-share-editor` et `track-cover`.
