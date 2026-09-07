// Blob URLs remain usable across SPA page mounts, but expire on document reload.
export const publishDraftDocumentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

export function restorableDraftImages(images: string[], savedDocumentId?: string): string[] {
  return images.filter(url => typeof url === 'string'
    && (!url.startsWith('blob:') || savedDocumentId === publishDraftDocumentId))
}
