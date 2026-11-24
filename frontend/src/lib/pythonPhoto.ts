import { analyzePhoto, type QualityResult } from './photoAnalysis'

const backend = () => (import.meta.env.VITE_PYTHON_API_URL as string | undefined)?.trim().replace(/\/$/, '')

async function imageBlob(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not read uploaded photo')
  return response.blob()
}

export async function analyzePhotoWithFallback(imageUrl: string): Promise<QualityResult> {
  const base = backend()
  if (base) {
    try {
      const form = new FormData()
      form.append('photo', await imageBlob(imageUrl), 'photo.jpg')
      const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: form })
      if (response.ok) return (await response.json()) as QualityResult
      console.warn('Python photo checks failed:', response.status)
    } catch (error) { console.warn('Python unavailable, using browser checks:', error) }
  }
  return analyzePhoto(imageUrl)
}

export async function enhancePhotoInPython(imageUrl: string, strength = 0.6): Promise<Blob> {
  const base = backend()
  if (!base) throw new Error('Set VITE_PYTHON_API_URL in frontend/.env.local to enable Python enhancement.')
  const form = new FormData()
  form.append('photo', await imageBlob(imageUrl), 'photo.jpg')
  form.append('strength', String(strength))
  const response = await fetch(`${base}/api/enhance`, { method: 'POST', body: form })
  if (!response.ok) {
    let message = `Python enhancement failed (${response.status}).`
    try { const result = await response.json() as {detail?:string}; if (typeof result.detail === 'string') message = result.detail } catch { /* use status */ }
    throw new Error(message)
  }
  const image = await response.blob()
  if (!image.type.startsWith('image/')) throw new Error('Python returned an invalid image.')
  return image
}
