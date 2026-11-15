# Rapport TP4 : mini-projet Guitar Practice Cloud

> Rapport mis à jour à chaque mission. Dernière mise à jour : 15 novembre 2026 (missions 1 à 4).

## 1. Point de départ (fin du TP3)

Déjà en place avant le TP4 :

- authentification JWT (inscription, connexion, profil), mots de passe hachés avec bcrypt ;
- upload audio avec Multer (MP3, WAV, OGG, M4A, 25 Mo maximum), barre de progression, lecture en Blob, suppression ;
- pagination avec Angular Material, onglets « Mes pistes » et « Explorer les pistes publiques » ;
- lecteur WebAudio : visualiseur de spectre, balance stéréo, graves et aigus ;
- début du réseau social : modèle `Friendship`, recherche d'utilisateurs, invitation, acceptation, refus, retrait d'un ami, visibilité `friends` et onglet « Pistes de mes amis ».

## 2. Orientation du projet

Le projet garde son identité **musicale** (application de pratique de la guitare) et y ajoute une
couche de **partage social**, ce qui répond aux exigences « fichiers publics / privés » du sujet.

### Fonctionnalités visées

| Exigence du sujet | État |
|---|---|
| Un fichier public peut être recherché par tout le monde | ✅ Mission 1 |
| Afficher les « fichiers récemment ajoutés » | ✅ Mission 1 |
| Rechercher des fichiers (« search files ») | ✅ Mission 1 |
| Fichier privé partageable avec des amis | ✅ Mission 2 (amis choisis ou tous les amis) |
| Inviter / ajouter / supprimer des amis | ✅ (avant le TP4) |
| Gérer et arrêter un partage | ✅ Mission 2 |
| Voir l'activité des amis | ✅ Mission 3 |
| Upload / download de fichiers + autres données de formulaire | ✅ Mission 4 (téléchargement, image de couverture) |

### Découpage du travail

1. **Mission 1 : recherche et récemment ajoutés** (terminée, voir ci-dessous).
2. **Mission 2 : partage piste par piste** (terminée, voir section 4).
3. **Mission 3 : activité des amis** (terminée, voir section 5).
4. **Mission 4 : téléchargement, couverture et badges** (terminée, voir section 6).
5. **Mission 5 (bonus, non réalisée) : déploiement cloud** (voir `PROJECT_CONTEXT.md`).

## 3. Mission 1 : recherche de fichiers et récemment ajoutés

### Interface

- Page `/tracks` : nouvelle carte **« Récemment ajoutés »** en haut, sous forme de grille de petites
  cartes (titre, propriétaire, date, visibilité, bouton ▶ pour lire directement).
- Champ **« Rechercher une piste »** sous les onglets : la recherche s'applique à l'onglet courant
  (mes pistes, publiques ou amis) et reste active quand on change d'onglet. Bouton « Effacer ».
- Dans les onglets Publiques et Amis, chaque piste affiche **« Par &lt;nom&gt; »**.
- Message dédié quand aucune piste ne correspond à la recherche.

### Choix techniques

- **Backend.** La logique des filtres est sortie de la route sous forme de fonctions pures exportées
  (`buildSearchCondition`, `buildTrackFilter`, `buildRecentFilter`, `toTrackResponse`). On peut ainsi
  les tester sans MongoDB, comme `parsePublicFlag`.
