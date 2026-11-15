import mongoose from "mongoose";

/*
 * Ce schéma conserve les métadonnées d'une piste. Le fichier audio lui-même
 * reste sur le disque ; storedName contient le nom technique utilisé côté
 * serveur et n'est jamais exposé par toPublic().
 */
const schema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    isPublic: { type: Boolean, default: false, index: true },
    visibility: {
      type: String,
      enum: ["private", "public", "friends"],
      default: "private",
      index: true,
    },
    // Image de couverture optionnelle, stockée sur disque comme l'audio.
    // coverStoredName reste masqué ; coverMimeType sert aussi à savoir si une
    // couverture existe (hasCover) sans exposer le nom technique.
    coverStoredName: { type: String, default: null, select: false },
    coverMimeType: { type: String, default: null },
    // Partage ciblé : amis autorisés à écouter une piste privée.
    // L'amitié est revérifiée à chaque accès : retirer un ami coupe le partage.
    sharedWith: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
      index: true,
    },
  },
  { timestamps: true },
);

// Cet index accélère la liste des pistes d'un utilisateur triées par date.
schema.index({ ownerId: 1, createdAt: -1 });

/**
 * Convertit un document Mongoose en objet sûr pour le frontend.
 * L'identifiant MongoDB devient la propriété simple `id` attendue par Angular.
 */
schema.methods.toPublic = function () {
  console.debug(`[track-model] Préparation de la piste publique ${this.id}`);
  return {
    id: this.id,
    ownerId: String(this.ownerId),
    title: this.title,
    originalName: this.originalName,
    mimeType: this.mimeType,
    size: this.size,
    isPublic: this.visibility === "public" || this.isPublic === true,
    visibility: this.visibility ?? (this.isPublic ? "public" : "private"),
    hasCover: Boolean(this.coverMimeType),
    // toPublic n'est utilisé que pour le propriétaire (upload) : il peut voir ses partages.
    sharedWith: (this.sharedWith ?? []).map((id) => ({ id: String(id), name: null })),
    createdAt: this.createdAt,
  };
};

export const Track = mongoose.model("Track", schema);
