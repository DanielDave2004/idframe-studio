export type QualityResult = { width: number; height: number; brightness: number; edgeScore: number; tips: string[] }

export async function analyzePhoto(url: string): Promise<QualityResult> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(img, 0, 0, 128, 128)
  const data = ctx.getImageData(0, 0, 128, 128).data
  const luminance = new Float32Array(128 * 128)
  let total = 0
  for (let i = 0; i < luminance.length; i++) {
    const k = i * 4
    const y = 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]
    luminance[i] = y
    total += y
  }
  let edge = 0
  for (let y = 1; y < 127; y++) for (let x = 1; x < 127; x++) {
    const i = y * 128 + x
    edge += Math.abs(luminance[i] * 4 - luminance[i-1] - luminance[i+1] - luminance[i-128] - luminance[i+128])
  }
  const brightness = total / luminance.length
  const edgeScore = edge / (126 * 126)
  const tips: string[] = []
  if (Math.min(img.naturalWidth, img.naturalHeight) < 600) tips.push('Low resolution. A larger original photo may give better results.')
  if (brightness < 65) tips.push('Your photo looks dark. Try a brighter source image.')
  if (brightness > 210) tips.push('Your photo looks very bright. Facial details may be washed out.')
  if (edgeScore < 9) tips.push('The image may be blurry or lack detail. Check it visually.')
  if (!tips.length) tips.push('Image checks passed. A front-facing, unobstructed portrait works best.')
  return { width: img.naturalWidth, height: img.naturalHeight, brightness, edgeScore, tips }
}
