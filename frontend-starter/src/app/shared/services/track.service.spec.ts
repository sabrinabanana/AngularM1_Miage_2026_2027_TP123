import { HttpEventType } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrackService } from './track.service';

describe('TrackService', () => {
  let service: TrackService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TrackService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TrackService);
    http = TestBed.inject(HttpTestingController);
  });

  it('list transmet page et limit au serveur', () => {
    service.list(3, 5).subscribe();

    const request = http.expectOne((candidate) =>
      candidate.url === '/api/tracks'
      && candidate.params.get('page') === '3'
      && candidate.params.get('limit') === '5'
      && candidate.params.get('public') === 'false',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items: [], page: 3, limit: 5, total: 0, pages: 1 });
    http.verify();
  });

  it('list transmet le filtre public au serveur', () => {
    service.list(1, 5, true).subscribe();

    const request = http.expectOne((candidate) =>
      candidate.url === '/api/tracks'
      && candidate.params.get('public') === 'true',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
    http.verify();
  });

  it('list transmet la recherche nettoyée dans le paramètre q', () => {
    service.list(1, 5, true, false, '  blues  ').subscribe();

    const request = http.expectOne((candidate) =>
      candidate.url === '/api/tracks' && candidate.params.get('q') === 'blues',
    );
    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
    http.verify();
  });

  it('list n’envoie pas q quand la recherche est vide', () => {
    service.list(1, 5, false, false, '   ').subscribe();

    const request = http.expectOne('/api/tracks?page=1&limit=5&public=false&friends=false');
    expect(request.request.params.has('q')).toBe(false);
    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
    http.verify();
  });

  it('recent appelle /api/tracks/recent avec la limite', () => {
    let received: unknown[] = [];
    service.recent(4).subscribe((tracks) => (received = tracks));

    const request = http.expectOne((candidate) =>
      candidate.url === '/api/tracks/recent' && candidate.params.get('limit') === '4',
    );
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 't1', title: 'Récente', ownerName: 'Alice' }]);
    expect(received.length).toBe(1);
    http.verify();
  });

  it('upload joint la couverture quand elle est fournie', () => {
    const file = new File(['audio-data'], 'demo.mp3', { type: 'audio/mpeg' });
    const cover = new File(['image-data'], 'cover.png', { type: 'image/png' });

    service.upload(file, 'Demo', 'private', cover).subscribe();

    const request = http.expectOne('/api/tracks');
    expect((request.request.body as FormData).get('cover')).toBe(cover);
    request.flush({ id: 'track-id', hasCover: true });
    http.verify();
  });

  it('upload n’envoie pas de champ cover sans couverture', () => {
    const file = new File(['audio-data'], 'demo.mp3', { type: 'audio/mpeg' });

    service.upload(file, 'Demo').subscribe();

    const request = http.expectOne('/api/tracks');
    expect((request.request.body as FormData).has('cover')).toBe(false);
    request.flush({ id: 'track-id' });
    http.verify();
  });

  it('download demande l’audio en pièce jointe sous forme de Blob', () => {
    service.download('track-id').subscribe();

    const request = http.expectOne((candidate) =>
      candidate.url === '/api/tracks/track-id/audio' && candidate.params.get('download') === 'true',
    );
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['audio']));
    http.verify();
  });

  it('cover charge l’image de couverture en Blob', () => {
    service.cover('track-id').subscribe();

    const request = http.expectOne('/api/tracks/track-id/cover');
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['image']));
    http.verify();
  });

  it('update envoie un PATCH avec la visibilité et les amis choisis', () => {
    const changes = { title: 'Solo', visibility: 'private' as const, sharedWith: ['friend-1'] };
    service.update('track-id', changes).subscribe();

    const request = http.expectOne('/api/tracks/track-id');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(changes);
    request.flush({ id: 'track-id' });
    http.verify();
  });

  it('unshare supprime le partage d’un ami précis', () => {
    service.unshare('track-id', 'friend-1').subscribe();

    const request = http.expectOne('/api/tracks/track-id/shares/friend-1');
    expect(request.request.method).toBe('DELETE');
    request.flush({ id: 'track-id', sharedWith: [] });
    http.verify();
  });

  it('delete utilise DELETE sur l’identifiant de la piste', () => {
    let completed = false;
    service.delete('track-id').subscribe({
      next: () => {
        completed = true;
      },
      error: (error) => {
        throw error;
      },
    });

    const request = http.expectOne('/api/tracks/track-id');
    expect(request.request.method).toBe('DELETE');
    request.flush(null);

    expect(completed).toBe(true);
    http.verify();
  });

  it('upload expose les événements de progression puis la réponse finale', () => {
    const events: HttpEventType[] = [];
    const file = new File(['audio-data'], 'demo.mp3', { type: 'audio/mpeg' });

    service.upload(file, 'Demo').subscribe((event) => events.push(event.type));

    const request = http.expectOne('/api/tracks');
    expect(request.request.method).toBe('POST');
    expect(request.request.reportProgress).toBe(true);
    expect(request.request.body).toBeInstanceOf(FormData);
    const body = request.request.body as FormData;
    expect(body.get('title')).toBe('Demo');
    expect(body.get('isPublic')).toBe('false');
    expect(body.get('visibility')).toBe('private');
    expect(body.get('audio')).toBe(file);

    request.event({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    request.flush({
      id: 'track-id',
      title: 'Demo',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      size: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      ownerId: 'owner-id',
      isPublic: false,
      visibility: 'private',
    });

    expect(events).toEqual([
      HttpEventType.Sent,
      HttpEventType.UploadProgress,
      HttpEventType.Response,
    ]);
    http.verify();
  });

  it('upload transmet la visibilité publique dans le FormData', () => {
    const file = new File(['audio-data'], 'public.mp3', { type: 'audio/mpeg' });

    service.upload(file, 'Public', 'public').subscribe();

    const request = http.expectOne('/api/tracks');
    const body = request.request.body as FormData;
    expect(body.get('isPublic')).toBe('true');
    expect(body.get('visibility')).toBe('public');
    request.flush({
      id: 'track-id',
      ownerId: 'owner-id',
      title: 'Public',
      originalName: 'public.mp3',
      mimeType: 'audio/mpeg',
      size: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      isPublic: true,
      visibility: 'public',
    });
    http.verify();
  });
});
