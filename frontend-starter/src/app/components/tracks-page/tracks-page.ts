import { Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpEventType } from '@angular/common/http';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Track, TrackShare } from '../../shared/models/track.model';
import { User } from '../../shared/models/user.model';
import { FriendService } from '../../shared/services/friend.service';
import { TrackService } from '../../shared/services/track.service';
import { saveBlob } from '../../shared/utils/save-blob';
import { TrackCoverComponent } from '../track-cover/track-cover';
import { TrackShareEditorComponent } from '../track-share-editor/track-share-editor';

@Component({
  imports: [MatPaginatorModule, MatSnackBarModule, ReactiveFormsModule, TrackCoverComponent, TrackShareEditorComponent],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent implements OnDestroy {
  private readonly service = inject(TrackService);
  private readonly friendService = inject(FriendService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly maxFileSize = 25 * 1024 * 1024;
  private readonly allowedMimeTypes = new Set([
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
  ]);

  private readonly allowedCoverTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  private readonly maxCoverSize = 2 * 1024 * 1024;

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('coverInput') private coverInput?: ElementRef<HTMLInputElement>;
  @ViewChild('audioElement') private audioElement?: ElementRef<HTMLAudioElement>;
  @ViewChild('visualizer') private visualizer?: ElementRef<HTMLCanvasElement>;
  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly limit = signal(5);
  readonly pages = signal(1);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly uploadLoading = signal(false);
  readonly uploadProgress = signal<number | null>(null);
  readonly uploadError = signal('');
  readonly uploadSuccess = signal('');
  readonly selectedFileName = signal('');
  readonly coverPreviewUrl = signal('');
  readonly coverFileName = signal('');
  readonly audioUrl = signal('');
  readonly audioLoading = signal(false);
  readonly audioError = signal('');
  readonly deletingTrackId = signal<string | null>(null);
  readonly currentTrackTitle = signal('');
  readonly publicOnly = signal(false);
  readonly friendsOnly = signal(false);
  readonly visibility = signal<'private' | 'public' | 'friends'>('private');
  readonly pan = signal(0);
  readonly bassGain = signal(0);
  readonly trebleGain = signal(0);
  readonly title = new FormControl('', { nonNullable: true });
  /** Recherche texte appliquée à l'onglet courant (titre ou nom du fichier). */
  readonly search = new FormControl('', { nonNullable: true });
  readonly recentTracks = signal<Track[]>([]);
  readonly recentLoading = signal(false);
  readonly recentError = signal('');
  /** Piste dont le panneau de partage est ouvert (une seule à la fois). */
  readonly editingTrackId = signal<string | null>(null);
  readonly friends = signal<User[]>([]);
  readonly friendsLoading = signal(false);
  /** Clé « trackId:userId » du partage en cours d'arrêt, pour désactiver le bouton. */
  readonly unsharingKey = signal<string | null>(null);
  readonly downloadingTrackId = signal<string | null>(null);
  /** Piste actuellement chargée dans le lecteur, et état lecture/pause. */
  readonly currentTrackId = signal<string | null>(null);
  readonly playing = signal(false);
  private friendsLoaded = false;
  private coverFile?: File;
  file?: File;
  private audioContext?: AudioContext;
  private mediaSource?: MediaElementAudioSourceNode;
  private analyser?: AnalyserNode;
  private bassFilter?: BiquadFilterNode;
  private trebleFilter?: BiquadFilterNode;
  private stereoPanner?: StereoPannerNode;
  private animationFrameId?: number;

  constructor() {
    // Le debounce évite un appel HTTP à chaque touche ; une nouvelle
    // recherche repart toujours de la première page.
    this.search.valueChanges.pipe(
      map((value) => value.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(),
    ).subscribe(() => {
      this.page.set(1);
      this.load();
    });
    this.load();
    this.loadRecent();
  }

  loadRecent(): void {
    this.recentError.set('');
    this.recentLoading.set(true);
    this.service.recent().subscribe({
      next: (tracks) => {
        this.recentTracks.set(tracks);
        this.recentLoading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[TracksPage] Pistes récentes indisponibles', error);
        this.recentError.set(error.error?.message ?? 'Impossible de charger les ajouts récents.');
        this.recentLoading.set(false);
      },
    });
  }

  clearSearch(): void {
    this.search.setValue('');
  }

  isOwnScope(): boolean {
    return !this.publicOnly() && !this.friendsOnly();
  }

  /** Ouvre (ou ferme) le panneau de partage ; la liste d'amis n'est chargée qu'une fois. */
  toggleEditor(track: Track): void {
    if (this.editingTrackId() === track.id) {
      this.editingTrackId.set(null);
      return;
    }
    this.editingTrackId.set(track.id);
    if (!this.friendsLoaded) {
      this.loadFriends();
    }
  }

  closeEditor(): void {
    this.editingTrackId.set(null);
  }

  trackSaved(updated: Track): void {
    this.replaceTrack(updated);
    this.editingTrackId.set(null);
    this.snackBar.open('Piste mise à jour.', 'Fermer', { duration: 4000 });
  }

  unshare(track: Track, share: TrackShare): void {
    const key = `${track.id}:${share.id}`;
    if (this.unsharingKey()) return;
    this.unsharingKey.set(key);
    this.service.unshare(track.id, share.id).subscribe({
      next: (updated) => {
        this.unsharingKey.set(null);
        this.replaceTrack(updated);
        this.snackBar.open(`Partage arrêté avec ${share.name ?? 'cet ami'}.`, 'Fermer', { duration: 4000 });
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[TracksPage] Arrêt du partage impossible', error);
        this.unsharingKey.set(null);
        this.snackBar.open(error.error?.message ?? 'Impossible d’arrêter ce partage.', 'Fermer', { duration: 5000 });
      },
    });
  }

  /** Repasse la piste en privé sans aucun partage : plus personne d'autre n'y a accès. */
  stopAllSharing(track: Track): void {
    if (!window.confirm(`Rendre « ${track.title} » privée et arrêter tous ses partages ?`)) {
      return;
    }
    this.service.update(track.id, { visibility: 'private', sharedWith: [] }).subscribe({
      next: (updated) => {
        this.replaceTrack(updated);
        this.snackBar.open('Tous les partages ont été arrêtés.', 'Fermer', { duration: 4000 });
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[TracksPage] Arrêt des partages impossible', error);
        this.snackBar.open(error.error?.message ?? 'Impossible d’arrêter les partages.', 'Fermer', { duration: 5000 });
      },
    });
  }

  isShared(track: Track): boolean {
    return track.visibility !== 'private' || track.isPublic || (track.sharedWith?.length ?? 0) > 0;
  }

  visibilityLabel(track: Track): string {
    if (track.visibility === 'public' || track.isPublic) return 'Publique';
    // sharedWith n'est présent que pour le propriétaire de la piste.
    if (track.visibility === 'friends') return track.sharedWith ? 'Tous mes amis' : 'Amis';
    if (track.sharedWithMe) return 'Partagée avec vous';
    const count = track.sharedWith?.length ?? 0;
    if (count > 0) return `Privée · partagée avec ${count} ami${count > 1 ? 's' : ''}`;
    return 'Privée';
  }

  private loadFriends(): void {
    this.friendsLoading.set(true);
    this.friendService.list().subscribe({
      next: (lists) => {
        this.friends.set(lists.friends.map((relation) => relation.user));
        this.friendsLoaded = true;
        this.friendsLoading.set(false);
      },
      error: (error) => {
        console.error('[TracksPage] Amis indisponibles', error);
        this.friendsLoading.set(false);
        this.snackBar.open('Impossible de charger vos amis.', 'Fermer', { duration: 5000 });
      },
    });
  }

  private replaceTrack(updated: Track): void {
    this.tracks.update((tracks) => tracks.map((track) => (track.id === updated.id ? updated : track)));
  }

  choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.uploadError.set('');
    this.uploadSuccess.set('');
    this.uploadProgress.set(null);
    this.file = file;
    this.selectedFileName.set(file?.name ?? '');

    if (file && !this.isValidFile(file)) {
      this.file = undefined;
      this.selectedFileName.set('');
      this.resetFileInput();
      return;
    }

    console.debug('[TracksPage] Fichier audio sélectionné');
  }

  chooseCover(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.uploadError.set('');
    this.clearCover();
    if (!file) {
      return;
    }
    // Mêmes règles que le serveur : JPEG, PNG ou WebP, 2 Mo maximum.
    if (!this.allowedCoverTypes.has(file.type)) {
      this.uploadError.set('La couverture doit être une image JPEG, PNG ou WebP.');
      this.resetCoverInput();
      return;
    }
    if (file.size > this.maxCoverSize) {
      this.uploadError.set('La couverture ne doit pas dépasser 2 Mo.');
      this.resetCoverInput();
      return;
    }

    this.coverFile = file;
    this.coverFileName.set(file.name);
    this.coverPreviewUrl.set(URL.createObjectURL(file));
  }

  /** Télécharge le fichier audio sous son nom d'origine. */
  download(track: Track): void {
    if (this.downloadingTrackId()) return;
    this.downloadingTrackId.set(track.id);
    this.service.download(track.id).subscribe({
      next: (blob) => {
        this.downloadingTrackId.set(null);
        saveBlob(blob, track.originalName);
      },
      error: (error: { status?: number }) => {
        console.error('[TracksPage] Téléchargement impossible', error);
        this.downloadingTrackId.set(null);
        this.snackBar.open(
          error.status === 404
            ? 'Cette piste n’est plus disponible.'
            : 'Impossible de télécharger cette piste.',
          'Fermer',
          { duration: 5000 },
        );
      },
    });
  }

  /** Type de badge affiché à côté du titre. */
  visibilityKind(track: Track): 'public' | 'friends' | 'shared' | 'private' {
    if (track.visibility === 'public' || track.isPublic) return 'public';
    if (track.visibility === 'friends') return 'friends';
    if (track.sharedWithMe || (track.sharedWith?.length ?? 0) > 0) return 'shared';
    return 'private';
  }

  private clearCover(): void {
    const previousUrl = this.coverPreviewUrl();
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    this.coverFile = undefined;
    this.coverFileName.set('');
    this.coverPreviewUrl.set('');
  }

  private resetCoverInput(): void {
    if (this.coverInput) {
      this.coverInput.nativeElement.value = '';
    }
  }

  load(): void {
    this.error.set('');
    this.loading.set(true);
    this.service.list(
      this.page(),
      this.limit(),
      this.publicOnly(),
      this.friendsOnly(),
      this.search.value.trim(),
    ).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length);
        this.tracks.set(response.items);
        this.page.set(response.page);
        this.limit.set(response.limit);
        this.total.set(response.total);
        this.pages.set(response.pages);
        this.loading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[TracksPage] Chargement impossible', error);
        this.error.set(error.error?.message ?? 'Impossible de charger les pistes.');
        this.loading.set(false);
      },
    });
  }

  changePage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.limit.set(event.pageSize);
    this.load();
  }

  upload(): void {
    this.uploadError.set('');
    this.uploadSuccess.set('');
    const file = this.file;
    if (!file) {
      this.uploadError.set('Sélectionnez un fichier audio.');
      return;
    }
    if (!this.isValidFile(file)) {
      return;
    }
    if (this.uploadLoading()) {
      return;
    }

    this.uploadLoading.set(true);
    this.uploadProgress.set(0);
    const title = this.title.value.trim() || file.name;
    const visibility = this.visibility();
    console.debug('[TracksPage] Visibilité sélectionnée', visibility);
    this.service.upload(file, title, visibility, this.coverFile).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = event.total
            ? Math.round((event.loaded / event.total) * 100)
            : null;
          this.uploadProgress.set(progress);
          return;
        }

        if (event.type === HttpEventType.Response) {
          console.debug('[TracksPage] Piste envoyée');
          this.title.setValue('');
          this.file = undefined;
          this.selectedFileName.set('');
          this.resetFileInput();
          this.clearCover();
          this.resetCoverInput();
          this.uploadLoading.set(false);
          this.uploadProgress.set(100);
          this.uploadSuccess.set('La piste a été envoyée avec succès.');
          this.page.set(1);
          this.load();
        }
      },
      error: (error: { status?: number; error?: { message?: string } }) => {
        console.error('[TracksPage] Envoi impossible', error);
        this.uploadLoading.set(false);
        this.uploadProgress.set(0);
        this.uploadError.set(
          error.status === 400
            ? error.error?.message ?? 'Le fichier audio est invalide.'
            : error.error?.message ?? 'Impossible d’envoyer la piste.',
        );
      },
    });
  }

  setVisibility(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'private' || value === 'public' || value === 'friends') {
      this.visibility.set(value);
    }
  }

  setPan(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.pan.set(value);
    if (this.stereoPanner) {
      this.stereoPanner.pan.value = value;
    }
  }

  setBassGain(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.bassGain.set(value);
    if (this.bassFilter) {
      this.bassFilter.gain.value = value;
    }
  }

  setTrebleGain(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.trebleGain.set(value);
    if (this.trebleFilter) {
      this.trebleFilter.gain.value = value;
    }
  }

  audioStarted(): void {
    if (this.audioContext?.state === 'suspended') {
      void this.audioContext.resume();
    }
    this.startVisualizer();
    this.playing.set(true);
  }

  audioReady(audio: HTMLAudioElement): void {
    this.initializeAudioGraph(audio);
  }

  audioPaused(): void {
    this.stopVisualizer();
    this.playing.set(false);
  }

  /** Vrai si cette piste est celle du lecteur et qu'elle est en cours de lecture. */
  isPlayingTrack(track: Track): boolean {
    return this.playing() && this.currentTrackId() === track.id;
  }

  /**
   * Bouton lecture/pause d'une piste. Si la piste est déjà dans le lecteur,
   * on met en pause ou on reprend là où on s'était arrêté, sans la
   * retélécharger. Sinon, on la charge et on la lance.
   */
  togglePlay(track: Track): void {
    const audio = this.audioElement?.nativeElement;
    if (audio && this.audioUrl() && this.currentTrackId() === track.id) {
      if (audio.paused) {
        void audio.play().catch((error: unknown) => {
          console.error('[TracksPage] Reprise impossible', error);
          this.audioError.set('Impossible de reprendre la lecture.');
        });
      } else {
        audio.pause();
      }
      return;
    }
    this.play(track);
  }

  play(track: Track): void {
    if (this.audioLoading()) return;
    this.audioError.set('');
    this.audioLoading.set(true);
    this.currentTrackTitle.set(track.title);
    this.service.audio(track.id).subscribe({
      next: (blob) => {
        console.debug('[TracksPage] Audio chargé', track.id);
        this.currentTrackId.set(track.id);
        const previousUrl = this.audioUrl();
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const url = URL.createObjectURL(blob);
        this.audioUrl.set(url);
        const audio = this.audioElement?.nativeElement;
        if (audio) {
          audio.src = url;
          audio.load();
          this.initializeAudioGraph(audio);
        }
        this.audioLoading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[TracksPage] Lecture impossible', error);
        this.audioLoading.set(false);
        this.audioError.set(error.error?.message ?? 'Impossible de charger cet audio.');
      },
    });
  }

  deleteTrack(track: Track): void {
    if (this.publicOnly()) {
      return;
    }
    if (this.deletingTrackId()) {
      return;
    }

    if (!window.confirm(`Supprimer la piste « ${track.title} » ?`)) {
      return;
    }

    this.deletingTrackId.set(track.id);
    this.service.delete(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée');
        this.deletingTrackId.set(null);
        this.snackBar.open('Piste supprimée.', 'Fermer', { duration: 4000 });
        if (this.tracks().length === 1 && this.page() > 1) {
          this.page.set(this.page() - 1);
        }
        this.load();
      },
      error: (error: { status?: number; error?: { message?: string } }) => {
        console.error('[TracksPage] Suppression impossible', error);
        this.deletingTrackId.set(null);
        const message = error.status === 404
          ? 'Cette piste n’existe plus ou ne vous appartient pas.'
          : error.error?.message ?? 'Impossible de supprimer la piste.';
        this.snackBar.open(message, 'Fermer', { duration: 5000 });
        if (error.status === 404) {
          this.load();
        }
      },
    });
  }

  switchScope(publicOnly: boolean): void {
    this.editingTrackId.set(null);
    this.publicOnly.set(publicOnly);
    this.friendsOnly.set(false);
    this.page.set(1);
    this.load();
  }

  switchFriends(): void {
    this.editingTrackId.set(null);
    this.publicOnly.set(false);
    this.friendsOnly.set(true);
    this.page.set(1);
    this.load();
  }

  audioPlaybackError(): void {
    this.audioError.set('Le navigateur ne peut pas lire ce fichier audio.');
  }

  formatSize(size: number): string {
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} Ko`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
  }

  formatDate(date: string): string {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
    }).format(new Date(date));
  }

  formatType(mimeType: string, originalName: string): string {
    const extension = originalName.split('.').pop()?.toUpperCase();
    return extension || mimeType.replace('audio/', '').toUpperCase();
  }

  ngOnDestroy(): void {
    this.stopVisualizer();
    this.disconnectAudioGraph();
    const url = this.audioUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    const coverUrl = this.coverPreviewUrl();
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl);
    }
  }

  private initializeAudioGraph(audio: HTMLAudioElement): void {
    if (this.mediaSource) {
      this.applyAudioControls();
      return;
    }

    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      this.audioError.set('La WebAudio API n’est pas disponible dans ce navigateur.');
      return;
    }

    this.audioContext = new AudioContextConstructor();
    this.mediaSource = this.audioContext.createMediaElementSource(audio);
    this.bassFilter = this.audioContext.createBiquadFilter();
    this.bassFilter.type = 'lowshelf';
    this.bassFilter.frequency.value = 250;
    this.trebleFilter = this.audioContext.createBiquadFilter();
    this.trebleFilter.type = 'highshelf';
    this.trebleFilter.frequency.value = 4000;
    this.stereoPanner = this.audioContext.createStereoPanner();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    this.mediaSource
      .connect(this.bassFilter)
      .connect(this.trebleFilter)
      .connect(this.stereoPanner)
      .connect(this.analyser)
      .connect(this.audioContext.destination);
    this.applyAudioControls();
  }

  private applyAudioControls(): void {
    if (this.stereoPanner) this.stereoPanner.pan.value = this.pan();
    if (this.bassFilter) this.bassFilter.gain.value = this.bassGain();
    if (this.trebleFilter) this.trebleFilter.gain.value = this.trebleGain();
  }

  private startVisualizer(): void {
    this.stopVisualizer();
    const canvas = this.visualizer?.nativeElement;
    const analyser = this.analyser;
    if (!canvas || !analyser) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = (): void => {
      const width = canvas.clientWidth || 600;
      const height = canvas.clientHeight || 180;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      analyser.getByteFrequencyData(data);
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).getPropertyValue('--visualizer-bar').trim() || '#3fa982';
      const barWidth = width / data.length;
      data.forEach((value, index) => {
        const barHeight = (value / 255) * height;
        context.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
      });
      this.animationFrameId = requestAnimationFrame(draw);
    };
    draw();
  }

  private stopVisualizer(): void {
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  private disconnectAudioGraph(): void {
    this.mediaSource?.disconnect();
    this.bassFilter?.disconnect();
    this.trebleFilter?.disconnect();
    this.stereoPanner?.disconnect();
    this.analyser?.disconnect();
    if (this.audioContext) void this.audioContext.close();
    this.mediaSource = undefined;
    this.audioContext = undefined;
  }

  private isValidFile(file: File): boolean {
    if (!this.allowedMimeTypes.has(file.type)) {
      this.uploadError.set('Format refusé. Utilisez un fichier MP3, WAV, OGG ou M4A.');
      return false;
    }
    if (file.size > this.maxFileSize) {
      this.uploadError.set('Le fichier ne doit pas dépasser 25 Mo.');
      return false;
    }
    return true;
  }

  private resetFileInput(): void {
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }
}
