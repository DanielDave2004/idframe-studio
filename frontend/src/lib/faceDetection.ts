import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export type DetectedFace = {
  x: number
  y: number
  width: number
  height: number
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
let detectorPromise: Promise<FaceDetector> | null = null

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      })
    })().catch((error: unknown) => {
      detectorPromise = null
      throw error
    })
  }
  return detectorPromise
}

export async function detectPrimaryFace(imageUrl: string): Promise<DetectedFace | null> {
  const image = new Image()
  image.src = imageUrl
  await image.decode()
  const detector = await getDetector()
  const faces = detector.detect(image).detections
  if (!faces.length) return null
  const face = [...faces].sort((a, b) => {
    const first = a.boundingBox
    const second = b.boundingBox
    return (second?.width ?? 0) * (second?.height ?? 0) - (first?.width ?? 0) * (first?.height ?? 0)
  })[0]?.boundingBox
  if (!face) return null
  return {
    x: (face.originX + face.width / 2) / image.naturalWidth,
    y: (face.originY + face.height / 2) / image.naturalHeight,
    width: face.width / image.naturalWidth,
    height: face.height / image.naturalHeight,
  }
}
