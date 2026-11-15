import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TracksPageComponent } from './tracks-page';
import { FriendService } from '../../shared/services/friend.service';
import { TrackService } from '../../shared/services/track.service';
import { Track } from '../../shared/models/track.model';

const ownTrack: Track = {
  id: 'own-1',
  ownerId: 'me',
  ownerName: 'Moi',
  title: 'Riff privé',
  originalName: 'riff.mp3',
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-11-02T00:00:00.000Z',
  isPublic: false,
  visibility: 'private',
  sharedWith: [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
  ],
};

const recentTrack: Track = {
  id: 'recent-1',
  ownerId: 'alice-id',
  ownerName: 'Alice',
  title: 'Blues en La',
  originalName: 'blues.mp3',
  mimeType: 'audio/mpeg',
  size: 1024,
  createdAt: '2026-11-01T00:00:00.000Z',
  isPublic: true,
  visibility: 'public',
};

describe('TracksPageComponent', () => {
  let trackService: {
    list: ReturnType<typeof vi.fn>;
    recent: ReturnType<typeof vi.fn>;
    upload: ReturnType<typeof vi.fn>;
    audio: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    unshare: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    cover: ReturnType<typeof vi.fn>;
  };
  let friendService: { list: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    friendService = {
      list: vi.fn(() => of({
        friends: [{ id: 'f1', user: { id: 'alice', name: 'Alice', email: 'a@example.com', createdAt: '' } }],
        incoming: [],
        outgoing: [],
      })),
    };
    snackBar = { open: vi.fn() };
    trackService = {
      list: vi.fn(() => of({ items: [], page: 1, limit: 5, total: 0, pages: 1 })),
      recent: vi.fn(() => of([recentTrack])),
      upload: vi.fn(),
      audio: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      unshare: vi.fn(),
      download: vi.fn(() => of(new Blob(['audio'], { type: 'audio/mpeg' }))),
      cover: vi.fn(() => of(new Blob(['image'], { type: 'image/png' }))),
    };
    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        { provide: TrackService, useValue: trackService },
        { provide: FriendService, useValue: friendService },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });
  });

  describe('lecture et pause', () => {
    function createPlaying() {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      trackService.audio.mockReturnValue(of(new Blob(['audio'], { type: 'audio/mpeg' })));
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      fixture.componentInstance.togglePlay(recentTrack);
      fixture.detectChanges();
      const audio = (fixture.nativeElement as HTMLElement).querySelector('audio') as HTMLAudioElement;
      return { fixture, component: fixture.componentInstance, audio };
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('charge la piste au premier clic et affiche le bouton pause pendant la lecture', () => {
      const { fixture, component } = createPlaying();
      expect(trackService.audio).toHaveBeenCalledWith('recent-1');
      expect(component.currentTrackId()).toBe('recent-1');
      expect(component.isPlayingTrack(recentTrack)).toBe(false);

      component.audioStarted();
      fixture.detectChanges();

      expect(component.isPlayingTrack(recentTrack)).toBe(true);
      const button = (fixture.nativeElement as HTMLElement).querySelector('.recent-play');
      expect(button?.textContent).toContain('⏸');
      expect(button?.getAttribute('aria-label')).toBe('Mettre en pause Blues en La');
    });

    it('met en pause au second clic sans retélécharger la piste', () => {
      const { component, audio } = createPlaying();
      const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
      component.audioStarted();

      component.togglePlay(recentTrack);

      expect(pause).toHaveBeenCalledTimes(1);
      expect(trackService.audio).toHaveBeenCalledTimes(1);
    });

    it('reprend la lecture d’une piste en pause sans la retélécharger', () => {
      const { component, audio } = createPlaying();
      const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => true });
      component.audioPaused();

      component.togglePlay(recentTrack);

      expect(play).toHaveBeenCalledTimes(1);
      expect(trackService.audio).toHaveBeenCalledTimes(1);
      expect(component.isPlayingTrack(recentTrack)).toBe(false);
    });

    it('charge une autre piste quand on clique sur un autre bouton', () => {
      const { component } = createPlaying();

      component.togglePlay(ownTrack);

      expect(trackService.audio).toHaveBeenCalledTimes(2);
      expect(trackService.audio).toHaveBeenLastCalledWith('own-1');
      expect(component.currentTrackId()).toBe('own-1');
    });
  });

  describe('téléchargement, couverture et badges', () => {
    function coverEvent(file: File): Event {
      return { target: { files: [file] } } as unknown as Event;
    }

    it('télécharge la piste sous son nom d’origine', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      let clicked: HTMLAnchorElement | undefined;
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this;
      });
      const component = TestBed.createComponent(TracksPageComponent).componentInstance;

      component.download(recentTrack);

      expect(trackService.download).toHaveBeenCalledWith('recent-1');
      expect(clicked?.download).toBe('blues.mp3');
      expect(component.downloadingTrackId()).toBeNull();
      vi.restoreAllMocks();
    });

    it('réactive le bouton si le téléchargement échoue', () => {
      trackService.download.mockReturnValue(throwError(() => ({ status: 404 })));
      const component = TestBed.createComponent(TracksPageComponent).componentInstance;

      component.download(recentTrack);

      expect(component.downloadingTrackId()).toBeNull();
    });

    it('refuse une couverture qui n’est pas une image acceptée', () => {
      const component = TestBed.createComponent(TracksPageComponent).componentInstance;

      component.chooseCover(coverEvent(new File(['<svg/>'], 'c.svg', { type: 'image/svg+xml' })));

      expect(component.uploadError()).toContain('JPEG, PNG ou WebP');
      expect(component.coverPreviewUrl()).toBe('');
    });

    it('refuse une couverture de plus de 2 Mo', () => {
      const component = TestBed.createComponent(TracksPageComponent).componentInstance;
      const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });

      component.chooseCover(coverEvent(big));

      expect(component.uploadError()).toContain('2 Mo');
      expect(component.coverFileName()).toBe('');
    });

    it('envoie la couverture choisie avec la piste', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      trackService.upload.mockReturnValue(of({ type: 0 }));
      const component = TestBed.createComponent(TracksPageComponent).componentInstance;
      const audio = new File(['audio'], 'a.mp3', { type: 'audio/mpeg' });
      const cover = new File(['image'], 'c.png', { type: 'image/png' });

      component.chooseCover(coverEvent(cover));
      component.file = audio;
      component.upload();

      expect(component.coverPreviewUrl()).toBe('blob:cover');
      expect(trackService.upload).toHaveBeenCalledWith(audio, 'a.mp3', 'private', cover);
      vi.restoreAllMocks();
    });

    it('choisit le badge selon la visibilité', () => {
      const component = TestBed.createComponent(TracksPageComponent).componentInstance;

      expect(component.visibilityKind(ownTrack)).toBe('shared');
      expect(component.visibilityKind({ ...ownTrack, sharedWith: [] })).toBe('private');
      expect(component.visibilityKind({ ...ownTrack, visibility: 'friends' })).toBe('friends');
      expect(component.visibilityKind(recentTrack)).toBe('public');
      expect(component.visibilityLabel({ ...recentTrack, isPublic: false, visibility: 'friends' })).toBe('Amis');
    });
  });

  describe('partage piste par piste', () => {
    function createWithOwnTrack() {
      trackService.list.mockReturnValue(of({ items: [ownTrack], page: 1, limit: 5, total: 1, pages: 1 }));
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      return fixture;
    }

    it('affiche les amis ayant accès et le libellé de visibilité', () => {
      const fixture = createWithOwnTrack();
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelector('.share-chips')?.textContent).toContain('Alice');
      expect(element.querySelector('.share-chips')?.textContent).toContain('Bob');
      expect(fixture.componentInstance.visibilityLabel(ownTrack)).toBe('Privée · partagée avec 2 amis');
    });

    it('calcule les libellés de visibilité', () => {
      const component = createWithOwnTrack().componentInstance;

      expect(component.visibilityLabel({ ...ownTrack, sharedWith: [] })).toBe('Privée');
      expect(component.visibilityLabel({ ...ownTrack, visibility: 'friends' })).toBe('Tous mes amis');
      expect(component.visibilityLabel({ ...ownTrack, visibility: 'public' })).toBe('Publique');
      expect(component.visibilityLabel({ ...ownTrack, sharedWith: undefined, sharedWithMe: true }))
        .toBe('Partagée avec vous');
    });

    it('ouvre l’éditeur et ne charge les amis qu’une seule fois', () => {
      const fixture = createWithOwnTrack();
      const component = fixture.componentInstance;

      component.toggleEditor(ownTrack);
      fixture.detectChanges();
      expect(component.editingTrackId()).toBe('own-1');
      expect(component.friends().map((friend) => friend.id)).toEqual(['alice']);
      expect((fixture.nativeElement as HTMLElement).querySelector('app-track-share-editor')).not.toBeNull();

      component.toggleEditor(ownTrack);
      component.toggleEditor(ownTrack);
      expect(friendService.list).toHaveBeenCalledTimes(1);
    });

    it('arrête le partage avec un ami et met la piste à jour', () => {
      const fixture = createWithOwnTrack();
      const component = fixture.componentInstance;
      const updated = { ...ownTrack, sharedWith: [{ id: 'bob', name: 'Bob' }] };
      trackService.unshare.mockReturnValue(of(updated));

      component.unshare(ownTrack, { id: 'alice', name: 'Alice' });

      expect(trackService.unshare).toHaveBeenCalledWith('own-1', 'alice');
      expect(component.tracks()[0].sharedWith).toEqual([{ id: 'bob', name: 'Bob' }]);
      expect(component.unsharingKey()).toBeNull();
    });

    it('arrête tous les partages après confirmation', () => {
      const fixture = createWithOwnTrack();
      const component = fixture.componentInstance;
      trackService.update.mockReturnValue(of({ ...ownTrack, sharedWith: [] }));
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

      component.stopAllSharing(ownTrack);

      expect(trackService.update).toHaveBeenCalledWith('own-1', { visibility: 'private', sharedWith: [] });
      expect(component.isShared(component.tracks()[0])).toBe(false);
      confirm.mockRestore();
    });

    it('ne fait rien si l’arrêt des partages est annulé', () => {
      const component = createWithOwnTrack().componentInstance;
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

      component.stopAllSharing(ownTrack);

      expect(trackService.update).not.toHaveBeenCalled();
      confirm.mockRestore();
    });

    it('signale l’échec de l’arrêt d’un partage', () => {
      const fixture = createWithOwnTrack();
      const component = fixture.componentInstance;
      // MatSnackBarModule fournit sa propre instance au composant : on l'espionne.
      const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open')
        .mockReturnValue(undefined as never);
      trackService.unshare.mockReturnValue(throwError(() => ({ error: { message: 'Piste inconnue' } })));

      component.unshare(ownTrack, { id: 'alice', name: 'Alice' });

      expect(open).toHaveBeenCalledWith('Piste inconnue', 'Fermer', { duration: 5000 });
      expect(component.tracks()[0].sharedWith?.length).toBe(2);
      expect(component.unsharingKey()).toBeNull();
    });

    it('masque les actions de partage hors de « Mes pistes »', () => {
      const fixture = createWithOwnTrack();
      fixture.componentInstance.switchScope(true);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.share-chips')).toBeNull();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('contrôles audio', () => {
    it('initialise les contrôles audio avec des valeurs neutres', () => {
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;

      expect(component.pan()).toBe(0);
      expect(component.bassGain()).toBe(0);
      expect(component.trebleGain()).toBe(0);
    });

    it('met à jour les contrôles depuis les curseurs', () => {
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;

      component.setPan({ target: { value: '0.5' } } as unknown as Event);
      component.setBassGain({ target: { value: '6' } } as unknown as Event);
      component.setTrebleGain({ target: { value: '-4' } } as unknown as Event);

      expect(component.pan()).toBe(0.5);
      expect(component.bassGain()).toBe(6);
      expect(component.trebleGain()).toBe(-4);
    });
  });

  describe('récemment ajoutés', () => {
    it('charge et affiche les pistes récentes avec leur propriétaire', () => {
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();

      expect(trackService.recent).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.recentTracks()).toEqual([recentTrack]);
      const text = (fixture.nativeElement as HTMLElement).querySelector('.recent-list')?.textContent;
      expect(text).toContain('Blues en La');
      expect(text).toContain('Alice');
    });

    it('affiche une erreur si les pistes récentes ne se chargent pas', () => {
      trackService.recent.mockReturnValue(throwError(() => ({ error: { message: 'Serveur indisponible' } })));
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.recentError()).toBe('Serveur indisponible');
      expect(fixture.componentInstance.recentLoading()).toBe(false);
    });
  });

  describe('recherche de pistes', () => {
    it('relance la liste après le debounce, sur la page 1, avec la recherche', () => {
      vi.useFakeTimers();
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      component.page.set(3);
      trackService.list.mockClear();

      component.search.setValue('  jazz ');
      vi.advanceTimersByTime(299);
      expect(trackService.list).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(trackService.list).toHaveBeenCalledTimes(1);
      expect(trackService.list).toHaveBeenCalledWith(1, 5, false, false, 'jazz');
      expect(component.page()).toBe(1);
    });

    it('ne relance pas la liste si seuls des espaces sont ajoutés', () => {
      vi.useFakeTimers();
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;

      component.search.setValue('rock');
      vi.advanceTimersByTime(300);
      trackService.list.mockClear();

      component.search.setValue('rock  ');
      vi.advanceTimersByTime(300);
      expect(trackService.list).not.toHaveBeenCalled();
    });

    it('conserve la recherche en changeant d’onglet', () => {
      const fixture = TestBed.createComponent(TracksPageComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      component.search.setValue('funk', { emitEvent: false });
      trackService.list.mockClear();

      component.switchScope(true);

      expect(trackService.list).toHaveBeenCalledWith(1, 5, true, false, 'funk');
    });
  });
});
