/**
 * Propose au navigateur d'enregistrer un Blob sous le nom donné, via un lien
 * temporaire avec l'attribut `download`. L'URL Blob est libérée juste après.
 */
export function saveBlob(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
