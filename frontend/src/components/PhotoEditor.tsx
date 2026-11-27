import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { type Area, type Point, type MediaSize } from 'react-easy-crop'
import { ArrowRight, Check, Download, ImageIcon, LoaderCircle, Minus, Plus, Printer, RotateCcw, ScanFace, Scissors, ShieldCheck, Sparkles, Upload, Undo2 } from 'lucide-react'
import { BACKGROUNDS, type Background, type Format, type PixelCrop } from '../types/photo'
import { downloadBlob, exportPhoto } from '../lib/imageProcessing'
import { generateStudioPhoto, getGenerationQuota, type StudioModel, type OutfitChoice } from '../lib/cloudflarePhoto'
import { enhancePhotoInPython, removeBackgroundInPython } from '../lib/pythonPhoto'
import { detectPrimaryFace } from '../lib/faceDetection'
import Turnstile from './Turnstile'
import { downloadPrintSheet } from '../lib/printSheets'
import { clearGenerated, loadPhoto, savePhoto } from '../lib/photoSession'

type Props = { imageUrl: string; fileName: string; onReset: () => void; onError: (message: string) => void }
function safeBaseName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '')
  return (base || 'photo').replace(/[^a-zA-Z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()
}

export default function PhotoEditor({ imageUrl, fileName, onReset, onError }: Props) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [background, setBackground] = useState<Background>('white')
  const [outfit, setOutfit] = useState<OutfitChoice>('male')
  const [alignBusy, setAlignBusy] = useState(false)
  const [alignedForGenerate, setAlignedForGenerate] = useState(false)
  const mediaSize = useRef<MediaSize | null>(null)
  const cropSize = useRef<{width:number;height:number} | null>(null)
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null)
  const cutoutRef = useRef<string | null>(null)
  const [removalBusy, setRemovalBusy] = useState(false)
  const [format, setFormat] = useState<Format>('png')
  const [pixels, setPixels] = useState<PixelCrop | null>(null)
  const [busy, setBusy] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [studioModel, setStudioModel] = useState<StudioModel>('klein')
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const generatedRef = useRef<string | null>(null)
  const enhancement = 0
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [activeTab, setActiveTab] = useState<'generate' | 'export'>('generate')
  const [quota, setQuota] = useState<{remaining:number;dailyLimit:number;globalRemaining:number} | null>(null)
  const [quotaError, setQuotaError] = useState('')
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const turnstileKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
  const [preview, setPreview] = useState<string | null>(null)
  const source = generatedUrl ? (cutoutUrl ?? generatedUrl) : imageUrl

  useEffect(() => () => {
    if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
    if (cutoutRef.current) URL.revokeObjectURL(cutoutRef.current)
  }, [])


  useEffect(() => {
    let active = true
    loadPhoto('generated').then(saved => {
      if (!active || !saved) return
      const url = URL.createObjectURL(saved.blob)
      if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
      generatedRef.current = url
      setGeneratedUrl(url)
      setNotice('Your last generated portrait was restored after a page reload.')
    }).catch(error => console.warn('Could not restore generated portrait:', error))
    return () => { active = false }
  }, [])

  const updateToken = useCallback((value: string) => setTurnstileToken(value), [])
  const refreshQuota = useCallback(() => {
    setQuotaLoading(true)
    setQuotaError('')
    void getGenerationQuota()
      .then(data => {
        setQuota(data)
        setQuotaError('')
      })
      .catch(error => {
        console.error('Unable to load Cloudflare daily usage:', error)
        setQuota(null)
        setQuotaError(error instanceof Error ? error.message : 'Unable to load daily usage')
      })
      .finally(() => setQuotaLoading(false))
  }, [])
  useEffect(() => { refreshQuota() }, [refreshQuota])

  const onCropComplete = useCallback((_area: Area, croppedPixels: Area) => setPixels(croppedPixels), [])
  const resetCrop = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setAlignedForGenerate(false)
    setNotice('Crop reset. You can reposition the image manually.')
  }

  useEffect(() => {
    let disposed = false
    let objectUrl: string | null = null
    setPreview(null)
    if (pixels) {
      exportPhoto(source, pixels, background, 'png', enhancement)
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob)
          if (!disposed) setPreview(objectUrl)
          else URL.revokeObjectURL(objectUrl)
        })
        .catch(() => { if (!disposed) setPreview(null) })
    }
    return () => {
      disposed = true
      if (objectUrl && preview !== objectUrl) URL.revokeObjectURL(objectUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pixels?.x, pixels?.y, pixels?.width, pixels?.height, background, enhancement])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function handleAlignFace() {
    if (generatedUrl) {
      setNotice('Return to the original photo before aligning for a new generation.')
      return
    }
    setAlignBusy(true)
    setNotice('')
    onError('')
    try {
      const face = await detectPrimaryFace(imageUrl)
      if (!face) throw new Error('No face was detected. Try a clearer front-facing photo.')
      const media = mediaSize.current
      const frame = cropSize.current
      if (!media || !frame) throw new Error('The canvas is still loading. Try Align Face again.')
      const targetZoom = Math.min(3, Math.max(1, (frame.height * 0.40) / (face.height * media.height)))
      setZoom(targetZoom)
      setCrop({
        x: -(face.x - 0.5) * media.width * targetZoom,
        y: -(face.y - 0.5) * media.height * targetZoom - frame.height * 0.075,
      })
      setPixels(null) // Wait for updated crop coordinates before generation.
      setAlignedForGenerate(true)
      setNotice('Face aligned. You can fine-tune the crop before clicking Generate.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Face alignment failed.')
    } finally { setAlignBusy(false) }
  }

  async function handleRemoveBackground() {
    if (!generatedUrl) return onError('Generate a portrait before removing its background.')
    if (!pixels) return onError('Wait until the portrait crop is ready.')
    if (cutoutUrl) return setNotice('Background already removed. Select a color below.')
    try {
      setRemovalBusy(true)
      setNotice('')
      onError('')
      setStatus('Python is removing the background. The first run may require downloading its AI model…')
      // Send the completed, visually cropped AI portrait, not the original photo.
      const original = await exportPhoto(generatedUrl, pixels, 'white', 'png')
      const cutout = await removeBackgroundInPython(original)
      const url = URL.createObjectURL(cutout)
      if (cutoutRef.current) URL.revokeObjectURL(cutoutRef.current)
      cutoutRef.current = url
      setCutoutUrl(url)
      setCrop({x:0,y:0}); setZoom(1); setPixels(null)
      setNotice('Background removed with Python. Pick white, light gray, or light blue and review the result.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not remove the background.')
    } finally { setRemovalBusy(false); setStatus('') }
  }

  async function handleCloudflareGenerate() {
    try {
      setCloudBusy(true)
      setStatus('Preparing your photo with Python…')
      setNotice('')
      onError('')

      // If Align Face was used, send the actual current canvas crop to Python and AI.
      if (alignedForGenerate && !pixels) throw new Error('Face alignment is still updating. Try Generate again.')
      const uploadInput: string | Blob = alignedForGenerate && pixels
        ? await exportPhoto(imageUrl, pixels, 'white', 'jpeg')
        : imageUrl
      let preparationBlob: Blob | null = null
      let usedPython = false
      try {
        const preparedUrl = typeof uploadInput === 'string' ? uploadInput : URL.createObjectURL(uploadInput)
        try { preparationBlob = await enhancePhotoInPython(preparedUrl, 0.6) }
        finally { if (preparedUrl !== imageUrl) URL.revokeObjectURL(preparedUrl) }
        usedPython = true
      } catch (error) {
        console.warn('Python enhancement unavailable before Cloudflare generation:', error)
      }

      setStatus(usedPython ? 'Python enhancement done. Sending to Cloudflare…' : 'Sending your photo to Cloudflare…')
      const blob = await generateStudioPhoto(preparationBlob ?? uploadInput, studioModel, turnstileToken, outfit, alignedForGenerate)
      const url = URL.createObjectURL(blob)
      if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
      generatedRef.current = url
      setGeneratedUrl(url)
      if (cutoutRef.current) URL.revokeObjectURL(cutoutRef.current)
      cutoutRef.current = null
      setCutoutUrl(null)
      setBackground('white')
      setAlignedForGenerate(false)
      void savePhoto('generated', blob, 'idframe-generated.png').catch(error => console.warn('Generated photo could not be saved:', error))
      setPixels(null)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setActiveTab('export')
      setNotice(`${usedPython ? 'Python enhancement + ' : ''}${outfit === 'female' ? 'Women’s blazer' : 'Men’s suit'} via ${studioModel === 'dev' ? 'FLUX.2 Dev' : 'FLUX.2 Klein 4B'} finished your portrait. Compare the face with your original before downloading; generated results may change facial features.`)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'AI generation failed.')
    } finally {
      setCloudBusy(false)
      setStatus('')
      setTurnstileToken('')
      setTurnstileReset(v => v + 1)
      refreshQuota()
    }
  }

  async function handleDownload() {
    if (!pixels) return onError('Your image crop is not ready yet.')
    try {
      setBusy(true)
      onError('')
      const blob = await exportPhoto(source, pixels, background, format, enhancement)
      const extension = format === 'jpeg' ? 'jpg' : 'png'
      downloadBlob(blob, `idframe-studio-edited-single-photo-${safeBaseName(fileName)}.${extension}`)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to export the photo.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePdf() {
    if (!pixels) return onError('Your crop is not ready yet.')
    try {
      setPdfBusy(true)
      onError('')
      const photo = await exportPhoto(source, pixels, background, 'png', enhancement)
      await downloadPrintSheet(photo, fileName)
      setNotice('8 × 11 inch package PDF created. Print at Actual size / 100%; select a matching custom paper size.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not create the PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  return <div className="editor-page studio-app">
    <div className="editor-heading studio-toolbar">
      <div><div className="eyebrow"><span className="eyebrow-dot"/> IDFRAME / WORKSPACE</div><h1>Professional Photo Studio</h1><p>Generate, refine, and print your portrait, all in one workspace.</p></div>
      <button className="outline-button change-button" type="button" onClick={onReset}><Upload size={16}/> New photo</button>
    </div>
    <div className="studio-layout">
      <section className="studio-canvas card" aria-label="Photo editor">
        <div className="card-heading studio-canvas-head"><div><h2>Canvas</h2><span className="subtle">Drag to reposition · scroll or drag the zoom slider</span></div><span className="pill"><span className="status-dot"/> Live preview</span></div>
        <div className="crop-stage studio-crop-stage"><Cropper key={source} image={source} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onCropComplete={onCropComplete} onZoomChange={setZoom} onMediaLoaded={size => { mediaSize.current = size }} onCropSizeChange={size => { cropSize.current = size }} showGrid objectFit="contain"/></div>
        <div className="studio-canvas-bottom">
          <div className="zoom-control"><div className="field-head"><span>Zoom</span><span className="mono-value">{Math.round(zoom * 100)}%</span></div><div className="zoom-row"><button className="icon-button" onClick={() => setZoom(v => Math.max(1, +(v - 0.1).toFixed(2)))} aria-label="Zoom out"><Minus size={16}/></button><input type="range" aria-label="Zoom" min="1" max="3" step="0.01" value={zoom} onChange={e => setZoom(Number(e.target.value))}/><button className="icon-button" onClick={() => setZoom(v => Math.min(3, +(v + 0.1).toFixed(2)))} aria-label="Zoom in"><Plus size={16}/></button></div></div>
          <div className="studio-small-preview"><div className="mini-label">EXPORT PREVIEW · 600 × 600</div><div className="mini-preview">{preview ? <img src={preview} alt="Current photo export preview"/> : <span>Preparing…</span>}</div></div>
        </div>
        <div className="studio-canvas-footer"><span><ImageIcon size={14}/> {fileName}</span><button className="text-button" type="button" onClick={resetCrop}><RotateCcw size={15}/> Reset crop</button></div>
      </section>
      <aside className="studio-sidebar card" aria-label="Studio controls">
        <div className="studio-tabs" role="tablist" aria-label="Editor options">
          <button role="tab" type="button" aria-selected={activeTab === 'generate'} className={activeTab === 'generate' ? 'active' : ''} onClick={() => setActiveTab('generate')}><Sparkles size={15}/> Generate</button>
          <button role="tab" type="button" aria-selected={activeTab === 'export'} className={activeTab === 'export' ? 'active' : ''} onClick={() => setActiveTab('export')}><Download size={15}/> Export</button>
        </div>
        <div className="studio-sidebar-scroll">
          {activeTab === 'generate' && <div className="studio-tab-content" role="tabpanel">
            <div className="studio-panel-title"><h2>Formal ID portrait generation</h2><p>One click runs Python enhancement first, then Cloudflare generates your chosen formal outfit in a front-facing studio portrait.</p></div>
            <div className="studio-quota" role="status"><ShieldCheck size={17}/><span>{quota ? `${quota.remaining} generation${quota.remaining === 1 ? '' : 's'} left today (max ${quota.dailyLimit} per visitor)` : quotaLoading ? 'Daily usage: checking…' : quotaError ? `Daily usage unavailable: ${quotaError}` : 'Daily usage not loaded'}</span><button type="button" className="text-button" onClick={refreshQuota} disabled={quotaLoading} aria-label="Refresh daily usage" title="Refresh daily usage"><RotateCcw size={15} className={quotaLoading ? 'spinning' : ''}/></button></div>
            <label>Formal outfit</label>
            <div className="outfit-choice-grid" role="group" aria-label="Formal outfit selection">
              <button type="button" className={`outfit-choice ${outfit === 'male' ? 'selected' : ''}`} aria-pressed={outfit === 'male'} disabled={cloudBusy} onClick={() => setOutfit('male')}>
                <span className="outfit-label">{outfit === 'male' && <Check size={14}/>} Male suit & tie</span><small>Black jacket, white shirt, black necktie</small>
              </button>
              <button type="button" className={`outfit-choice ${outfit === 'female' ? 'selected' : ''}`} aria-pressed={outfit === 'female'} disabled={cloudBusy} onClick={() => setOutfit('female')}>
                <span className="outfit-label">{outfit === 'female' && <Check size={14}/>} Female suit / blazer</span><small>Black blazer, white collared blouse, no tie</small>
              </button>
            </div>
            <label htmlFor="studio-model">AI model</label><select id="studio-model" value={studioModel} onChange={e => setStudioModel(e.target.value as StudioModel)} disabled={cloudBusy}><option value="klein">FLUX.2 Klein 4B · economical</option><option value="dev">FLUX.2 Dev · higher detail, heavier quota</option></select>
            <button className="outline-button align-face-button" type="button" disabled={cloudBusy || alignBusy || !!generatedUrl} onClick={handleAlignFace}>
              {alignBusy ? <LoaderCircle size={16} className="spinning"/> : <ScanFace size={16}/>} Align face before generating {alignedForGenerate ? <Check size={14}/> : null}
            </button>
            <p className="help-text">Alignment changes the actual reference sent to Python and Cloudflare. You can also adjust the crop manually.</p>
            <div className="studio-quality"><strong>Combined workflow</strong><span>Step 1 · Python enhances the uploaded photo</span><span>Step 2 · Cloudflare generates the selected outfit</span><span>Step 3 · Customize background and export</span></div>
            <Turnstile siteKey={turnstileKey} onToken={updateToken} resetKey={turnstileReset}/>
            <button className="primary-button professional-action" type="button" disabled={cloudBusy || alignBusy || quota?.remaining === 0 || (!!turnstileKey && !turnstileToken)} onClick={handleCloudflareGenerate}>{cloudBusy ? <LoaderCircle className="spinning" size={17}/> : <Sparkles size={17}/>} {cloudBusy ? 'Generating portrait…' : 'Generate formal ID portrait'} <ArrowRight size={16}/></button>
            {generatedUrl && <button className="outline-button ai-action" type="button" onClick={() => { setGeneratedUrl(null); setPixels(null); setAlignedForGenerate(false); if (cutoutRef.current) URL.revokeObjectURL(cutoutRef.current); cutoutRef.current = null; setCutoutUrl(null); setBackground('white'); void clearGenerated().catch(console.warn); setNotice('Original photo restored.') }}><Undo2 size={16}/> Return to original</button>}
            <p className="help-text">The app sends your photo only when you generate. AI can still alter facial details or fail to fully straighten a pose. Always compare the result with the original.</p>

          </div>}
          {activeTab === 'export' && <div className="studio-tab-content" role="tabpanel">
            <div className="studio-panel-title"><h2>Download & package</h2><p>Export a single edited image or one branded sheet with 4 copies of 2×2 and 6 copies of 1×1 on the same paper.</p></div>
            <div className="studio-divider"/>
            <div className="studio-panel-title"><h2>Portrait background</h2><p>After generating, remove the background using Python, then choose the final color.</p></div>
            <button type="button" className="outline-button align-face-button" disabled={!generatedUrl || removalBusy || cloudBusy || !!cutoutUrl || !pixels} onClick={handleRemoveBackground}>
              {removalBusy ? <LoaderCircle className="spinning" size={16}/> : <Scissors size={16}/>} {removalBusy ? 'Removing background…' : cutoutUrl ? 'Background removed' : 'Remove background with Python'}
            </button>
            <div className="background-choice-grid" role="group" aria-label="Background color">
              {(Object.entries(BACKGROUNDS) as [Background, string][]).map(([key,color]) => (
                <button key={key} type="button" className={`background-choice ${background === key ? 'selected' : ''}`} disabled={!cutoutUrl} aria-pressed={background === key} onClick={() => setBackground(key)}>
                  <span className="background-swatch" style={{backgroundColor:color}}/>
                  <span>{key === 'white' ? 'White' : key === 'gray' ? 'Light gray' : 'Light blue'}</span>
                </button>
              ))}
            </div>
            {!cutoutUrl && <p className="help-text">Generate a portrait, then remove its background to unlock color choices. No extra Cloudflare generation is used.</p>}
            <div className="studio-divider"/>
            <div className="studio-export-preview">{preview ? <img src={preview} alt="Final portrait"/> : <span>Preparing final preview…</span>}</div>
            <label htmlFor="studio-format">Single photo format</label><select id="studio-format" value={format} onChange={e => setFormat(e.target.value as Format)}><option value="png">PNG · 600 × 600</option><option value="jpeg">JPG · 600 × 600</option></select>
            <button type="button" className="primary-button professional-action" onClick={handleDownload} disabled={!pixels || busy}>{busy ? <LoaderCircle className="spinning" size={16}/> : <Download size={16}/>} Download single photo</button>
            <div className="studio-divider"/>
            <div className="studio-panel-title"><h2>IDFrame Studio package PDF</h2><p>One 8 × 11 inch page, centered layout, black cutting borders, and a branded header and footer.</p></div>
            <button type="button" className="print-option" disabled={!pixels || pdfBusy} onClick={handlePdf}><Printer size={19}/><span><strong>4 pcs 2 × 2 + 6 pcs 1 × 1</strong><small>Single PDF package with IDFrame Studio header and footer</small></span>{pdfBusy ? <LoaderCircle className="spinning" size={16}/> : <Download size={16}/>}</button>
            <p className="help-text">Custom 8 × 11 inch page (not standard 8.5 × 11 Letter). Use matching paper or a printer that supports custom sizes, and print at Actual size / 100%.</p>
          </div>}
          {status && <p className="ai-progress" role="status"><LoaderCircle className="spinning" size={15}/> {status}</p>}
          {notice && <p className="ai-notice" role="status">{notice}</p>}
        </div>
        <div className="studio-sidebar-footer"><button type="button" className="outline-button" onClick={() => setActiveTab('export')}><Download size={16}/> Downloads & PDF</button><span>IDFrame Studio package exports</span></div>
      </aside>
    </div>
  </div>
}
