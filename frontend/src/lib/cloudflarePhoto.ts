import { detectPrimaryFace } from './faceDetection'

export type StudioModel = 'dev' | 'klein'
export type OutfitChoice = 'male' | 'female'

type PhotoInput = string | Blob

async function imageUrlFor(input: PhotoInput): Promise<{ url: string; revoke: () => void }> {
  if (typeof input === 'string') return { url: input, revoke: () => {} }
  const url = URL.createObjectURL(input)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}

// Crop the identity reference around the detected face when possible. This helps
// exclude foreground selfie arms and reduces the source pose bias. The original
// face pixels remain the reference, but model output identity is not guaranteed.
async function makeReference(input: PhotoInput): Promise<Blob> {
  const { url, revoke } = await imageUrlFor(input)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const width = img.naturalWidth
    const height = img.naturalHeight
    let face = null
    try { face = await detectPrimaryFace(url) } catch { /* optional face detection */ }
    let side: number
    let x: number
    let y: number
    if (face) {
      const facePixels = Math.max(face.width * width, face.height * height)
      side = Math.min(Math.min(width, height), Math.max(facePixels * 3.1, Math.min(width, height) * 0.46))
      x = face.x * width - side * 0.5
      y = face.y * height - side * 0.39
    } else {
      side = Math.min(width, height)
      x = (width - side) / 2
      y = (height - side) * 0.2
    }
    x = Math.min(width - side, Math.max(0, x))
    y = Math.min(height - side, Math.max(0, y))
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 480
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available in this browser.')
    context.drawImage(img, x, y, side, side, 0, 0, 480, 480)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Could not prepare photo for AI.')
    return blob
  } finally {
    revoke()
  }
}

export async function generateStudioPhoto(input: PhotoInput, model: StudioModel = 'klein', turnstileToken = '', outfit: OutfitChoice = 'male'): Promise<Blob> {
  const endpoint = import.meta.env.VITE_CLOUDFLARE_WORKER_URL?.trim().replace(/\/$/, '')
  if (!endpoint) throw new Error('Cloudflare is not connected. Set VITE_CLOUDFLARE_WORKER_URL in your .env.local file.')
  const form = new FormData()
  form.append('photo', await makeReference(input), 'reference.jpg')
  form.append('outfit', outfit)
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