- **Recherche** par regex insensible à la casse sur `title` et `originalName`. La saisie est échappée
  (pas d'injection de regex), limitée à 80 caractères, et combinée à la portée avec `$and` : la
  recherche ne peut jamais élargir les droits d'accès.
- **Nom du propriétaire** obtenu avec `populate("ownerId", "name")` : seul le nom est exposé, jamais
  l'email ni le hash.
- **Récents** : `GET /api/tracks/recent` renvoie les pistes publiques et les pistes « amis » des amis
  acceptés, sans les pistes de l'utilisateur, triées par `createdAt` décroissant (index existant).
- **Frontend.** La recherche utilise un `FormControl` (Reactive Forms) avec `debounceTime(300)` et
  `distinctUntilChanged`, et `takeUntilDestroyed` pour éviter les fuites d'abonnement. Une nouvelle
  recherche revient toujours à la page 1.
- Une regex est suffisante à cette échelle ; avec beaucoup de données, on passerait à un index texte
  MongoDB ou à Atlas Search.

### Fichiers modifiés

- `backend/src/app.js` : helpers de filtre, paramètre `q`, route `/api/tracks/recent`, `ownerName`.
- `backend/test/api.test.js` : 9 nouveaux tests.
- `frontend-starter/src/app/shared/models/track.model.ts` : `ownerName`.
- `frontend-starter/src/app/shared/services/track.service.ts` : paramètre `query`, méthode `recent()`.
- `frontend-starter/src/app/components/tracks-page/*` : recherche, carte des récents, affichage du propriétaire.
- `frontend-starter/src/app/.../*.spec.ts` : 8 nouveaux tests.
- `API_CONTRACT.md` : documentation de `q`, `/tracks/recent` et `ownerName`.

### Résultats des tests

| Suite | Commande | Résultat |
|---|---|---|
| Backend (Node test runner) | `cd backend && npm test` | **15/15** réussis (6 avant la mission) |
| Frontend (Vitest) | `cd frontend-starter && npm test` | **19/19** réussis (11 avant la mission) |
| Build Angular | `cd frontend-starter && npm run build` | OK |

Tests ajoutés :

- backend : recherche vide, échappement et insensibilité à la casse, troncature à 80 caractères,
  filtre de chaque portée, combinaison portée + recherche, filtre des récents (exclusion de
  l'utilisateur), `toTrackResponse` (pas de `_id` ni de `storedName`, propriétaire peuplé ou non,
  ancienne piste sans `visibility`), `401` sur `/tracks/recent` sans JWT ;
- frontend : paramètre `q` envoyé nettoyé ou absent s'il est vide, `recent()`, affichage des récents
  et de leur propriétaire, gestion d'erreur, debounce de 300 ms avec retour à la page 1, pas de
  rechargement si seuls des espaces sont ajoutés, conservation de la recherche au changement d'onglet.

Limite : les tests backend ne lancent pas MongoDB. Les filtres sont vérifiés unitairement, mais
l'exécution réelle des requêtes doit être vérifiée manuellement (ou plus tard avec
`mongodb-memory-server`).

## 4. Mission 2 : partage piste par piste

### Fonctionnalités

- Modifier le **titre** et la **visibilité** d'une piste après l'upload.
- Partager une piste **privée** avec des **amis choisis**, piste par piste.
- **Arrêter un partage** : avec un ami précis (croix sur son nom) ou d'un seul coup
  (« Arrêter le partage » rend la piste privée et vide la liste).
- Retirer un ami arrête automatiquement tous les partages entre les deux utilisateurs.

Trois niveaux de visibilité :

| Visibilité | Qui peut écouter |
|---|---|
| Privée | Le propriétaire et les amis choisis (`sharedWith`) |
| Tous mes amis | Tous les amis acceptés, actuels et futurs |
| Publique | Tout utilisateur connecté |

### Interface

- Dans « Mes pistes », chaque piste a un bouton **Partager** qui ouvre un panneau sous la piste :
  titre, visibilité, et cases à cocher des amis (affichées seulement si la piste est privée).
- Les amis ayant accès sont affichés en **étiquettes** sous la piste, avec une croix pour arrêter
  le partage sans ouvrir le panneau.
- Le bouton **Arrêter le partage** n'apparaît que si la piste est réellement partagée, et demande
  une confirmation.
- La ligne « Visibilité » devient explicite : « Privée · partagée avec 2 amis », « Tous mes amis »,
  « Publique », et « Partagée avec vous » du côté de l'ami.
- Les actions de partage sont masquées dans les onglets Publiques et Amis.

### Choix techniques

