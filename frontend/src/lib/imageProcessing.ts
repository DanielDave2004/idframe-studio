import type { Background, Format, PixelCrop } from '../types/photo'
import { BACKGROUNDS } from '../types/photo'

export const OUTPUT_SIZE = 600
export const MAX_FILE_BYTES = 12 * 1024 * 1024

export function validateImage(file: File): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return 'Please choose a JPG, PNG, or WebP image.'
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'Please choose an image smaller than 12 MB.'
  }
  return null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the selected photo.'))
    image.src = src
  })
}

/**
 * Crops the actual image pixels reported by react-easy-crop, and composites onto
 * a solid background. The color shows behind transparent pixels; it does NOT
 * remove the background of an opaque uploaded photo.
 */
export async function exportPhoto(
  imageUrl: string,
  crop: PixelCrop,
  background: Background,
  format: Format,
  enhancement = 0,
): Promise<Blob> {
  const source = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create a photo canvas.')

  ctx.fillStyle = BACKGROUNDS[background]
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // react-easy-crop returns crop coordinates relative to source pixel dimensions.
  const x = Math.max(0, Math.min(crop.x, source.naturalWidth - 1))
  const y = Math.max(0, Math.min(crop.y, source.naturalHeight - 1))
  const w = Math.max(1, Math.min(crop.width, source.naturalWidth - x))
  const h = Math.max(1, Math.min(crop.height, source.naturalHeight - y))
  // Gentle tonal adjustment only. Preserve facial features and natural skin texture.
  const strength = Math.max(0, Math.min(100, enhancement)) / 100
  ctx.filter = `brightness(${1 + 0.045 * strength}) contrast(${1 + 0.075 * strength}) saturate(${1 - 0.025 * strength})`
  ctx.drawImage(source, x, y, w, h, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  ctx.filter = 'none'

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not generate the image.'))
    }, mimeType, 0.95)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 20_000)
}
