export type TrackVisibility = 'private' | 'public' | 'friends';

/** Ami avec qui une piste privée est partagée (visible par le propriétaire). */
export interface TrackShare {
  id: string;
  name: string | null;
}

/** Corps accepté par PATCH /api/tracks/:id. */
export interface TrackUpdate {
  title?: string;
  visibility?: TrackVisibility;
  sharedWith?: string[];
}

/** Audio track metadata returned by the API. */
export interface Track {
  id: string;
  ownerId: string;
  /** Nom du propriétaire, renvoyé par les listes et les pistes récentes. */
  ownerName?: string | null;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  isPublic: boolean;
  visibility: TrackVisibility;
  /** Vrai si une image de couverture est enregistrée sur le serveur. */
  hasCover?: boolean;
  /** Présent seulement pour le propriétaire. */
  sharedWith?: TrackShare[];
  /** Présent pour les autres utilisateurs : piste partagée individuellement avec eux. */
  sharedWithMe?: boolean;
}