- **Modèle.** Ajout de `Track.sharedWith` (tableau d'`ObjectId` vers `User`, indexé) plutôt qu'une
  collection `Share` séparée : la liste est courte, toujours lue avec la piste, et une seule requête
  suffit pour filtrer « partagé avec moi ».
- **Double protection à l'arrêt d'une amitié.** L'accès exige d'être dans `sharedWith` *et* d'être
  encore ami : le contrôle est refait à chaque lecture audio. En plus, `DELETE /friends/:id` retire
  les deux utilisateurs des listes de partage (`$pull`), pour qu'un partage ne « revienne » pas si
  l'amitié est recréée plus tard.
- **Règle d'accès centralisée** dans la fonction pure `canAccessTrack`, utilisée par la route audio
  et testée sans base de données.
- **Validation** dans `parseTrackUpdate` : seuls `title`, `visibility` et `sharedWith` sont pris en
  compte (impossible de changer `ownerId` ou `storedName`), les identifiants sont vérifiés et
  dédoublonnés, et le serveur refuse de partager avec quelqu'un qui n'est pas un ami accepté.
- **Cohérence.** `isPublic` (champ historique) suit toujours `visibility`, sinon une piste repassée
  en privé resterait listée comme publique. Une piste qui n'est plus privée perd ses partages ciblés.
- **Confidentialité.** Seul le propriétaire reçoit la liste `sharedWith` ; un ami reçoit uniquement
  `sharedWithMe`. Une piste inaccessible répond `404`, sans révéler qu'elle existe.
- **Frontend.** Nouveau composant autonome `TrackShareEditorComponent` (`input()`, `output()`,
  Signals, Reactive Forms). La page remplace la piste modifiée dans sa liste sans recharger. La
  liste d'amis n'est chargée qu'à la première ouverture du panneau.

### Fichiers modifiés

- `backend/src/models/Track.js` : champ `sharedWith`.
- `backend/src/app.js` : `canAccessTrack`, `parseTrackUpdate`, filtres mis à jour, routes
  `PATCH /api/tracks/:id` et `DELETE /api/tracks/:id/shares/:userId`, nettoyage au retrait d'un ami.
- `backend/test/api.test.js` : 11 nouveaux tests.
- `frontend-starter/src/app/components/track-share-editor/` : nouveau composant et ses 7 tests.
- `frontend-starter/src/app/components/tracks-page/*` : bouton Partager, étiquettes, arrêt du partage.
- `frontend-starter/src/app/shared/` : types `TrackShare`, `TrackUpdate`, `TrackVisibility` ;
  méthodes `update()` et `unshare()` de `TrackService`.
- `API_CONTRACT.md` : section « Partage piste par piste ».

### Résultats des tests

| Suite | Commande | Résultat |
|---|---|---|
| Backend (Node test runner) | `cd backend && npm test` | **26/26** réussis (15 après la mission 1) |
| Frontend (Vitest) | `cd frontend-starter && npm test` | **36/36** réussis (19 après la mission 1) |
| Build Angular | `cd frontend-starter && npm run build` | OK |

Tests ajoutés :

- backend : règle d'accès (propriétaire, publique, privée non partagée, « amis », partage ciblé,
  ami retiré encore présent dans la liste, ami non sélectionné), validation du PATCH (nettoyage,
  dédoublonnage, champs interdits ignorés, sept cas invalides), `sharedWith` visible du seul
  propriétaire, valeur par défaut du modèle, `401` sur les deux nouvelles routes ;
- frontend : `update()` et `unshare()` du service ; éditeur (pré-remplissage, cocher et décocher,
  enregistrement, liste vidée si la piste n'est plus privée, titre vide refusé, erreur du serveur
  affichée, annulation) ; page (étiquettes, libellés de visibilité, amis chargés une seule fois,
  arrêt d'un partage, arrêt de tous les partages avec et sans confirmation, erreur signalée,
  actions masquées hors de « Mes pistes »).

Limite inchangée : pas de MongoDB dans les tests. Scénario à vérifier à la main avec deux comptes
amis A et B : A partage une piste privée avec B ; B la voit dans « Pistes de mes amis » et peut
l'écouter ; A arrête le partage ; B ne la voit plus et la lecture répond `404`.

## 5. Mission 3 : activité des amis

### Fonctionnalités

- Un **fil d'activité** sur la page « Mon réseau », du plus récent au plus ancien, avec deux types
  d'événements :
  - un ami a ajouté une piste que je peux voir : « Alice a partagé une piste avec vous »,
    « Alice a partagé une piste avec ses amis » ou « Alice a publié une piste » ;
  - une nouvelle amitié : « Vous êtes maintenant ami avec Alice ».
