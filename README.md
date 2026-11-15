# Guitar Practice Cloud — package étudiant

Ce dépôt contient uniquement les ressources nécessaires aux trois TP :
`backend/` et `frontend-starter/`, ainsi que les sujets et documents utiles.

## Prérequis

- Node.js 22 ou plus récent ;
- un compte MongoDB Atlas par binôme ;
- Git et un navigateur récent.
- Un IDE de qualité
- Recommandé : un abonnement à un 

Consulter [ATLAS_SETUP.md](ATLAS_SETUP.md) pour créer la base de données.

## Démarrer le backend

```bash
cd backend
cp .env.example .env
```

Renseigner dans `.env` l’URI MongoDB Atlas et le secret JWT. Ne jamais publier
ce fichier ni copier un secret dans le code Angular.

```bash
npm install
npm start
```

Le backend écoute normalement sur `http://localhost:3000`.

## Démarrer le frontend

Dans un autre terminal :

```bash
cd frontend-starter
npm install
npm start
```

Ouvrir `http://localhost:4200`. Le compte de démonstration est
`demo@example.com` / `Demo1234!`.

## Fonctionnalités du mini-projet (TP4)

À partir du prototype des TP1 à 3, l'application est devenue un mini réseau
social de partage de pistes audio :

- **recherche** de pistes par titre ou nom de fichier, et encart
  « Récemment ajoutés » ;
- **visibilité** de chaque piste : privée, tous mes amis ou publique ;
- **partage piste par piste** avec des amis choisis, et arrêt d'un partage
  (un ami, ou tous d'un coup) ;
- **réseau** : recherche d'utilisateurs, invitations, acceptation, refus,
  retrait d'un ami, fil d'activité des amis ;
- **fichiers** : téléchargement d'une piste, image de couverture enregistrée
  avec la piste ;
- **lecteur** : lecture et pause depuis chaque piste, visualiseur, balance,
  graves et aigus.

Le détail des choix techniques et des résultats de tests est dans
[REPORT.md](REPORT.md).

## Tests et build

```bash
cd backend
npm test

cd ../frontend-starter
npm test
npm run build
```

Les tests n'ont pas besoin de MongoDB.

## Documents de travail

- [REPORT.md](REPORT.md) : rapport du TP4 (travail effectué, choix techniques,
  fonctionnalités, résultats des tests) ;

- [SUJET_ETUDIANT_TP1.md](SUJET_ETUDIANT_TP1.md), [SUJET_ETUDIANT_TP2.md](SUJET_ETUDIANT_TP2.md) et [SUJET_ETUDIANT_TP3.md](SUJET_ETUDIANT_TP3.md) : missions des trois séances ;
- [API_CONTRACT.md](API_CONTRACT.md) : endpoints, authentification et formats échangés ;
- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) : contexte permanent à consulter et
  à mettre à jour avant chaque évolution ;
- [RAPPORT_IA_MODELE.md](RAPPORT_IA_MODELE.md) : modèle de compte rendu.
- [CONSEILS_POUR_UTIISER_ASSISTANT_AI.md](CONSEILS_POUR_UTIISER_ASSISTANT_AI.md) : utiliser correctement un assistant IA, quel que soit l’outil choisi.

Le backend contient également ses propres consignes pour les assistants :
[`backend/AGENTS.md`](backend/AGENTS.md), [`backend/CLAUDE.md`](backend/CLAUDE.md),
[`backend/GEMINI.md`](backend/GEMINI.md) et
[`backend/best-practices.md`](backend/best-practices.md). Elles couvrent
Node.js, Express, Mongoose, MongoDB, l’authentification, Multer, les uploads,
les logs et les tests.

Les fichiers audio présents dans `frontend-starter/fichiers-audio-de-test/` sont
des fixtures fournies pour les essais. Aucun fichier uploadé, dossier de
dépendances (`node_modules`), fichier `.env` ou identifiant local n’est inclus.
