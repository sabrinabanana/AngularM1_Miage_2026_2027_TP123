# Contrat HTTP - TP1

Base : `/api`. Sauf inscription et connexion, envoyer `Authorization: Bearer <token>`.

Le contrat HTTP ne dépend pas du choix de persistance : le backend fourni utilise Mongoose et MongoDB. MongoDB conserve les utilisateurs et métadonnées ; les octets des fichiers audio restent sur le disque du serveur.

| Méthode | Route | Requête | Réponse principale |
|---|---|---|---|
| GET | `/health` | - | `{ "status": "ok" }` |
| POST | `/auth/register` | `{name,email,password}` | `201 {token,user}` |
| POST | `/auth/login` | `{email,password}` | `200 {token,user}` |
| GET | `/users/me` | JWT | `200 User` |
| PUT | `/users/me` | `{name}` + JWT | `200 User` |
| GET | `/tracks?page=1&limit=5` | JWT | `Page<Track>` des pistes personnelles |
| GET | `/tracks?page=1&limit=5&public=true` | JWT | `Page<Track>` des pistes publiques |
| GET | `/tracks?...&q=blues` | JWT ; `q` optionnel, combinable avec `public` ou `friends` | `Page<Track>` filtrée sur le titre ou le nom du fichier |
| GET | `/tracks/recent?limit=6` | JWT ; `limit` de 1 à 12, 6 par défaut | `200 Track[]` : pistes publiques et pistes « amis » récentes des autres utilisateurs |
| POST | `/tracks` | multipart : `audio`, `title`, `visibility` (`private`, `public` ou `friends`), `cover` (image optionnelle), `isPublic` legacy | `201 Track` |
| GET | `/tracks/:id/audio?download=true` | JWT ; mêmes droits que la lecture | flux audio avec `Content-Disposition: attachment` (nom d'origine) |
| GET | `/tracks/:id/cover` | JWT ; mêmes droits que l'audio | image de couverture |
| GET | `/tracks/:id/audio` | JWT ; propriétaire, piste publique ou piste partagée (voir « Partage ») | flux audio |
| DELETE | `/tracks/:id` | JWT | `204` (bonus) |
| PATCH | `/tracks/:id` | JWT ; propriétaire ; JSON : `title`, `visibility`, `sharedWith` (au moins un des trois) | `200 Track` avec `sharedWith` |
| DELETE | `/tracks/:id/shares/:userId` | JWT ; propriétaire | `200 Track` : partage arrêté avec cet ami |
| GET | `/users/search?q=alice` | JWT | Jusqu'à 20 utilisateurs correspondants, sans `passwordHash` |
| GET | `/friends` | JWT | Amis, demandes reçues et envoyées |
| GET | `/friends/activity?limit=20` | JWT ; `limit` de 1 à 50, 20 par défaut | `200 Activity[]` : fil d'activité des amis |
| POST | `/friends/request` | JWT | JSON : `{userId}` |
| POST | `/friends/accept/:id` | JWT | Accepte une demande reçue |
| POST | `/friends/reject/:id` | JWT | Refuse une demande reçue |
| DELETE | `/friends/:id` | JWT | Supprime une amitié |

`Page<Track>` contient `items`, `page`, `limit`, `total` et `pages`. Un `Track` contient notamment `ownerId`, `isPublic` et `visibility` (`private`, `public` ou `friends`, privé par défaut). `GET /tracks?friends=true` liste les pistes visibles par les amis de l'utilisateur. Les listes et `/tracks/recent` ajoutent `ownerName` (nom du propriétaire, ou `null`).

Recherche (`q`) : sans tenir compte des majuscules, sur `title` et `originalName`. La saisie est nettoyée des espaces de début et de fin, limitée à 80 caractères et échappée (les caractères spéciaux des regex sont cherchés tels quels). Un `q` vide revient à ne pas filtrer. `/tracks/recent` exclut les pistes de l'utilisateur connecté et répond `401` sans JWT valide. Formats acceptés : MP3, WAV, OGG et M4A, 25 Mo maximum.

## Partage piste par piste

- `visibility` : `private` (propriétaire et amis choisis), `friends` (tous les amis acceptés) ou `public` (tout utilisateur connecté).
- `sharedWith` : liste d'identifiants d'amis autorisés à écouter une piste **privée**. Elle remplace la liste précédente ; `[]` arrête tous les partages ciblés.
- `PATCH /tracks/:id` : `title` de 1 à 120 caractères ; chaque identifiant de `sharedWith` doit être un ami accepté, sinon `400`. Si la piste n'est plus privée après la modification, `sharedWith` est vidé. Les autres champs du corps sont ignorés. Erreurs : `400` corps invalide ou partage avec un non-ami, `401` sans JWT, `404` piste inconnue ou appartenant à quelqu'un d'autre.
- `DELETE /tracks/:id/shares/:userId` : erreurs `400` identifiant invalide, `401`, `404`. Retirer un ami absent de la liste renvoie la piste inchangée.
- Réponses : le propriétaire reçoit `sharedWith: [{ id, name }]` ; les autres utilisateurs reçoivent seulement `sharedWithMe: true | false`, jamais la liste.
- Accès à `GET /tracks/:id/audio` : propriétaire, piste publique, piste `friends` d'un ami, ou piste partagée avec l'utilisateur **s'il est encore ami** du propriétaire. Sinon `404`.
- `GET /tracks?friends=true` et `/tracks/recent` incluent les pistes partagées individuellement avec l'utilisateur.
- `DELETE /friends/:id` retire aussi les deux utilisateurs des listes `sharedWith` de leurs pistes respectives.

## Téléchargement et couverture

- `GET /tracks/:id/audio?download=true` : même contrôle d'accès que la lecture ; la réponse ajoute `Content-Disposition: attachment; filename="<nom d'origine>"`. Erreurs : `401`, `404` piste inconnue ou non accessible.
- `POST /tracks`, champ fichier `cover` (optionnel) : JPEG, PNG ou WebP, 2 Mo maximum. Erreurs `400` : format d'image refusé, couverture trop volumineuse, fichier audio absent. En cas de refus, aucun fichier n'est conservé sur le serveur.
- `Track.hasCover` (`true` ou `false`) indique si une couverture existe. Le nom technique du fichier n'est jamais exposé.
- `GET /tracks/:id/cover` : renvoie l'image avec son type MIME. Erreurs : `401`, `404` si la piste est inconnue, non accessible ou sans couverture.
- `DELETE /tracks/:id` supprime aussi le fichier de couverture.

## Activité des amis

`GET /friends/activity` renvoie un tableau trié de la date la plus récente à la plus ancienne. Chaque `Activity` contient `id`, `type`, `date` et `user: { id, name }` :

- `type: "track"` : un ami a ajouté une piste que l'utilisateur a le droit de voir (publique, « tous mes amis » ou partagée avec lui). Le champ `track` contient le `Track`, avec `sharedWithMe`. `date` est la date d'ajout de la piste.
- `type: "friendship"` : l'utilisateur est devenu ami avec `user`. `date` est la date d'acceptation.

Les pistes privées non partagées et les pistes de non-amis n'apparaissent jamais. Erreur : `401` sans JWT valide.

Erreurs courantes : `400` validation, `401` authentification, `404` ressource, `409` email déjà utilisé.
