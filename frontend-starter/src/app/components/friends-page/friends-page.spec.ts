import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FriendsPageComponent } from './friends-page';
import { Activity } from '../../shared/models/activity.model';
import { Track } from '../../shared/models/track.model';
import { FriendService } from '../../shared/services/friend.service';
import { TrackService } from '../../shared/services/track.service';

const sharedTrack: Track = {
  id: 'track-1',
  ownerId: 'alice',
  ownerName: 'Alice',
  title: 'Blues en La',
  originalName: 'blues.mp3',
  mimeType: 'audio/mpeg',
  size: 1024,
  createdAt: '2026-11-10T10:00:00.000Z',
  isPublic: false,
  visibility: 'private',
  sharedWithMe: true,
};

const feed: Activity[] = [
  { id: 'track:track-1', type: 'track', date: '2026-11-10T10:00:00.000Z', user: { id: 'alice', name: 'Alice' }, track: sharedTrack },
  { id: 'friendship:f1', type: 'friendship', date: '2026-11-09T10:00:00.000Z', user: { id: 'alice', name: 'Alice' } },
];

describe('FriendsPageComponent', () => {
  let friendService: Record<'search' | 'list' | 'activity' | 'request' | 'accept' | 'reject' | 'remove', ReturnType<typeof vi.fn>>;
  let trackService: { audio: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    friendService = {
      search: vi.fn(() => of([])),
      list: vi.fn(() => of({ friends: [], incoming: [], outgoing: [] })),
      activity: vi.fn(() => of(feed)),
      request: vi.fn(() => of({})),
      accept: vi.fn(() => of({})),
      reject: vi.fn(() => of(undefined)),
      remove: vi.fn(() => of(undefined)),
    };
    trackService = { audio: vi.fn(() => of(new Blob(['audio'], { type: 'audio/mpeg' }))) };
    TestBed.configureTestingModule({
      imports: [FriendsPageComponent],
      providers: [
        { provide: FriendService, useValue: friendService },
        { provide: TrackService, useValue: trackService },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('charge et affiche le fil d’activité', () => {
    const fixture = TestBed.createComponent(FriendsPageComponent);
    fixture.detectChanges();

    expect(friendService.activity).toHaveBeenCalledTimes(1);
    const text = (fixture.nativeElement as HTMLElement).querySelector('.activity-list')?.textContent;
    expect(text).toContain('Alice a partagé une piste avec vous');
    expect(text).toContain('Blues en La');
    expect(text).toContain('Vous êtes maintenant ami avec Alice');
  });

  it('formule l’activité selon le type et la visibilité', () => {
    const component = TestBed.createComponent(FriendsPageComponent).componentInstance;
    const base = feed[0];

    expect(component.activityText({ ...base, track: { ...sharedTrack, sharedWithMe: false, visibility: 'friends' } }))
      .toBe('Alice a partagé une piste avec ses amis');
    expect(component.activityText({ ...base, track: { ...sharedTrack, sharedWithMe: false, visibility: 'public' } }))
      .toBe('Alice a publié une piste');
    expect(component.activityText({ ...feed[1], user: { id: 'x', name: null } }))
      .toBe('Vous êtes maintenant ami avec Un ami');
  });

  it('affiche un message quand le fil est vide', () => {
    friendService.activity.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(FriendsPageComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.activity-list')?.textContent)
      .toContain('Aucune activité');
  });

  it('affiche une erreur si le fil ne se charge pas', () => {
    friendService.activity.mockReturnValue(throwError(() => ({ error: { message: 'Serveur indisponible' } })));
    const component = TestBed.createComponent(FriendsPageComponent).componentInstance;

    expect(component.activityError()).toBe('Serveur indisponible');
    expect(component.activityLoading()).toBe(false);
  });

  it('lit une piste du fil dans le lecteur intégré', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const component = TestBed.createComponent(FriendsPageComponent).componentInstance;

    component.play(sharedTrack);

    expect(trackService.audio).toHaveBeenCalledWith('track-1');
    expect(component.audioUrl()).toBe('blob:test');
    expect(component.playingTitle()).toBe('Blues en La');
    expect(component.audioLoadingId()).toBeNull();
  });

  it('met en pause puis reprend la piste du fil sans la retélécharger', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(FriendsPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.togglePlay(sharedTrack);
    fixture.detectChanges();
    const audio = (fixture.nativeElement as HTMLElement).querySelector('audio') as HTMLAudioElement;
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
    let paused = false;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });

    component.playing.set(true);
    expect(component.isPlayingTrack(sharedTrack)).toBe(true);
    component.togglePlay(sharedTrack);
    expect(pause).toHaveBeenCalledTimes(1);

    paused = true;
    component.playing.set(false);
    component.togglePlay(sharedTrack);
    expect(play).toHaveBeenCalledTimes(1);
    expect(trackService.audio).toHaveBeenCalledTimes(1);
  });

  it('explique qu’un partage arrêté empêche la lecture', () => {
    trackService.audio.mockReturnValue(throwError(() => ({ status: 404 })));
    const component = TestBed.createComponent(FriendsPageComponent).componentInstance;

    component.play(sharedTrack);

    expect(component.audioError()).toBe('Cette piste n’est plus partagée avec vous.');
    expect(component.audioUrl()).toBe('');
  });

  it('recharge le fil après le retrait d’un ami', () => {
    const component = TestBed.createComponent(FriendsPageComponent).componentInstance;
    friendService.activity.mockClear();

    component.remove('f1');

    expect(friendService.remove).toHaveBeenCalledWith('f1');
    expect(friendService.activity).toHaveBeenCalledTimes(1);
  });
});
