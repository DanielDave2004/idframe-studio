import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { ArrowRight, Download, ImageIcon, LoaderCircle, Minus, Plus, Printer, RotateCcw, ShieldCheck, Sparkles, Upload, Undo2 } from 'lucide-react'
import { type Format, type PixelCrop } from '../types/photo'
import { downloadBlob, exportPhoto } from '../lib/imageProcessing'
import { generateStudioPhoto, getGenerationQuota, type StudioModel } from '../lib/cloudflarePhoto'
import { enhancePhotoInPython } from '../lib/pythonPhoto'
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
  const background = 'white' as const
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
  const source = generatedUrl ?? imageUrl

  useEffect(() => () => {
    if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
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

  async function handleCloudflareGenerate() {
    try {
      setCloudBusy(true)
      setStatus('Preparing your photo with Python…')
      setNotice('')
      onError('')

      let preparationBlob: Blob | null = null
      let usedPython = false
      try {
        preparationBlob = await enhancePhotoInPython(imageUrl, 0.6)
        usedPython = true
      } catch (error) {
        console.warn('Python enhancement unavailable before Cloudflare generation:', error)
      }

      setStatus(usedPython ? 'Python enhancement done. Sending to Cloudflare…' : 'Sending your photo to Cloudflare…')
      const blob = await generateStudioPhoto(preparationBlob ?? imageUrl, studioModel, turnstileToken)
      const url = URL.createObjectURL(blob)
      if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
      generatedRef.current = url
      setGeneratedUrl(url)
      void savePhoto('generated', blob, 'idframe-generated.png').catch(error => console.warn('Generated photo could not be saved:', error))
      setPixels(null)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setActiveTab('export')
      setNotice(`${usedPython ? 'Python enhancement + ' : ''}${studioModel === 'dev' ? 'FLUX.2 Dev' : 'FLUX.2 Klein 4B'} finished your portrait. Compare the face with your original before downloading; generated results may change facial features.`)
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
        <div className="crop-stage studio-crop-stage"><Cropper key={source} image={source} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onCropComplete={onCropComplete} onZoomChange={setZoom} showGrid objectFit="contain"/></div>
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
            <div className="studio-panel-title"><h2>Formal ID portrait generation</h2><p>One click runs Python enhancement first, then Cloudflare creates a front-facing portrait with a black suit, white dress shirt, black tie, and a clean studio background.</p></div>
            <div className="studio-quota" role="status"><ShieldCheck size={17}/><span>{quota ? `${quota.remaining} generation${quota.remaining === 1 ? '' : 's'} left today (max ${quota.dailyLimit} per visitor)` : quotaLoading ? 'Daily usage: checking…' : quotaError ? `Daily usage unavailable: ${quotaError}` : 'Daily usage not loaded'}</span><button type="button" className="text-button" onClick={refreshQuota} disabled={quotaLoading} aria-label="Refresh daily usage" title="Refresh daily usage"><RotateCcw size={15} className={quotaLoading ? 'spinning' : ''}/></button></div>
            <label htmlFor="studio-model">AI model</label><select id="studio-model" value={studioModel} onChange={e => setStudioModel(e.target.value as StudioModel)} disabled={cloudBusy}><option value="klein">FLUX.2 Klein 4B · economical</option><option value="dev">FLUX.2 Dev · higher detail, heavier quota</option></select>
            <div className="studio-quality"><strong>Combined workflow</strong><span>Step 1 · Python enhances the uploaded photo</span><span>Step 2 · Cloudflare generates the formal portrait</span><span>Step 3 · You export a final PNG or package PDF</span></div>
            <Turnstile siteKey={turnstileKey} onToken={updateToken} resetKey={turnstileReset}/>
            <button className="primary-button professional-action" type="button" disabled={cloudBusy || quota?.remaining === 0 || (!!turnstileKey && !turnstileToken)} onClick={handleCloudflareGenerate}>{cloudBusy ? <LoaderCircle className="spinning" size={17}/> : <Sparkles size={17}/>} {cloudBusy ? 'Generating portrait…' : 'Generate formal ID portrait'} <ArrowRight size={16}/></button>
            {generatedUrl && <button className="outline-button ai-action" type="button" onClick={() => { setGeneratedUrl(null); setPixels(null); void clearGenerated().catch(console.warn); setNotice('Original photo restored.') }}><Undo2 size={16}/> Return to original</button>}
            <p className="help-text">The app sends your photo only when you generate. AI can still alter facial details or fail to fully straighten a pose. Always compare the result with the original.</p>

          </div>}
          {activeTab === 'export' && <div className="studio-tab-content" role="tabpanel">
            <div className="studio-panel-title"><h2>Download & package</h2><p>Export a single edited image or one branded sheet with 4 copies of 2×2 and 6 copies of 1×1 on the same paper.</p></div>
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