- Un bouton **▶ Écouter** sur chaque piste du fil, avec un lecteur intégré à la page.
- Le fil se recharge quand on accepte ou retire un ami, et avec le bouton « Actualiser ».

### Interface

- Section « Activité de mes amis » placée entre la recherche d'utilisateurs et les demandes reçues.
- Chaque ligne : phrase d'activité, titre de la piste, date et heure, bouton d'écoute.
- Message d'aide quand le fil est vide ; message clair si la piste n'est plus partagée (« Cette
  piste n'est plus partagée avec vous ») quand le serveur répond `404`.

### Choix techniques

- **Fil calculé à la demande, sans nouvelle collection.** `GET /api/friends/activity` lit les
  pistes visibles des amis et les amitiés acceptées, puis les fusionne. Avantage : aucune donnée à
  synchroniser, et un partage arrêté disparaît immédiatement du fil. Une collection `Activity`
  ne deviendrait utile que pour des événements non dérivables (commentaires, « j'aime »).
- **Mêmes règles de visibilité que le reste de l'application** : le filtre
  `buildFriendActivityFilter` ne retient que les pistes publiques, « tous mes amis » ou partagées
  avec l'utilisateur. Une piste privée non partagée n'apparaît jamais.
- **Fusion et tri** dans la fonction pure `buildActivityFeed`, testée sans base de données.
- **Vie privée.** Seules mes propres amitiés apparaissent, pas celles de mes amis entre eux : le
  fil ne révèle pas le réseau des autres.
- **Frontend.** `FriendService.activity()`, modèle `Activity`, Signals pour l'état. La lecture
  réutilise `TrackService.audio()` (Blob protégé par le JWT) ; l'URL Blob est libérée au
  changement de piste et à la destruction du composant.

Limite connue : la date d'un événement « piste » est la date d'ajout de la piste, pas celle du
partage. Une vieille piste partagée aujourd'hui apparaît donc à sa date d'ajout. Corriger cela
demanderait d'enregistrer la date de chaque partage.

### Fichiers modifiés

- `backend/src/app.js` : `buildFriendActivityFilter`, `buildActivityFeed`, route
  `GET /api/friends/activity`.
- `backend/test/api.test.js` : 5 nouveaux tests.
- `frontend-starter/src/app/shared/models/activity.model.ts` : nouveau modèle.
- `frontend-starter/src/app/shared/services/friend.service.ts` : méthode `activity()`.
- `frontend-starter/src/app/components/friends-page/*` : fil, lecteur intégré, 7 tests (nouveau
  fichier de tests pour cette page).
- `API_CONTRACT.md` : section « Activité des amis ».

### Résultats des tests

| Suite | Commande | Résultat |
|---|---|---|
| Backend (Node test runner) | `cd backend && npm test` | **31/31** réussis (26 après la mission 2) |
| Frontend (Vitest) | `cd frontend-starter && npm test` | **44/44** réussis (36 après la mission 2) |
| Build Angular | `cd frontend-starter && npm run build` | OK |

Tests ajoutés :

- backend : filtre d'activité (pistes d'amis visibles uniquement, aucun résultat sans ami), fusion
  triée par date, limite et entrées vides, `401` sans JWT ;
- frontend : appel de `activity()` avec la limite ; affichage du fil, formulation selon le type et
  la visibilité, fil vide, erreur de chargement, lecture d'une piste, message quand le partage a
  été arrêté, rechargement du fil après le retrait d'un ami.

## 6. Mission 4 : téléchargement, couverture et badges

### Fonctionnalités

- **Télécharger** une piste accessible (la sienne, une piste publique ou partagée), enregistrée
  sous son nom de fichier d'origine.
- **Image de couverture** enregistrée sur le serveur lors de l'upload (optionnelle). Auparavant,
  l'image n'était qu'un aperçu local, perdu après l'envoi.
- **Vignettes** de couverture dans la liste des pistes, dans « Récemment ajoutés » et dans le fil
  d'activité ; une note de musique sert d'image par défaut.
- **Badges de visibilité** colorés à côté du titre : « Privée », « Privée · partagée avec 2 amis »,
  « Tous mes amis », « Publique », « Partagée avec vous ».

### Interface

- Bouton **Télécharger** à côté du bouton de lecture, dans les trois onglets.
- Champ « Image de couverture (optionnelle, JPEG/PNG/WebP, 2 Mo max) » dans le formulaire
  d'import, avec aperçu avant l'envoi. Le formulaire est vidé après un envoi réussi.
- Le badge remplace l'ancienne ligne « Visibilité » de la fiche de chaque piste.

### Choix techniques

- **Téléchargement.** Pas de nouvelle route : `GET /api/tracks/:id/audio?download=true` ajoute
  `Content-Disposition: attachment` avec `res.attachment()`, qui encode correctement les noms
  avec accents. Le contrôle d'accès est donc exactement celui de la lecture. Côté Angular, le
  fichier est chargé en Blob (pour envoyer le JWT) puis enregistré avec un lien temporaire
  `download` (`saveBlob`).
- **Upload à deux fichiers.** `upload.single("audio")` devient `upload.fields([audio, cover])`.
  Le filtre Multer dépend du champ (`isAcceptedUpload`) : audio pour `audio`, image pour `cover`.
- **Sécurité des images.** SVG est refusé car il peut contenir du script. La couverture est
  servie avec son type MIME et `X-Content-Type-Options: nosniff`. Limite de 2 Mo vérifiée côté
  client et côté serveur.
- **Pas de fichier orphelin.** Si l'upload est refusé (couverture trop lourde, audio absent,
  erreur MongoDB), les fichiers déjà écrits sont supprimés. La suppression d'une piste supprime
  aussi sa couverture.
