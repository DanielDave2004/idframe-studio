/**
 * Prepare same-origin MediaPipe assets before Vite starts/builds.
 * @mediapipe/tasks-vision's WASM files are taken from the installed matching
 * npm package; the public BlazeFace task model is downloaded once at build time.
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(project, 'public', 'models', 'mediapipe')
const wasmFrom = path.join(project, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const wasmTo = path.join(dest, 'wasm')
const modelTo = path.join(dest, 'blaze_face_short_range.tflite')
const expectedSha = 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f'
const sources = [
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  'https://huggingface.co/litert-community/MediaPipe-FaceDetector-BlazeFace-Short-Range/resolve/main/blaze_face_short_range.tflite',
]

function matches(data) { return createHash('sha256').update(data).digest('hex') === expectedSha }
await mkdir(wasmTo, { recursive: true })
let wasmFiles
try { wasmFiles = (await readdir(wasmFrom)).filter(name => /^vision_wasm.*\.(wasm|js)$/.test(name)) }
catch { throw new Error('MediaPipe npm files are missing. Run npm install in frontend before building.') }
if (!wasmFiles.includes('vision_wasm_internal.js') || !wasmFiles.includes('vision_wasm_internal.wasm')) {
  throw new Error('Installed MediaPipe WASM files not found. Check @mediapipe/tasks-vision version.')
}
for (const file of wasmFiles) await copyFile(path.join(wasmFrom, file), path.join(wasmTo, file))
console.log(`Prepared ${wasmFiles.length} local MediaPipe WASM files`)

try {
  if (matches(await readFile(modelTo))) {
    console.log('Using existing verified BlazeFace model')
    process.exit(0)
  }
} catch { /* model not cached yet */ }

const errors = []
for (const url of sources) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (!matches(data)) throw new Error('SHA256 mismatch: download does not match the expected official model')
    const temporary = `${modelTo}.tmp`
    await writeFile(temporary, data)
    await rename(temporary, modelTo)
    console.log(`Prepared verified BlazeFace model (${data.length} bytes)`)
    break
  } catch (error) {
    errors.push(`${new URL(url).hostname}: ${error instanceof Error ? error.message : String(error)}`)
  } finally { clearTimeout(timeout) }
}
try {
  const info = await stat(modelTo)
  if (info.size === 229746 && matches(await readFile(modelTo))) process.exit(0)
} catch { /* not downloaded */ }
await rm(modelTo, { force: true })
throw new Error(`Could not download the BlazeFace model during build. A valid model is required to prevent face-free AI generation. ${errors.join(' | ')}`)
