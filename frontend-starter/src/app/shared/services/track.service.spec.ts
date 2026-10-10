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
      && candidate.params.get('limit') === '5',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items: [], page: 3, limit: 5, total: 0, pages: 1 });
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
    expect(body.get('audio')).toBe(file);

    request.event({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    request.flush({
      id: 'track-id',
      title: 'Demo',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      size: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(events).toEqual([
      HttpEventType.Sent,
      HttpEventType.UploadProgress,
      HttpEventType.Response,
    ]);
    http.verify();
  });
});