- **Mêmes droits pour la couverture et l'audio.** La fonction `findAccessibleTrack` est partagée
  par les deux routes : on ne peut pas voir la couverture d'une piste qu'on ne peut pas écouter.
- **Modèle.** `coverStoredName` (masqué, `select: false`) et `coverMimeType`. Les réponses
  exposent seulement `hasCover`.
- **Affichage des couvertures.** Une balise `<img src="/api/...">` n'envoie pas l'en-tête
  `Authorization`. Le composant `TrackCoverComponent` charge donc l'image en Blob avec
  `HttpClient` dans un `effect()`, et libère l'URL locale quand la piste change ou que le
  composant est détruit.

Limites connues : la couverture ne peut pas être changée après l'upload (il faut supprimer puis
réimporter la piste) ; les pistes importées avant cette mission n'ont pas de couverture.

### Fichiers modifiés

- `backend/src/models/Track.js` : `coverStoredName`, `coverMimeType`.
- `backend/src/app.js` : `isAcceptedUpload`, `MAX_COVER_SIZE`, upload à deux champs,
  `findAccessibleTrack`, option `download`, route `GET /api/tracks/:id/cover`, nettoyage.
- `backend/test/api.test.js` : 6 nouveaux tests.
- `frontend-starter/src/app/components/track-cover/` : nouveau composant et ses 4 tests.
- `frontend-starter/src/app/shared/utils/save-blob.ts` : enregistrement d'un Blob, 1 test.
- `frontend-starter/src/app/shared/services/track.service.ts` : `download()`, `cover()`,
  paramètre `cover` de `upload()`.
- `frontend-starter/src/app/components/tracks-page/*` et `friends-page/*` : bouton Télécharger,
  envoi de la couverture, vignettes, badges.
- `API_CONTRACT.md` : section « Téléchargement et couverture ».

### Résultats des tests

| Suite | Commande | Résultat |
|---|---|---|
| Backend (Node test runner) | `cd backend && npm test` | **37/37** réussis (31 après la mission 3) |
| Frontend (Vitest) | `cd frontend-starter && npm test` | **59/59** réussis (44 après la mission 3) |
| Build Angular | `cd frontend-starter && npm run build` | OK |

Tests ajoutés :

- backend : types acceptés par champ (SVG refusé), `hasCover` sans exposer le nom du fichier,
  `401` sur la couverture, et trois **vrais appels HTTP d'upload** avec un JWT de test : image
  non acceptée, couverture de plus de 2 Mo, audio absent. Chacun vérifie la réponse `400` et
  qu'aucun fichier ne reste dans `data/uploads` ;
