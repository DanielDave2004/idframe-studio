/** Background removal is performed on-device; the model files are fetched on first use. */
export async function removePhotoBackground(imageUrl: string, onStatus: (message: string) => void): Promise<Blob> {
  onStatus('Loading background removal model…')
  try {
    // Dynamic import avoids loading the sizeable AI runtime until requested.
    const { default: removeBackground } = await import('@imgly/background-removal')
    onStatus('Removing background… This can take a while on older devices.')
    const blob = await removeBackground(imageUrl, {
      progress: (key: string, current: number, total: number) => {
        if (total > 0) onStatus(`Downloading AI model: ${Math.round(current / total * 100)}% (${key})`)
      },
    })
    if (!blob || blob.size === 0) throw new Error('The AI model returned an empty image.')
    return blob
  } catch (error) {
    console.error('Background removal failed', error)
    throw new Error('Background removal failed. Check your internet connection for the first model download, or try a smaller photo and a modern browser.')
  }
}
