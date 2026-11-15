import { Track } from './track.model';

/** Élément du fil d'activité renvoyé par GET /api/friends/activity. */
export interface Activity {
  /** Identifiant unique dans le fil, par exemple « track:… » ou « friendship:… ». */
  id: string;
  /** « track » : un ami a ajouté une piste visible ; « friendship » : nouvelle amitié. */
  type: 'track' | 'friendship';
  date: string;
  user: { id: string; name: string | null };
  /** Présent uniquement pour le type « track ». */
  track?: Track;
}
