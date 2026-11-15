import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly isDarkMode = signal(this.loadThemePreference());

  constructor() {
    this.applyTheme();
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  toggleTheme(): void {
    this.isDarkMode.update((isDark) => !isDark);
    this.applyTheme();
    this.document.defaultView?.localStorage.setItem(
      'guitar-practice-theme',
      this.isDarkMode() ? 'dark' : 'light',
    );
  }

  private loadThemePreference(): boolean {
    return this.document.defaultView?.localStorage.getItem('guitar-practice-theme') === 'dark';
  }

  private applyTheme(): void {
    this.document.documentElement.dataset['theme'] = this.isDarkMode() ? 'dark' : 'light';
  }
}
