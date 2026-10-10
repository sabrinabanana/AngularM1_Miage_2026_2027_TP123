import { Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

@Component({
  imports: [MatPaginatorModule, MatSnackBarModule, ReactiveFormsModule],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent implements OnDestroy {
  private readonly service = inject(TrackService);
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

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
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
  readonly title = new FormControl('', { nonNullable: true });
  file?: File;

  constructor() {
    this.load();
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
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.uploadError.set('La couverture doit être une image.');
      return;
    }

    const previousUrl = this.coverPreviewUrl();
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    this.coverFileName.set(file.name);
    this.coverPreviewUrl.set(URL.createObjectURL(file));
  }

  load(): void {
    this.error.set('');
    this.loading.set(true);
    this.service.list(this.page(), this.limit()).subscribe({
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
    this.service.upload(file, title).subscribe({
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

  play(track: Track): void {
    this.audioError.set('');
    this.audioLoading.set(true);
    this.currentTrackTitle.set(track.title);
    this.service.audio(track.id).subscribe({
      next: (blob) => {
        console.debug('[TracksPage] Audio chargé', track.id);
        const previousUrl = this.audioUrl();
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        this.audioUrl.set(URL.createObjectURL(blob));
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
    const url = this.audioUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    const coverUrl = this.coverPreviewUrl();
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl);
    }
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
