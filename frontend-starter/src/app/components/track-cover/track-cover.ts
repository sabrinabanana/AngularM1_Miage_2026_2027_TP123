import { Component, effect, inject, input, signal } from '@angular/core';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

/**
 * Vignette de couverture d'une piste. L'image est protégée par JWT : une
 * balise <img src="/api/..."> n'enverrait pas l'en-tête Authorization. Le
 * composant la charge donc en Blob via HttpClient, puis l'affiche avec une
 * URL locale. Sans couverture (ou en cas d'erreur), une note de musique
 * sert d'image par défaut.
 */
@Component({
  selector: 'app-track-cover',
  template: `
    @if (url()) {
      <img [src]="url()" [alt]="'Couverture de ' + track().title" />
    } @else {
      <span class="placeholder" aria-hidden="true">♪</span>
    }
  `,
  styles: `
    :host { display: block; flex-shrink: 0; width: 56px; height: 56px; }
    img, .placeholder { display: block; width: 100%; height: 100%; border-radius: 8px; }
    img { object-fit: cover; }
    .placeholder {
      display: grid; place-items: center; font-size: 1.5rem;
      color: var(--muted-text); border: 1px solid var(--input-border);
    }
  `,
})
export class TrackCoverComponent {
  private readonly service = inject(TrackService);

  readonly track = input.required<Track>();
  readonly url = signal('');

  constructor() {
    // L'effet se relance si la piste change ; onCleanup annule la requête en
    // cours et libère l'URL Blob précédente, y compris à la destruction.
    effect((onCleanup) => {
      const track = this.track();
      this.url.set('');
      if (!track.hasCover) return;

      let objectUrl = '';
      const subscription = this.service.cover(track.id).subscribe({
        next: (blob) => {
          objectUrl = URL.createObjectURL(blob);
          this.url.set(objectUrl);
        },
        error: (error) => {
          console.error('[TrackCover] Couverture indisponible', error);
        },
      });
      onCleanup(() => {
        subscription.unsubscribe();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      });
    });
  }
}
