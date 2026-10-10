import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  it('login utilise POST avec le corps attendu et stocke la réponse', () => {
    let completed = false;
    service.login('user@example.test', 'test-password').subscribe({
      next: () => {
        completed = true;
      },
      error: (error) => {
        throw error;
      },
    });

    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'user@example.test',
      password: 'test-password',
    });
    request.flush({
      token: 'test-token',
      user: {
        id: 'user-id',
        name: 'Test User',
        email: 'user@example.test',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(completed).toBe(true);
    expect(service.token()).toBe('test-token');
    http.verify();
  });
});
