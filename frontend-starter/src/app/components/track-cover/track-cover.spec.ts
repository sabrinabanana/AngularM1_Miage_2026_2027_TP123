import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackCoverComponent } from './track-cover';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

const track: Track = {
  id: 'track-1',
  ownerId: 'me',
  title: 'Blues',
  originalName: 'blues.mp3',
  mimeType: 'audio/mpeg',
  size: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  isPublic: false,
  visibility: 'private',
  hasCover: true,
};

describe('TrackCoverComponent', () => {
  let trackService: { cover: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    trackService = { cover: vi.fn(() => of(new Blob(['image'], { type: 'image/png' }))) };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [TrackCoverComponent],
      providers: [{ provide: TrackService, useValue: trackService }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function create(input: Track) {
    const fixture = TestBed.createComponent(TrackCoverComponent);
    fixture.componentRef.setInput('track', input);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('charge et affiche la couverture quand la piste en a une', () => {
    const fixture = create(track);

    expect(trackService.cover).toHaveBeenCalledWith('track-1');
    const image = (fixture.nativeElement as HTMLElement).querySelector('img');
    expect(image?.getAttribute('src')).toBe('blob:cover');
    expect(image?.getAttribute('alt')).toBe('Couverture de Blues');
  });

  it('affiche l’image par défaut sans appel réseau quand il n’y a pas de couverture', () => {
    const fixture = create({ ...track, hasCover: false });

    expect(trackService.cover).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('.placeholder')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('img')).toBeNull();
  });

  it('garde l’image par défaut si le chargement échoue', () => {
    trackService.cover.mockReturnValue(throwError(() => ({ status: 404 })));
    const fixture = create(track);

    expect((fixture.nativeElement as HTMLElement).querySelector('.placeholder')).not.toBeNull();
  });

  it('libère l’URL Blob à la destruction', () => {
    const fixture = create(track);

    fixture.destroy();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover');
  });
});
