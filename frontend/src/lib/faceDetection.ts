import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export type DetectedFace = {
  x: number
  y: number
  width: number
  height: number
}

// Keep the WASM version identical to the installed @mediapipe/tasks-vision package.
const MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float32/1/blaze_face_short_range.tflite',
]
const WASM_URLS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.32/wasm',
]
let detectorPromise: Promise<FaceDetector> | null = null

async function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      let lastError: unknown
      for (const wasmUrl of WASM_URLS) {
        try {
          const vision = await FilesetResolver.forVisionTasks(wasmUrl)
          for (const modelUrl of MODEL_URLS) {
            try {
              return await FaceDetector.createFromOptions(vision, {
                baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
                runningMode: 'IMAGE',
                minDetectionConfidence: 0.35,
              })
            } catch (error) { lastError = error }
          }
        } catch (error) { lastError = error }
      }
      throw new Error('Face detector files could not be loaded. Check that your browser permits Google Storage and jsDelivr/unpkg, then retry.', { cause: lastError })
    })().catch((error: unknown) => {
      detectorPromise = null // A later click can retry after a temporary network failure.
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

  // Retry on a resized image: improves detection for very large, very small,
  // or unusual image encodings, without changing the uploaded photo itself.
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 1024 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return selectFace(detector.detect(canvas).detections, canvas.width, canvas.height)
}
