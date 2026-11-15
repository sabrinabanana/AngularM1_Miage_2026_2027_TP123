import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { Track } from "./models/Track.js";
import { Friendship } from "./models/Friendship.js";

// Les fichiers audio restent sur le disque du serveur dans ce TP.
// MongoDB ne conserve que leurs métadonnées : titre, nom, taille, etc.
const UPLOADS = path.resolve("data/uploads");

try {
  // mkdirSync est utilisé au démarrage : l'application doit disposer de ce
  // dossier avant de pouvoir accepter le premier upload.
  fs.mkdirSync(UPLOADS, { recursive: true });
  console.log(`[startup] Dossier des uploads prêt : ${UPLOADS}`);
} catch (error) {
  console.error("[startup] Impossible de créer le dossier des uploads", error);
  throw error;
}

// Ce secret reste côté serveur. Il ne doit jamais être copié dans Angular.
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";

// La taille maximale d'un fichier audio est de 25 Mo. Les fichiers plus gros
// sont refusés par Multer avant d'être écrits sur le disque.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Les types MIME autorisés correspondent aux formats demandés dans le sujet.
const allowed = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
]);

// Couvertures : formats d'image courants. SVG est exclu car il peut contenir
// du script. La limite de 2 Mo est vérifiée après réception, car la limite
// Multer (25 Mo) s'applique à tous les fichiers de la requête.
const allowedCovers = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_COVER_SIZE = 2 * 1024 * 1024;

/** Indique si un fichier multipart est accepté, selon son champ et son type MIME. */
export function isAcceptedUpload(fieldname, mimetype) {
  if (fieldname === "audio") return allowed.has(mimetype);
  if (fieldname === "cover") return allowedCovers.has(mimetype);
  return false;
}

