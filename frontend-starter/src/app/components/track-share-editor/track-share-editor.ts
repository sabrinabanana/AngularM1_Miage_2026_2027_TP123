import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Track, TrackUpdate, TrackVisibility } from '../../shared/models/track.model';
import { User } from '../../shared/models/user.model';
import { TrackService } from '../../shared/services/track.service';

/**
 * Panneau d'édition d'une piste appartenant à l'utilisateur : titre,
 * visibilité et, pour une piste privée, choix des amis avec qui la partager.
 */
@Component({
  selector: 'app-track-share-editor',
  imports: [ReactiveFormsModule],
  templateUrl: './track-share-editor.html',
  styleUrl: './track-share-editor.css',
})
export class TrackShareEditorComponent implements OnInit {
  private readonly service = inject(TrackService);

  readonly track = input.required<Track>();
  /** Amis acceptés de l'utilisateur, seuls destinataires possibles d'un partage. */
  readonly friends = input<User[]>([]);
  readonly friendsLoading = input(false);
  readonly saved = output<Track>();
  readonly cancelled = output<void>();

  readonly title = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(120)],
  });
  readonly visibility = signal<TrackVisibility>('private');
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly saving = signal(false);
  readonly error = signal('');
  readonly selectedCount = computed(() => this.selectedIds().size);

  ngOnInit(): void {
    const track = this.track();
    this.title.setValue(track.title);
    this.visibility.set(track.visibility);
    this.selectedIds.set(new Set((track.sharedWith ?? []).map((share) => share.id)));
  }

  setVisibility(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'private' || value === 'public' || value === 'friends') {
      this.visibility.set(value);
    }
  }

  isSelected(userId: string): boolean {
    return this.selectedIds().has(userId);
  }

  toggleFriend(userId: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  /** Construit le corps PATCH : les partages ciblés ne valent que pour une piste privée. */
  buildChanges(): TrackUpdate {
    const visibility = this.visibility();
    return {
      title: this.title.value.trim(),
      visibility,
      sharedWith: visibility === 'private' ? [...this.selectedIds()] : [],
    };
  }

  save(): void {
    this.error.set('');
    if (this.title.invalid || !this.title.value.trim()) {
      this.error.set('Le titre est obligatoire (120 caractères maximum).');
      return;
    }
    if (this.saving()) return;

    this.saving.set(true);
    this.service.update(this.track().id, this.buildChanges()).subscribe({
      next: (track) => {
        this.saving.set(false);
        this.saved.emit(track);
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[TrackShareEditor] Enregistrement impossible', error);
        this.saving.set(false);
        this.error.set(error.error?.message ?? 'Impossible d’enregistrer les modifications.');
      },
    });
  }
}
