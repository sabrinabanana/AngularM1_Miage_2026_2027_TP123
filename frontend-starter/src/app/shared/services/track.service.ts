import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpRequest } from '@angular/common/http';
import { Page } from '../models/page.model';
import { Track, TrackUpdate, TrackVisibility } from '../models/track.model';

/** Encapsulates all HTTP operations for backing tracks. */
@Injectable({ providedIn: 'root' })
export class TrackService {
  private readonly http = inject(HttpClient);

  list(page = 1, limit = 5, publicOnly = false, friendsOnly = false, query = '') {
    const params: Record<string, string | number | boolean> = {
      page,
      limit,
      public: publicOnly,
      friends: friendsOnly,
    };
    const search = query.trim();
    if (search) {
      params['q'] = search;
    }
    return this.http.get<Page<Track>>('/api/tracks', { params });
  }

  /** Pistes publiques ou partagées par les amis, les plus récentes d'abord. */
  recent(limit = 6) {
    return this.http.get<Track[]>('/api/tracks/recent', { params: { limit } });
  }

  upload(file: File, title: string, visibility: TrackVisibility = 'private', cover?: File) {
    const body = new FormData();
    body.append('audio', file);
    body.append('title', title);
    body.append('visibility', visibility);
    body.append('isPublic', String(visibility === 'public'));
    if (cover) {
      body.append('cover', cover);
    }
    const request = new HttpRequest('POST', '/api/tracks', body, {
      reportProgress: true,
    });
    return this.http.request<Track>(request);
  }

  audio(id: string) {
    return this.http.get(`/api/tracks/${id}/audio`, {
      responseType: 'blob',
    });
  }

  /** Télécharge le fichier audio (Content-Disposition: attachment côté serveur). */
  download(id: string) {
    return this.http.get(`/api/tracks/${id}/audio`, {
      params: { download: true },
      responseType: 'blob',
    });
  }

  /** Image de couverture, protégée par JWT comme l'audio. */
  cover(id: string) {
    return this.http.get(`/api/tracks/${id}/cover`, { responseType: 'blob' });
  }

  /** Modifie titre, visibilité et/ou amis partagés (propriétaire uniquement). */
  update(id: string, changes: TrackUpdate) {
    return this.http.patch<Track>(`/api/tracks/${id}`, changes);
  }

  /** Arrête le partage d'une piste avec un ami précis. */
  unshare(id: string, userId: string) {
    return this.http.delete<Track>(`/api/tracks/${id}/shares/${userId}`);
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/tracks/${id}`);
  }
}
