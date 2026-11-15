import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FriendService } from './friend.service';

describe('FriendService', () => {
  let service: FriendService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FriendService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FriendService);
    http = TestBed.inject(HttpTestingController);
  });

  it('recherche un utilisateur par texte', () => {
    service.search('alice').subscribe();
    const request = http.expectOne((candidate) =>
      candidate.url === '/api/users/search' && candidate.params.get('q') === 'alice');
    expect(request.request.method).toBe('GET');
    request.flush([]);
    http.verify();
  });

  it('charge le fil d’activité avec la limite demandée', () => {
    let count = -1;
    service.activity(10).subscribe((items) => (count = items.length));
    const request = http.expectOne((candidate) =>
      candidate.url === '/api/friends/activity' && candidate.params.get('limit') === '10');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 'friendship:1', type: 'friendship', date: '2026-11-01', user: { id: 'a', name: 'Alice' } }]);
    expect(count).toBe(1);
    http.verify();
  });

  it('envoie une demande et accepte une relation', () => {
    service.request('user-id').subscribe();
    const request = http.expectOne('/api/friends/request');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ userId: 'user-id' });
    request.flush({});

    service.accept('friendship-id').subscribe();
    const accept = http.expectOne('/api/friends/accept/friendship-id');
    expect(accept.request.method).toBe('POST');
    accept.flush({});
    http.verify();
  });
});
