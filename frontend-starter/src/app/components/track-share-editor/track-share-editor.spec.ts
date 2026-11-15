import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackShareEditorComponent } from './track-share-editor';
import { Track } from '../../shared/models/track.model';
import { User } from '../../shared/models/user.model';
import { TrackService } from '../../shared/services/track.service';

const track: Track = {
  id: 'track-1',
  ownerId: 'me',
  title: 'Riff du matin',
  originalName: 'riff.mp3',
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-11-01T00:00:00.000Z',
  isPublic: false,
  visibility: 'private',
  sharedWith: [{ id: 'alice', name: 'Alice' }],
};

const friends: User[] = [
  { id: 'alice', name: 'Alice', email: 'alice@example.com', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'bob', name: 'Bob', email: 'bob@example.com', createdAt: '2026-01-01T00:00:00.000Z' },
];

describe('TrackShareEditorComponent', () => {
  let trackService: { update: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<TrackShareEditorComponent>;
  let component: TrackShareEditorComponent;

  beforeEach(() => {
    trackService = { update: vi.fn(() => of({ ...track, title: 'Nouveau' })) };
    TestBed.configureTestingModule({
      imports: [TrackShareEditorComponent],
      providers: [{ provide: TrackService, useValue: trackService }],
    });
    fixture = TestBed.createComponent(TrackShareEditorComponent);
    fixture.componentRef.setInput('track', track);
    fixture.componentRef.setInput('friends', friends);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('pré-remplit le titre, la visibilité et les amis déjà partagés', () => {
    expect(component.title.value).toBe('Riff du matin');
    expect(component.visibility()).toBe('private');
    expect(component.isSelected('alice')).toBe(true);
    expect(component.isSelected('bob')).toBe(false);

    const boxes = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(boxes.length).toBe(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it('coche et décoche un ami', () => {
    component.toggleFriend('bob');
    component.toggleFriend('alice');

    expect(component.isSelected('bob')).toBe(true);
    expect(component.isSelected('alice')).toBe(false);
    expect(component.selectedCount()).toBe(1);
  });

  it('enregistre les amis choisis puis émet la piste mise à jour', () => {
    const saved: Track[] = [];
    component.saved.subscribe((value) => saved.push(value));
    component.title.setValue('  Nouveau  ');
    component.toggleFriend('bob');

    component.save();

    expect(trackService.update).toHaveBeenCalledWith('track-1', {
      title: 'Nouveau',
      visibility: 'private',
      sharedWith: ['alice', 'bob'],
    });
    expect(saved.length).toBe(1);
    expect(saved[0].title).toBe('Nouveau');
    expect(component.saving()).toBe(false);
  });

  it('enregistre au clic réel sur le bouton, sans laisser le navigateur recharger la page', () => {
    const element = fixture.nativeElement as HTMLElement;
    const form = element.querySelector('form') as HTMLFormElement;
    let defaultPrevented = false;
    form.addEventListener('submit', (event) => {
      defaultPrevented = event.defaultPrevented;
    });
    const boxes = element.querySelectorAll<HTMLInputElement>('input[type=checkbox]');

    boxes[1].click();
    element.querySelector<HTMLButtonElement>('button[type=submit]')?.click();

    expect(defaultPrevented).toBe(true);
    expect(trackService.update).toHaveBeenCalledWith('track-1', {
      title: 'Riff du matin',
      visibility: 'private',
      sharedWith: ['alice', 'bob'],
    });
  });

  it('vide la liste de partage quand la piste n’est plus privée', () => {
    component.setVisibility({ target: { value: 'public' } } as unknown as Event);
    fixture.detectChanges();

    expect(component.buildChanges().sharedWith).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('fieldset')).toBeNull();
  });

  it('refuse un titre vide sans appeler le serveur', () => {
    component.title.setValue('   ');

    component.save();

    expect(trackService.update).not.toHaveBeenCalled();
    expect(component.error()).toContain('titre');
  });

  it('affiche le message du serveur en cas de refus', () => {
    trackService.update.mockReturnValue(
      throwError(() => ({ error: { message: "On ne peut partager qu'avec des amis acceptés" } })),
    );
    const saved: Track[] = [];
    component.saved.subscribe((value) => saved.push(value));

    component.save();

    expect(component.error()).toBe("On ne peut partager qu'avec des amis acceptés");
    expect(component.saving()).toBe(false);
    expect(saved.length).toBe(0);
  });

  it('émet cancelled au clic sur Annuler', () => {
    let cancelled = false;
    component.cancelled.subscribe(() => (cancelled = true));

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.secondary')?.click();

    expect(cancelled).toBe(true);
  });
});