/** Normalise la valeur multipart de visibilité envoyée par un formulaire. */
export function parsePublicFlag(value) {
  return value === true
    || ["true", "1", "on", "yes"].includes(String(value ?? "").toLowerCase());
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longueur maximale d'une recherche texte, pour limiter le coût des regex. */
export const MAX_SEARCH_LENGTH = 80;

/**
 * Construit le filtre MongoDB de recherche texte sur le titre et le nom
 * d'origine. La saisie est échappée : « a.* » cherche littéralement « a.* ».
 * Retourne null si la recherche est vide.
 */
export function buildSearchCondition(rawQuery) {
  const search = String(rawQuery ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  if (!search) return null;
  const pattern = escapeRegex(search);
  return {
    $or: [
      { title: { $regex: pattern, $options: "i" } },
      { originalName: { $regex: pattern, $options: "i" } },
    ],
  };
}

/**
 * Construit le filtre de GET /api/tracks selon la portée demandée :
 * - "mine"    : pistes de l'utilisateur connecté ;
 * - "public"  : pistes publiques de tout le monde ;
 * - "friends" : pistes des amis acceptés, visibles par tous leurs amis
 *               ou partagées individuellement avec l'utilisateur.
 * La recherche texte optionnelle s'ajoute avec un $and.
 */
export function buildTrackFilter({ scope = "mine", userId, friendIds = [], q = "" }) {
  let scopeFilter;
  if (scope === "public") {
    scopeFilter = { $or: [{ visibility: "public" }, { isPublic: true }] };
  } else if (scope === "friends") {
    scopeFilter = {
      ownerId: { $in: friendIds },
      $or: [{ visibility: "friends" }, { sharedWith: userId }],
    };
  } else {
    scopeFilter = { ownerId: userId };
  }

  const searchCondition = buildSearchCondition(q);
  return searchCondition ? { $and: [scopeFilter, searchCondition] } : scopeFilter;
}

/**
 * Filtre des « fichiers récemment ajoutés » : pistes publiques et pistes
 * partagées par les amis, en excluant celles de l'utilisateur lui-même.
 */
export function buildRecentFilter(userId, friendIds = []) {
  return {
    ownerId: { $ne: userId },
    $or: [
      { visibility: "public" },
      { isPublic: true },
      { ownerId: { $in: friendIds }, visibility: "friends" },
      { ownerId: { $in: friendIds }, sharedWith: userId },
    ],
  };
}

/**
 * Filtre des pistes qui alimentent le fil d'activité : pistes des amis que
 * l'utilisateur a le droit de voir (publiques, « amis » ou partagées avec lui).
 */
export function buildFriendActivityFilter(userId, friendIds = []) {
  return {
    ownerId: { $in: friendIds },
    $or: [
      { visibility: "public" },
      { isPublic: true },
      { visibility: "friends" },
      { sharedWith: userId },
    ],
  };
}

/**
 * Fusionne les pistes des amis et les amitiés acceptées en un seul fil,
 * du plus récent au plus ancien. Fonction pure : elle reçoit des objets déjà
 * lus en base (tracks au format toTrackResponse, friendships avec `user`).
 */
export function buildActivityFeed({ tracks = [], friendships = [], limit = 20 }) {
  const items = [
    ...tracks.map((track) => ({
      id: `track:${track.id}`,
      type: "track",
      date: track.createdAt,
      user: { id: track.ownerId, name: track.ownerName },
      track,
    })),
    ...friendships.map((friendship) => ({
      id: `friendship:${friendship.id}`,
      type: "friendship",
      date: friendship.date,
      user: friendship.user,
    })),
  ];
  return items
    .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
    .slice(0, limit);
}

export const VISIBILITIES = ["private", "public", "friends"];

/**
 * Règle d'accès à une piste (lecture audio) :
 * propriétaire, piste publique, piste « amis » d'un ami, ou piste partagée
 * individuellement avec un utilisateur qui est encore ami du propriétaire.
 */
export function canAccessTrack(track, userId, isFriendOfOwner) {
  if (!track) return false;
  if (String(track.ownerId) === String(userId)) return true;
  if (track.visibility === "public" || track.isPublic === true) return true;
  if (!isFriendOfOwner) return false;
  if (track.visibility === "friends") return true;
  return (track.sharedWith ?? []).some((id) => String(id) === String(userId));
}

/**
 * Valide le corps de PATCH /api/tracks/:id. Seuls title, visibility et
 * sharedWith sont acceptés ; renvoie { error } ou { changes }.
 */
export function parseTrackUpdate(body) {
  const changes = {};
  const input = body && typeof body === "object" ? body : {};

  if ("title" in input) {
    const title = String(input.title ?? "").trim();
    if (!title || title.length > 120) {
      return { error: "Le titre doit contenir entre 1 et 120 caractères" };
    }
    changes.title = title;
  }

  if ("visibility" in input) {
    if (!VISIBILITIES.includes(input.visibility)) {
      return { error: "Visibilité invalide (private, public ou friends)" };
    }
    changes.visibility = input.visibility;
  }

  if ("sharedWith" in input) {
    if (!Array.isArray(input.sharedWith) || input.sharedWith.length > 100) {
      return { error: "sharedWith doit être une liste d'identifiants" };
    }
    const ids = [...new Set(input.sharedWith.map(String))];
    if (!ids.every(isValidObjectId)) {
      return { error: "sharedWith contient un identifiant invalide" };
    }
    changes.sharedWith = ids;
  }

  if (Object.keys(changes).length === 0) {
    return { error: "Aucune modification fournie (title, visibility ou sharedWith)" };
  }
  return { changes };
}

/**
 * Transforme un document Track « lean » (éventuellement avec ownerId peuplé
 * par populate) en objet JSON sûr pour Angular : id texte, nom du
 * propriétaire, jamais de storedName ni de _id.
 * Seul le propriétaire (viewerId) voit la liste sharedWith ; les autres
 * savent uniquement si la piste leur est partagée (sharedWithMe).
 */
export function toTrackResponse(track, viewerId) {
  const owner = track.ownerId && typeof track.ownerId === "object" && "name" in track.ownerId
    ? track.ownerId
    : null;
  const visibility = track.visibility ?? (track.isPublic ? "public" : "private");
  const ownerId = String(owner ? owner._id : track.ownerId);
  const shared = track.sharedWith ?? [];
  // Un élément peuplé est { _id, name } ; sinon c'est un simple ObjectId.
  const sharedId = (entry) => String(entry && typeof entry === "object" && "_id" in entry ? entry._id : entry);
  const response = {
    id: String(track._id),
    ownerId,
    ownerName: owner?.name ?? null,
    title: track.title,
    originalName: track.originalName,
    mimeType: track.mimeType,
    size: track.size,
    isPublic: visibility === "public" || track.isPublic === true,
    visibility,
    hasCover: Boolean(track.coverMimeType),
    createdAt: track.createdAt,
  };
  if (viewerId !== undefined && ownerId === String(viewerId)) {
    response.sharedWith = shared.map((entry) => ({
      id: sharedId(entry),
      name: entry && typeof entry === "object" && "name" in entry ? entry.name : null,
    }));
  } else if (viewerId !== undefined) {
    response.sharedWithMe = shared.some((entry) => sharedId(entry) === String(viewerId));
  }
  return response;
}

function isValidObjectId(value) {
  return mongoose.isValidObjectId(value);
}

async function friendIdsFor(userId) {
  const relations = await Friendship.find({
    status: "accepted",
    $or: [{ requesterId: userId }, { addresseeId: userId }],
  }).lean();
  return relations.map((relation) =>
    String(relation.requesterId) === String(userId)
      ? relation.addresseeId
      : relation.requesterId,
  );
}

async function areFriends(firstId, secondId) {
  return Boolean(await Friendship.exists({
    status: "accepted",
    $or: [
      { requesterId: firstId, addresseeId: secondId },
      { requesterId: secondId, addresseeId: firstId },
    ],
  }));
}

/**
 * Crée un jeton JWT contenant uniquement l'identité nécessaire à l'API.
 * Le mot de passe n'est jamais placé dans le token. `sub` signifie subject
 * et contient l'identifiant MongoDB de l'utilisateur.
 */
function token(user) {
  console.log(`[auth] Création d'un token pour l'utilisateur ${user.id}`);
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, {
    expiresIn: "2h",
  });
}

/** Middleware Express qui protège les routes privées. */
function auth(req, res, next) {
  const raw = req.headers.authorization;

  // Le token est transmis dans l'en-tête Authorization sous la forme
    // "Authorization: Bearer <token>". Le préfixe "Bearer " est obligatoire pour que
    // le middleware sache qu'il s'agit d'un JWT et non d'un autre type de jeton.
  if (!raw?.startsWith("Bearer ")) {
    console.warn(`[auth] Authorization absente pour ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Authentification requise" });
  }

  try {
    // jwt.verify vérifie la signature et la date d'expiration du token.
    // On ne logue jamais sa valeur, car un JWT permettrait une usurpation.
    req.auth = jwt.verify(raw.slice(7), SECRET);
    console.log(`[auth] Token accepté pour ${req.auth.sub}`);
    next();
  } catch (error) {
    console.error("[auth] Token invalide ou expiré", error);
    return res.status(401).json({ message: "Jeton invalide ou expiré" });
  }
}

/*
 * Multer transforme une requête HTTP multipart/form-data en données exploitables
 * par Express et traite les fichiers envoyés par un formulaire HTML.
 * Documentation officielle : https://github.com/expressjs/multer
 *
 * diskStorage indique que Multer écrit directement le fichier sur disque.
 * Chaque callback doit appeler cb(error, value) : null signifie qu'il n'y a
 * pas d'erreur. Le nom aléatoire évite les collisions entre utilisateurs.
 */
const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    console.debug(`[multer] Destination sélectionnée : ${UPLOADS}`);
    callback(null, UPLOADS);
  },
  filename: (_request, file, callback) => {
    const filename =
      crypto.randomUUID() + path.extname(file.originalname).toLowerCase();
    console.log(`[multer] Nom de stockage généré pour ${file.originalname}`);
    callback(null, filename);
  },
});

/*
 * limits.fileSize protège le serveur contre les fichiers trop volumineux.
 * fileFilter est appelé avant l'enregistrement : accepter le fichier appelle
 * callback(null, true), le refuser transmet une vraie Error à Express.
 */
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    // Champ « audio » : types MIME audio du sujet ; champ « cover » : images.
    if (isAcceptedUpload(file.fieldname, file.mimetype)) {
      console.log(`[multer] Type accepté : ${file.mimetype} (${file.fieldname})`);
      return callback(null, true);
    }

    const error = new Error(
      file.fieldname === "cover"
        ? "Format d'image non accepté (JPEG, PNG ou WebP)"
        : "Format audio non accepté",
    );
    error.status = 400;
    console.error(`[multer] Type refusé : ${file.mimetype}`, error);
    return callback(error);
  },
});

/**
 * Construit l'application Express sans ouvrir de port.
 * Cette séparation permet au serveur réel et aux tests de créer la même
 * application. Le port est ouvert uniquement dans server.js.
 */
export function createApp() {
  const app = express();

  // Journaliser la fin de chaque requête permet de suivre méthode, URL,
  // statut et durée sans exposer les corps contenant des mots de passe.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt} ms)`,
      );
    });
    next();
  });

  // CORS est nécessaire pour que le frontend Angular puisse appeler l'API.
  // C'est-à-dire que le navigateur autorise les requêtes cross-origin depuis localhost:4200.
  // Dans un vrai projet, il est recommandé de limiter les origines autorisées.
  app.use(cors());

  // Express ne gère pas nativement le JSON : ce middleware transforme le corps JSON en objet JavaScript 
  // accessible via req.body.
  // Il est placé avant les routes pour que toutes les requêtes JSON soient traitées.
  app.use(express.json());

  /** Endpoint public utilisé pour vérifier que l'API répond. */
  app.get("/api/health", (_req, res) => {
    console.log("[health] Vérification de l'API");
    res.json({ status: "ok" });
  });

  /** Requête POST pour "insertion" de donnée.
   * Inscrit un utilisateur et renvoie un token avec ses données publiques. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
   */
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const { name, email, password } = req.body || {};
      console.log(`[auth] Tentative d'inscription pour ${email || "email absent"}`);

      if (!name || !email || !password || password.length < 8) {
        console.warn("[auth] Inscription refusée : données invalides ou incomplètes");
        return res.status(400).json({
          message: "Nom, email et mot de passe de 8 caractères requis",
        });
      }

      // Vérifie si l'email est déjà utilisé avant de créer un nouvel utilisateur.
      if (await User.exists({ email: String(email).toLowerCase() })) {
        console.warn(`[auth] Email déjà utilisé : ${email}`);
        return res.status(409).json({ message: "Email déjà utilisé" });
      }

      // Crée l'utilisateur et le stocke dans MongoDB. Le mot de passe est haché
      // par le hook pre('validate') défini dans le schéma Mongoose.
      const user = await User.create({ name, email, password });
      console.log(`[auth] Utilisateur créé : ${user.id}`);
      res.status(201).json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant l'inscription", error);
      next(error);
    }
  });

  /** Vérifie les identifiants et ouvre une session JWT. Les identifiants sont envoyés dans le corps de la 
   * requête par un HTTP POST. */
  app.post("/api/auth/login", async (req, res, next) => {
    try {
        // req.body est déjà un objet JavaScript grâce au middleware express.json() placé plus haut.
        // il contient les champs email et password envoyés par le frontend Angular.
      const email = String(req.body?.email || "").toLowerCase();
      console.log(`[auth] Tentative de connexion pour ${email || "email absent"}`);

      // Sélectionne le mot de passe haché pour vérifier les identifiants.
      // User est un modèle Mongoose qui correspond au schéma défini dans models/User.js.
      // on envoie les requête à MongoDB via cet objet. Le mot de passe haché est stocké dans 
      // passwordHash, mais il n'est pas renvoyé par défaut dans les requêtes pour 
      // des raisons de sécurité.
      const user = await User.findOne({ email }).select("+passwordHash");

      if (!user || !(await user.verifyPassword(req.body?.password || ""))) {
        console.warn(`[auth] Identifiants incorrects pour ${email}`);
        return res.status(401).json({ message: "Identifiants incorrects" });
      }

      console.log(`[auth] Connexion réussie : ${user.id}`);
      res.json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant la connexion", error);
      next(error);
    }
  });

  /** Retourne le profil public de l'utilisateur identifié par le JWT. 
   * Les paramètres sont :
   * @param auth - Le middleware qui vérifie le JWT et ajoute req.auth. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
  */
  app.get("/api/users/me", auth, async (req, res, next) => {
    try {
        // req.auth.sub contient l'identifiant MongoDB de l'utilisateur 
        // extrait du JWT par le middleware auth. ici req.auth est un objet ajouté par le middleware 
        // auth à la requête, et sub est la propriété qui contient l'identifiant de l'utilisateur.
      const user = await User.findById(req.auth.sub);
      if (!user) {
        console.warn(`[user] Profil introuvable : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Profil envoyé : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de lecture du profil", error);
      next(error);
    }
  });

  /** Modifie uniquement le nom de l'utilisateur connecté. */
  app.put("/api/users/me", auth, async (req, res, next) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.auth.sub,
        { $set: { name: req.body?.name } },
        { new: true, runValidators: true },
      );

      if (!user) {
        console.warn(`[user] Mise à jour impossible : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Nom mis à jour : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de mise à jour du profil", error);
      next(error);
    }
  });

  app.get("/api/users/search", auth, async (req, res, next) => {
    try {
      const rawQuery = String(req.query.q || "").trim();
      if (rawQuery.length < 2) {
        return res.json([]);
      }
      const query = escapeRegex(rawQuery.slice(0, 80));
      const users = await User.find({
        _id: { $ne: req.auth.sub },
        $or: [
          { name: { $regex: query, $options: "i" } },
          { email: { $regex: query, $options: "i" } },
        ],
      }).select("name email createdAt").limit(20);
      res.json(users.map((user) => user.toPublic()));
    } catch (error) {
      console.error("[friends] Erreur de recherche utilisateur", error);
      next(error);
    }
  });

  app.post("/api/friends/request", auth, async (req, res, next) => {
    try {
      const recipientId = req.body?.userId;
      if (!isValidObjectId(recipientId) || String(recipientId) === String(req.auth.sub)) {
        return res.status(400).json({ message: "Utilisateur destinataire invalide" });
      }
      const recipient = await User.findById(recipientId);
      if (!recipient) return res.status(404).json({ message: "Utilisateur inconnu" });
      const existing = await Friendship.findOne({
        $or: [
          { requesterId: req.auth.sub, addresseeId: recipientId },
          { requesterId: recipientId, addresseeId: req.auth.sub },
        ],
      });
      if (existing) {
        return res.status(409).json({ message: "Une relation existe déjà" });
      }
      const friendship = await Friendship.create({
        requesterId: req.auth.sub,
        addresseeId: recipientId,
      });
      res.status(201).json(friendship.toPublic());
    } catch (error) {
      console.error("[friends] Erreur d'envoi de demande", error);
      next(error);
    }
  });

  app.get("/api/friends", auth, async (req, res, next) => {
    try {
      const relations = await Friendship.find({
        $or: [{ requesterId: req.auth.sub }, { addresseeId: req.auth.sub }],
      }).lean();
      const userIds = [...new Set(relations.flatMap((relation) => [
        String(relation.requesterId),
        String(relation.addresseeId),
      ]).filter((id) => id !== String(req.auth.sub)))];
      const users = await User.find({ _id: { $in: userIds } });
      const byId = new Map(users.map((user) => [String(user._id), user.toPublic()]));
      const result = { friends: [], incoming: [], outgoing: [] };
      for (const relation of relations) {
        const otherId = String(relation.requesterId) === String(req.auth.sub)
          ? String(relation.addresseeId)
          : String(relation.requesterId);
        const other = byId.get(otherId);
        if (!other) continue;
        const item = { ...relation, id: String(relation._id), user: other };
        delete item._id;
        if (relation.status === "accepted") result.friends.push(item);
        else if (relation.status === "pending" && String(relation.addresseeId) === String(req.auth.sub)) result.incoming.push(item);
        else if (relation.status === "pending") result.outgoing.push(item);
      }
      res.json(result);
    } catch (error) {
      console.error("[friends] Erreur de lecture des relations", error);
      next(error);
    }
  });

  /**
   * Fil d'activité des amis : leurs pistes visibles par l'utilisateur et les
   * nouvelles amitiés de l'utilisateur, triées de la plus récente à la plus
   * ancienne. Le fil est calculé à la demande, sans collection dédiée.
   */
  app.get("/api/friends/activity", auth, async (req, res, next) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const relations = await Friendship.find({
        status: "accepted",
        $or: [{ requesterId: req.auth.sub }, { addresseeId: req.auth.sub }],
      }).sort({ updatedAt: -1 }).lean();
      const otherId = (relation) => String(relation.requesterId) === String(req.auth.sub)
        ? String(relation.addresseeId)
        : String(relation.requesterId);
      const friendIds = relations.map(otherId);

      const [trackDocs, users] = await Promise.all([
        Track.find(buildFriendActivityFilter(req.auth.sub, friendIds))
          .sort({ createdAt: -1 })
          .limit(limit)
          .select("-storedName")
          .populate("ownerId", "name")
          .lean(),
        User.find({ _id: { $in: friendIds } }).select("name").lean(),
      ]);
      const names = new Map(users.map((user) => [String(user._id), user.name]));

      const feed = buildActivityFeed({
        tracks: trackDocs.map((track) => toTrackResponse(track, req.auth.sub)),
        friendships: relations
          .filter((relation) => names.has(otherId(relation)))
          .map((relation) => ({
            id: String(relation._id),
            // updatedAt correspond au moment où la demande a été acceptée.
            date: relation.updatedAt,
            user: { id: otherId(relation), name: names.get(otherId(relation)) },
          })),
        limit,
      });
      console.log(`[friends] ${feed.length} activité(s) envoyée(s) à ${req.auth.sub}`);
      res.json(feed);
    } catch (error) {
      console.error("[friends] Erreur de lecture de l'activité", error);
      next(error);
    }
  });

  app.post("/api/friends/accept/:id", auth, async (req, res, next) => {
    try {
      const friendship = await Friendship.findOneAndUpdate(
        { _id: req.params.id, addresseeId: req.auth.sub, status: "pending" },
        { $set: { status: "accepted" } },
        { new: true },
      );
      if (!friendship) return res.status(404).json({ message: "Demande introuvable" });
      res.json(friendship.toPublic());
    } catch (error) {
      console.error("[friends] Erreur d'acceptation", error);
      next(error);
    }
  });

  app.post("/api/friends/reject/:id", auth, async (req, res, next) => {
    try {
      const friendship = await Friendship.findOneAndDelete({
        _id: req.params.id,
        addresseeId: req.auth.sub,
        status: "pending",
      });
      if (!friendship) return res.status(404).json({ message: "Demande introuvable" });
      res.status(204).end();
    } catch (error) {
      console.error("[friends] Erreur de refus", error);
      next(error);
    }
  });

  app.delete("/api/friends/:id", auth, async (req, res, next) => {
    try {
      const friendship = await Friendship.findOneAndDelete({
        _id: req.params.id,
        status: "accepted",
        $or: [{ requesterId: req.auth.sub }, { addresseeId: req.auth.sub }],
      });
      if (!friendship) return res.status(404).json({ message: "Amitié introuvable" });
      // Retirer un ami arrête aussi tous les partages ciblés dans les deux sens.
      const { requesterId, addresseeId } = friendship;
      const [first, second] = await Promise.all([
        Track.updateMany({ ownerId: requesterId }, { $pull: { sharedWith: addresseeId } }),
        Track.updateMany({ ownerId: addresseeId }, { $pull: { sharedWith: requesterId } }),
      ]);
      console.log(
        `[friends] Amitié ${friendship.id} supprimée, ${first.modifiedCount + second.modifiedCount} partage(s) retiré(s)`,
      );
      res.status(204).end();
    } catch (error) {
      console.error("[friends] Erreur de suppression d'amitié", error);
      next(error);
    }
  });

  /** Retourne une page des pistes personnelles ou des pistes publiques. */
  app.get("/api/tracks", auth, async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
      const publicOnly = req.query.public === "true";
      const friendsOnly = req.query.friends === "true";
      const scope = publicOnly ? "public" : friendsOnly ? "friends" : "mine";
      const friendIds = friendsOnly ? await friendIdsFor(req.auth.sub) : [];
      // q est une recherche optionnelle sur le titre et le nom du fichier.
      const q = String(req.query.q ?? "");
      const filter = buildTrackFilter({ scope, userId: req.auth.sub, friendIds, q });

      console.log(
        `[tracks] Lecture page=${page}, limit=${limit}, scope=${scope}, recherche=${q.trim() ? "oui" : "non"}, user=${req.auth.sub}`,
      );

      // La lecture des pistes et le comptage total sont parallélisés pour réduire la latence.
      // on utilise Promise.all pour exécuter les deux opérations en parallèle. 
      // Track.find() récupère les pistes de l'utilisateur avec pagination, 
      // tandis que Track.countDocuments() compte le nombre total de pistes pour cet utilisateur.
      // Promise.all attend que les deux opérations soient terminées avant de continuer et les résultats
        // sont stockés dans les variables items et total.
      let query = Track.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-storedName")
        // populate remplace ownerId par { _id, name } pour afficher le propriétaire.
        .populate("ownerId", "name");
      // Le propriétaire voit le nom des amis avec qui chaque piste est partagée.
      if (scope === "mine") query = query.populate("sharedWith", "name");

      const [items, total] = await Promise.all([
        query.lean(),
        Track.countDocuments(filter),
      ]);

      // toTrackResponse convertit _id en id, ajoute ownerName et n'expose
      // que les champs utiles au frontend.
      const publicItems = items.map((track) => toTrackResponse(track, req.auth.sub));

      console.log(`[tracks] ${publicItems.length} piste(s) envoyée(s) sur ${total}`);

      // envoi de la réponse JSON avec les pistes publiques, la page actuelle, la limite par page, 
      // le nombre total de pistes et le nombre total de pages.
      res.json({
        items: publicItems,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (error) {
      console.error("[tracks] Erreur de pagination", error);
      next(error);
    }
  });

  /**
   * Fichiers récemment ajoutés par les autres : pistes publiques et pistes
   * partagées par les amis, triées de la plus récente à la plus ancienne.
   */
  app.get("/api/tracks/recent", auth, async (req, res, next) => {
    try {
      const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 6));
      const friendIds = await friendIdsFor(req.auth.sub);
      const items = await Track.find(buildRecentFilter(req.auth.sub, friendIds))
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("-storedName")
        .populate("ownerId", "name")
        .lean();
      console.log(`[tracks] ${items.length} piste(s) récente(s) envoyée(s) à ${req.auth.sub}`);
      res.json(items.map((track) => toTrackResponse(track, req.auth.sub)));
    } catch (error) {
      console.error("[tracks] Erreur de lecture des pistes récentes", error);
      next(error);
    }
  });

  /**
   * Reçoit le champ multipart audio et le champ texte title.
   * upload.single("audio") traite un seul fichier et le place dans req.file,
   * tandis que req.body.title contient le champ texte associé.
   * C'est ici qu'est fait l'upload de fichiers sur le serveur. 
   * Le middleware auth vérifie le JWT avant d'accepter l'upload.
   * Le middleware upload.single("audio") traite le fichier audio envoyé dans le champ "audio" du formulaire
   * ou de l'appel depuis le frontend avec un objet FormData.
   * Si le fichier est accepté, il est stocké sur le disque et ses métadonnées sont enregistrées 
   * dans MongoDB.
   */
  app.post(
    "/api/tracks",
    auth,
    // upload.fields accepte deux champs fichier : « audio » (obligatoire) et
    // « cover » (image de couverture optionnelle). Multer les range dans
    // req.files.audio et req.files.cover, chacun étant un tableau.
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "cover", maxCount: 1 },
    ]),
    async (req, res, next) => {
      // req.file garde le fichier audio, comme avec upload.single("audio").
      req.file = req.files?.audio?.[0];
      const cover = req.files?.cover?.[0];
      // Supprime du disque les fichiers déjà écrits quand la requête échoue.
      const removeUploadedFiles = async () => {
        for (const file of [req.file, cover]) {
          if (!file) continue;
          const uploadedPath = path.join(UPLOADS, file.filename);
          try {
            await fsPromises.unlink(uploadedPath);
            console.log(`[tracks] Fichier temporaire supprimé : ${uploadedPath}`);
          } catch (cleanupError) {
            console.error(
              `[tracks] Impossible de supprimer le fichier temporaire ${uploadedPath}`,
              cleanupError,
            );
          }
        }
      };

      try {
        if (!req.file) {
          console.warn(`[tracks] Upload sans fichier par ${req.auth.sub}`);
          await removeUploadedFiles();
          return res.status(400).json({ message: "Fichier audio requis" });
        }
        if (cover && cover.size > MAX_COVER_SIZE) {
          console.warn(`[tracks] Couverture trop volumineuse : ${cover.size} octets`);
          await removeUploadedFiles();
          return res.status(400).json({ message: "La couverture ne doit pas dépasser 2 Mo" });
        }

        const track = await Track.create({
          coverStoredName: cover?.filename ?? null,
          coverMimeType: cover?.mimetype ?? null,
          ownerId: req.auth.sub,
          title: req.body.title || req.file.originalname,
          originalName: req.file.originalname,
          storedName: req.file.filename,
          mimeType: req.file.mimetype,
          size: req.file.size,
          isPublic: parsePublicFlag(req.body.isPublic ?? req.body.public),
          visibility: ["private", "public", "friends"].includes(req.body.visibility)
            ? req.body.visibility
            : parsePublicFlag(req.body.isPublic ?? req.body.public) ? "public" : "private",
        });

        console.log(`[tracks] Upload enregistré : ${track.id}`);
        res.status(201).json(track.toPublic());
      } catch (error) {
        console.error("[tracks] Erreur après l'enregistrement du fichier", error);

        // Si MongoDB échoue après l'écriture sur disque, on tente de nettoyer
        // les fichiers orphelins. L'erreur de nettoyage est elle aussi loguée.
        await removeUploadedFiles();
        next(error);
      }
    },
  );

  /**
   * Charge une piste (avec ses noms de fichiers techniques) seulement si
   * l'utilisateur a le droit d'y accéder ; sinon renvoie null. Utilisé par
   * l'audio et la couverture pour appliquer exactement la même règle.
   */
  async function findAccessibleTrack(trackId, userId) {
    const track = await Track.findById(trackId).select("+storedName +coverStoredName");
    // L'amitié n'est vérifiée en base que si elle peut changer la décision.
    const needsFriendCheck = track
      && String(track.ownerId) !== String(userId)
      && track.visibility !== "public"
      && !track.isPublic;
    const isFriend = needsFriendCheck ? await areFriends(track.ownerId, userId) : false;
    return canAccessTrack(track, userId, isFriend) ? track : null;
  }

  /**
   * Envoie le contenu binaire d'une piste après vérification des droits.
   * Avec ?download=true, l'en-tête Content-Disposition demande au navigateur
   * d'enregistrer le fichier sous son nom d'origine au lieu de le lire.
   */
  app.get("/api/tracks/:id/audio", auth, async (req, res, next) => {
    try {
      const track = await findAccessibleTrack(req.params.id, req.auth.sub);
      if (!track) {
        console.warn(`[tracks] Audio introuvable ou interdit : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      const audioPath = path.join(UPLOADS, track.storedName);
      if (req.query.download === "true") {
        // res.attachment encode correctement les noms avec accents ou espaces.
        res.attachment(track.originalName);
      }
      res.type(track.mimeType);
      // Ce callback permet de loguer le succès ou l'erreur du transfert.
      res.sendFile(audioPath, (error) => {
        if (error) {
          console.error(`[tracks] Erreur d'envoi audio ${track.id}`, error);
          if (!res.headersSent) next(error);
          return;
        }
        console.log(`[tracks] Audio envoyé : ${track.id}`);
      });
    } catch (error) {
      console.error("[tracks] Erreur de préparation du flux audio", error);
      next(error);
    }
  });

  /** Envoie l'image de couverture, avec les mêmes droits que l'audio. */
  app.get("/api/tracks/:id/cover", auth, async (req, res, next) => {
    try {
      const track = await findAccessibleTrack(req.params.id, req.auth.sub);
      if (!track || !track.coverStoredName) {
        console.warn(`[tracks] Couverture introuvable ou interdite : ${req.params.id}`);
        return res.status(404).json({ message: "Couverture inconnue" });
      }
      res.type(track.coverMimeType);
      // nosniff : le navigateur respecte le type image déclaré.
      res.set("X-Content-Type-Options", "nosniff");
      res.sendFile(path.join(UPLOADS, track.coverStoredName), (error) => {
        if (error) {
          console.error(`[tracks] Erreur d'envoi de la couverture ${track.id}`, error);
          if (!res.headersSent) next(error);
        }
      });
    } catch (error) {
      console.error("[tracks] Erreur de préparation de la couverture", error);
      next(error);
    }
  });

  /** Relit une piste du propriétaire avec les noms des amis partagés. */
  async function ownerTrackResponse(trackId, userId) {
    const track = await Track.findById(trackId)
      .populate("ownerId", "name")
      .populate("sharedWith", "name")
      .lean();
    return toTrackResponse(track, userId);
  }

  /**
   * Modifie le titre, la visibilité et/ou les amis avec qui une piste est
   * partagée. Réservé au propriétaire. Chaque ami de sharedWith doit être un
   * ami accepté. Une piste qui n'est plus privée perd ses partages ciblés,
   * qui n'ont de sens que pour une piste privée.
   */
  app.patch("/api/tracks/:id", auth, async (req, res, next) => {
    try {
      const { error, changes } = parseTrackUpdate(req.body);
      if (error) {
        console.warn(`[tracks] Modification refusée : ${error}`);
        return res.status(400).json({ message: error });
      }

      const track = await Track.findOne({ _id: req.params.id, ownerId: req.auth.sub });
      if (!track) {
        console.warn(`[tracks] Modification impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      if (changes.sharedWith) {
        const friendIds = new Set((await friendIdsFor(req.auth.sub)).map(String));
        const notFriends = changes.sharedWith.filter((id) => !friendIds.has(id));
        if (notFriends.length > 0) {
          console.warn(`[tracks] Partage refusé avec ${notFriends.length} non-ami(s)`);
          return res.status(400).json({ message: "On ne peut partager qu'avec des amis acceptés" });
        }
      }

      if (changes.title !== undefined) track.title = changes.title;
      if (changes.visibility !== undefined) {
        track.visibility = changes.visibility;
        // isPublic est conservé pour compatibilité : il doit suivre visibility,
        // sinon une piste redevenue privée resterait listée comme publique.
        track.isPublic = changes.visibility === "public";
      }
      if (changes.sharedWith !== undefined) track.sharedWith = changes.sharedWith;
      if (track.visibility !== "private") track.sharedWith = [];

      await track.save();
      console.log(`[tracks] Piste ${track.id} modifiée (${Object.keys(changes).join(", ")})`);
      res.json(await ownerTrackResponse(track._id, req.auth.sub));
    } catch (error) {
      console.error("[tracks] Erreur de modification", error);
      next(error);
    }
  });

  /** Arrête le partage d'une piste avec un ami précis. Réservé au propriétaire. */
  app.delete("/api/tracks/:id/shares/:userId", auth, async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.userId)) {
        return res.status(400).json({ message: "Identifiant d'utilisateur invalide" });
      }
      const track = await Track.findOneAndUpdate(
        { _id: req.params.id, ownerId: req.auth.sub },
        { $pull: { sharedWith: req.params.userId } },
        { new: true },
      );
      if (!track) {
        console.warn(`[tracks] Arrêt de partage impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }
      console.log(`[tracks] Partage de ${track.id} arrêté pour ${req.params.userId}`);
      res.json(await ownerTrackResponse(track._id, req.auth.sub));
    } catch (error) {
      console.error("[tracks] Erreur d'arrêt de partage", error);
      next(error);
    }
  });

  /** Supprime la métadonnée et le fichier physique correspondant. */
  app.delete("/api/tracks/:id", auth, async (req, res, next) => {
    try {
      const track = await Track.findOneAndDelete({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+storedName +coverStoredName");

      if (!track) {
        console.warn(`[tracks] Suppression impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      // La couverture est supprimée avec la piste. Un échec est logué mais ne
      // bloque pas la suppression de l'audio.
      if (track.coverStoredName) {
        const coverPath = path.join(UPLOADS, track.coverStoredName);
        try {
          await fsPromises.unlink(coverPath);
          console.log(`[tracks] Couverture supprimée : ${coverPath}`);
        } catch (error) {
          console.error(`[tracks] Couverture non supprimée : ${coverPath}`, error);
        }
      }

      const audioPath = path.join(UPLOADS, track.storedName);
      try {
        await fsPromises.unlink(audioPath);
        console.log(`[tracks] Fichier supprimé : ${audioPath}`);
      } catch (error) {
        // L'exception n'est volontairement pas ignorée : l'administrateur doit
        // voir ce fichier orphelin si sa suppression échoue.
        console.error(`[tracks] Fichier audio non supprimé : ${audioPath}`, error);
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier audio non supprimé",
        });
      }

      res.status(204).end();
    } catch (error) {
      console.error("[tracks] Erreur de suppression", error);
      next(error);
    }
  });

  /** Gestionnaire central des erreurs connues de l'application. */
  app.use((error, _req, res, next) => {
    console.error("[error] Erreur reçue par le gestionnaire central", error);

    if (
      error instanceof multer.MulterError ||
      error?.status === 400 ||
      error?.message === "Format audio non accepté"
    ) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "CastError") {
      return res.status(404).json({ message: "Ressource inconnue" });
    }

    next(error);
  });

  return app;
}
