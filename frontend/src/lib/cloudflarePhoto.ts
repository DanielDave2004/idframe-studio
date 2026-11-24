export type StudioStyle = 'suit' | 'business-casual' | 'original'
export type StudioBackdrop = 'white' | 'gray' | 'blue'
export type StudioModel = 'dev' | 'klein'

// FLUX.2 Klein accepts input references below 512 x 512. Preserve aspect ratio.
async function makeReference(imageUrl: string): Promise<Blob> {
  const img = new Image()
  img.src = imageUrl
  await img.decode()
  const scale = Math.min(480 / img.naturalWidth, 480 / img.naturalHeight, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available in this browser.')
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('Could not prepare photo for AI.')
  return blob
}

export async function generateStudioPhoto(imageUrl: string, style: StudioStyle, backdrop: StudioBackdrop, model: StudioModel = 'klein', turnstileToken = ''): Promise<Blob> {
  const endpoint = import.meta.env.VITE_CLOUDFLARE_WORKER_URL?.trim().replace(/\/$/, '')
  if (!endpoint) throw new Error('Cloudflare is not connected. Set VITE_CLOUDFLARE_WORKER_URL in your .env.local file.')
  const form = new FormData()
  form.append('photo', await makeReference(imageUrl), 'reference.jpg')
  form.append('style', style)
  form.append('backdrop', backdrop)
  form.append('model', model)
  form.append('turnstileToken', turnstileToken)
  const response = await fetch(`${endpoint}/api/generate`, { method: 'POST', body: form })
  if (!response.ok) {
    let explanation = `Cloudflare request failed (${response.status}).`
    try { const result = await response.json(); if (typeof result.error === 'string') explanation = result.error } catch { /* keep default */ }
    throw new Error(explanation)
  }
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('Cloudflare returned an unexpected response.')
  return blob
}

export async function getGenerationQuota(): Promise<{remaining:number;dailyLimit:number;globalRemaining:number}> {
  const endpoint = import.meta.env.VITE_CLOUDFLARE_WORKER_URL?.trim().replace(/\/$/, '')
  if (!endpoint) throw new Error('Worker URL is missing')
  const response = await fetch(`${endpoint}/api/usage`, {cache:'no-store'})
  if (!response.ok) throw new Error('Could not load generation quota')
  return response.json()
}
