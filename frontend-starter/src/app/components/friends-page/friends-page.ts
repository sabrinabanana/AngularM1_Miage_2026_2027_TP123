import { Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { Activity } from '../../shared/models/activity.model';
import { FriendLists } from '../../shared/models/friendship.model';
import { Track } from '../../shared/models/track.model';
import { User } from '../../shared/models/user.model';
import { FriendService } from '../../shared/services/friend.service';
import { TrackService } from '../../shared/services/track.service';
import { TrackCoverComponent } from '../track-cover/track-cover';

@Component({
  imports: [FormsModule, TrackCoverComponent],
  templateUrl: './friends-page.html',
  styleUrl: './friends-page.css',
})
export class FriendsPageComponent implements OnDestroy {
  private readonly service = inject(FriendService);
  readonly query = signal('');
  readonly results = signal<User[]>([]);
  readonly lists = signal<FriendLists>({ friends: [], incoming: [], outgoing: [] });
  readonly error = signal('');
  readonly loading = signal(false);
  private readonly trackService = inject(TrackService);
  readonly activity = signal<Activity[]>([]);
  readonly activityLoading = signal(false);
  readonly activityError = signal('');
  /** Lecteur intégré au fil : URL Blob de la piste en cours et son titre. */
  readonly audioUrl = signal('');
  readonly playingTitle = signal('');
  readonly playingTrackId = signal<string | null>(null);
  readonly playing = signal(false);
  private readonly player = viewChild<ElementRef<HTMLAudioElement>>('player');
  readonly audioLoadingId = signal<string | null>(null);
  readonly audioError = signal('');
  private readonly searchTerms = new Subject<string>();
  private readonly searchSubscription: Subscription;

  constructor() {
    this.searchSubscription = this.searchTerms.pipe(
      debounceTime(300),
      distinctUntilChanged(),
    ).subscribe((query) => this.performSearch(query));
    this.load();
    this.loadActivity();
  }

  loadActivity(): void {
    this.activityError.set('');
    this.activityLoading.set(true);
    this.service.activity().subscribe({
      next: (items) => {
        this.activity.set(items);
        this.activityLoading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[FriendsPage] Activité indisponible', error);
        this.activityError.set(error.error?.message ?? 'Impossible de charger l’activité de vos amis.');
        this.activityLoading.set(false);
      },
    });
  }

  /** Charge l'audio protégé par JWT en Blob, puis le donne au lecteur du fil. */
  play(track: Track): void {
    if (this.audioLoadingId()) return;
    this.audioError.set('');
    this.audioLoadingId.set(track.id);
    this.trackService.audio(track.id).subscribe({
      next: (blob) => {
        this.revokeAudioUrl();
        this.audioUrl.set(URL.createObjectURL(blob));
        this.playingTitle.set(track.title);
        this.playingTrackId.set(track.id);
        this.audioLoadingId.set(null);
      },
      error: (error: { status?: number }) => {
        console.error('[FriendsPage] Lecture impossible', error);
        this.audioLoadingId.set(null);
        this.audioError.set(
          error.status === 404
            ? 'Cette piste n’est plus partagée avec vous.'
            : 'Impossible de charger cet audio.',
        );
      },
    });
  }

  isPlayingTrack(track: Track): boolean {
    return this.playing() && this.playingTrackId() === track.id;
  }

  /** Lecture/pause : reprend la piste déjà chargée au lieu de la retélécharger. */
  togglePlay(track: Track): void {
    const audio = this.player()?.nativeElement;
    if (audio && this.audioUrl() && this.playingTrackId() === track.id) {
      if (audio.paused) {
        void audio.play().catch((error: unknown) => {
          console.error('[FriendsPage] Reprise impossible', error);
          this.audioError.set('Impossible de reprendre la lecture.');
        });
      } else {
        audio.pause();
      }
      return;
    }
    this.play(track);
  }

  activityText(item: Activity): string {
    const name = item.user.name ?? 'Un ami';
    if (item.type === 'friendship') {
      return `Vous êtes maintenant ami avec ${name}`;
    }
    const track = item.track;
    if (track?.sharedWithMe) return `${name} a partagé une piste avec vous`;
    if (track?.visibility === 'friends') return `${name} a partagé une piste avec ses amis`;
    return `${name} a publié une piste`;
  }

  formatDate(date: string): string {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
  }

  private revokeAudioUrl(): void {
    const url = this.audioUrl();
    if (url) URL.revokeObjectURL(url);
  }

  search(): void {
    this.performSearch(this.query());
  }

  queryChanged(value: string): void {
    this.query.set(value);
    this.searchTerms.next(value);
  }

  private performSearch(value: string): void {
    const query = value.trim();
    if (query.length < 2) {
      this.results.set([]);
      return;
    }
    this.service.search(query).subscribe({
      next: (users) => this.results.set(users),
      error: (error: { error?: { message?: string } }) => this.error.set(error.error?.message ?? 'Recherche impossible.'),
    });
  }

  ngOnDestroy(): void {
    this.searchSubscription.unsubscribe();
    this.revokeAudioUrl();
  }

  load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (lists) => {
        this.lists.set(lists);
        this.loading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        this.error.set(error.error?.message ?? 'Impossible de charger le réseau.');
        this.loading.set(false);
      },
    });
  }

  request(user: User): void {
    this.service.request(user.id).subscribe({
      next: () => {
        this.results.update((users) => users.filter((candidate) => candidate.id !== user.id));
        this.load();
      },
      error: (error: { error?: { message?: string } }) => this.error.set(error.error?.message ?? 'Demande impossible.'),
    });
  }

  accept(id: string): void {
    this.service.accept(id).subscribe({ next: () => this.refresh(), error: () => this.error.set('Acceptation impossible.') });
  }

  reject(id: string): void {
    this.service.reject(id).subscribe({ next: () => this.load(), error: () => this.error.set('Refus impossible.') });
  }

  remove(id: string): void {
    this.service.remove(id).subscribe({ next: () => this.refresh(), error: () => this.error.set('Suppression impossible.') });
  }

  /** Accepter ou retirer un ami change aussi le fil d'activité. */
  private refresh(): void {
    this.load();
    this.loadActivity();
  }
}