- frontend : `upload()` avec et sans couverture, `download()`, `cover()` ; `saveBlob` ;
  `TrackCoverComponent` (affichage, image par défaut, erreur, libération de l'URL) ; page
  (téléchargement sous le nom d'origine, échec du téléchargement, couverture refusée par type
  ou par taille, envoi de la couverture, badges).

## 7. Bilan

| | Avant le TP4 | Après les 4 missions |
|---|---|---|
| Tests backend | 6 | 37 |
| Tests frontend | 11 | 59 |

Toutes les exigences du sujet « Fichiers publics / privés » sont couvertes. Limite générale des
tests : ils n'utilisent pas MongoDB. Les règles (filtres, droits, validation) sont testées comme
fonctions pures, et les routes jusqu'au premier accès à la base. Le parcours complet doit être
vérifié à la main avec deux comptes, ou plus tard avec `mongodb-memory-server`.

## 8. Correction après test manuel : lecture et pause

Problème constaté en utilisant l'application : impossible de mettre un son en pause depuis sa
piste. Le bouton ▶ ne savait que lancer la lecture ; recliquer dessus retéléchargeait le fichier
et le relançait depuis le début. La seule pause était celle du lecteur natif, en bas de la liste.

Correction : le bouton devient un bouton **lecture/pause** (`togglePlay`) dans la liste des
pistes, dans « Récemment ajoutés » et dans le fil d'activité. Il affiche ⏸ pendant la lecture,
met en pause, puis reprend au même endroit sans retélécharger la piste. L'état vient des
événements `play`, `pause` et `ended` de l'élément `<audio>`, donc le bouton reste synchronisé
avec les contrôles natifs.

Tests ajoutés (5) : chargement au premier clic et affichage de ⏸, pause sans nouveau
téléchargement, reprise, passage à une autre piste, et le même comportement sur la page Réseau.
Résultat : frontend **64/64**, backend 37/37 (inchangé), build OK.

## 9. Corrections après le test manuel à deux comptes

Le test à deux comptes (un compte dans une fenêtre normale, l'autre en navigation privée) a
révélé deux défauts que les tests automatiques n'avaient pas détectés.

### Le partage ne s'enregistrait pas

- **Symptôme.** Après avoir coché un ami et cliqué sur « Enregistrer », la case était de nouveau
  décochée à la réouverture du panneau.
- **Cause.** Le formulaire du panneau utilisait `(ngSubmit)`. Cet événement n'existe que si le
  formulaire porte `[formGroup]` (Reactive Forms) ou si `FormsModule` est importé. Ici, ni l'un
  ni l'autre : le clic n'appelait jamais `save()`, et le navigateur rechargeait la page. Angular
  ne signale pas d'erreur de compilation pour un événement inconnu sur une balise HTML.
- **Pourquoi les tests ne l'ont pas vu.** Ils appelaient `save()` directement, sans passer par le
  bouton.
- **Correction.** Événement natif `(submit)` avec `preventDefault()`. Nouveau test qui coche une
  case et clique réellement sur le bouton.
- **Preuve.** Parcours rejoué dans un vrai navigateur piloté automatiquement : requête
  `PATCH /api/tracks/:id` avec réponse `200`, étiquette de l'ami affichée, case toujours cochée à
  la réouverture. Puis confirmé à la main avec deux comptes.

### Inscription refusée sans explication

- **Symptôme.** Avec le nom « b », l'inscription échouait avec le message « Les informations
  saisies sont invalides ».
- **Cause.** Le modèle `User` exige un nom d'au moins 2 caractères, mais le formulaire ne le
  vérifiait pas et le message d'erreur ne disait pas quel champ était en cause.
- **Correction.** Validation du nom dans le formulaire avec un message précis, et message
  d'erreur du serveur plus détaillé. Trois nouveaux tests.

### Leçon retenue

Un test qui appelle directement une méthode ne prouve pas que le bouton y est relié. Pour les
formulaires, au moins un test doit passer par un vrai clic.

Résultats finaux : backend **37/37**, frontend **68/68**, build OK.
