import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export type DetectedFace = {
  x: number
  y: number
  width: number
  height: number
}

// Try the website-hosted assets first. If a Pages deployment has not published
// them yet, a matching-version CDN can rescue browsers that allow it. A failed
// check always blocks generation, rather than silently allowing AI to invent a face.
const ASSET_BASE = `${import.meta.env.BASE_URL}models/mediapipe/`
const MODEL_URL = `${ASSET_BASE}blaze_face_short_range.tflite`
const WASM_URL = `${ASSET_BASE}wasm`
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const REMOTE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
const BACKUP_WASM = 'https://unpkg.com/@mediapipe/tasks-vision@0.10.32/wasm'

let detectorPromise: Promise<FaceDetector> | null = null

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function checkLocalAsset(url: string, wasm = false): Promise<void> {
  const response = await fetch(url, { method: 'GET', cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html')) throw new Error(`Received an HTML page instead of ${url.split('/').pop()}. Check Cloudflare Pages build output.`)
  const length = Number(response.headers.get('content-length') || 0)
  if (!wasm && length > 0 && length < 100_000) throw new Error('The published face model is too small or incomplete.')
  if (wasm && length > 0 && length < 100_000) throw new Error('The published MediaPipe WebAssembly runtime is too small or incomplete.')
}

async function createDetector(wasmUrl: string, modelUrl: string): Promise<FaceDetector> {
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl)
  return FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.38,
  })
}

async function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const failures: string[] = []
      const locations = [
        { name: 'website-hosted', wasm: WASM_URL, model: MODEL_URL, local: true },
        { name: 'jsDelivr fallback', wasm: REMOTE_WASM, model: REMOTE_MODEL, local: false },
        { name: 'unpkg fallback', wasm: BACKUP_WASM, model: REMOTE_MODEL, local: false },
      ]
      for (const location of locations) {
        try {
          if (location.local) {
            await Promise.all([
              checkLocalAsset(location.model),
              checkLocalAsset(`${location.wasm}/vision_wasm_internal.wasm`, true),
              checkLocalAsset(`${location.wasm}/vision_wasm_internal.js`),
            ])
          }
          return await createDetector(location.wasm, location.model)
        } catch (error) {
          console.warn(`MediaPipe face detector failed using ${location.name}:`, error)
          failures.push(`${location.name}: ${message(error)}`)
        }
      }
      throw new Error(`Face verification is unavailable. ${failures.join(' | ')}`)
    })().catch((error: unknown) => {
      detectorPromise = null
      throw error
    })
  }
  return detectorPromise
}

function selectFace(detections: ReturnType<FaceDetector['detect']>['detections'], width: number, height: number): DetectedFace | null {
  const face = [...detections].sort((a, b) => {
    const first = a.boundingBox
    const second = b.boundingBox
    return (second?.width ?? 0) * (second?.height ?? 0) - (first?.width ?? 0) * (first?.height ?? 0)
  })[0]?.boundingBox
  if (!face || !width || !height) return null
  return {
    x: (face.originX + face.width / 2) / width,
    y: (face.originY + face.height / 2) / height,
    width: face.width / width,
    height: face.height / height,
  }
}

export async function detectPrimaryFace(imageUrl: string): Promise<DetectedFace | null> {
  const image = new Image()
  image.src = imageUrl
  await image.decode()
  const detector = await getDetector()
  const width = image.naturalWidth
  const height = image.naturalHeight
  const direct = selectFace(detector.detect(image).detections, width, height)
  if (direct) return direct

  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 1024 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser could not open a canvas for face verification.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return selectFace(detector.detect(canvas).detections, canvas.width, canvas.height)
}
