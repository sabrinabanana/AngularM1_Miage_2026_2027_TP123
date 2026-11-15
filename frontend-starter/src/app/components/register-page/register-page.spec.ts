import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPageComponent } from './register-page';
import { AuthService } from '../../shared/services/auth.service';

describe('RegisterPageComponent', () => {
  let auth: { register: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = { register: vi.fn(() => of({})) };
    TestBed.configureTestingModule({
      imports: [RegisterPageComponent],
      providers: [{ provide: AuthService, useValue: auth }, provideRouter([{ path: 'profile', children: [] }])],
    });
  });

  function fill(name: string) {
    const fixture = TestBed.createComponent(RegisterPageComponent);
    fixture.componentInstance.form.setValue({ name, email: 'b@example.com', password: '12345678' });
    return fixture;
  }

  it('refuse un nom d’un seul caractère sans appeler le serveur', () => {
    const fixture = fill('b');

    fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(auth.register).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('au moins 2 caractères');
  });

  it('refuse un nom d’un caractère entouré d’espaces', () => {
    const fixture = fill(' b ');

    fixture.componentInstance.submit();

    expect(auth.register).not.toHaveBeenCalled();
  });

  it('accepte un nom de deux caractères', () => {
    const fixture = fill('Bo');

    fixture.componentInstance.submit();

    expect(auth.register).toHaveBeenCalledWith('Bo', 'b@example.com', '12345678');
  });
});
