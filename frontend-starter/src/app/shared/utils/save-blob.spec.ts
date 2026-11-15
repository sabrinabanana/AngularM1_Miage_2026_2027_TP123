import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBlob } from './save-blob';

describe('saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('déclenche un téléchargement nommé puis nettoie le lien et l’URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });

    saveBlob(new Blob(['data']), 'été.mp3');

    expect(clicked?.download).toBe('été.mp3');
    expect(clicked?.href).toBe('blob:file');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:file');
  });
});
