import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { type Area, type MediaSize, type Point } from 'react-easy-crop'
import { Check, Download, ImageIcon, Info, LoaderCircle, Minus, Plus, RotateCcw, ScanFace, Scissors, SlidersHorizontal, Sparkles, Upload, Undo2, Printer, ArrowRight, ShieldCheck } from 'lucide-react'
import { BACKGROUNDS, type Background, type Format, type PixelCrop } from '../types/photo'
import { downloadBlob, exportPhoto } from '../lib/imageProcessing'
import { removePhotoBackground } from '../lib/backgroundRemoval'
import { generateStudioPhoto, getGenerationQuota, type StudioStyle, type StudioBackdrop, type StudioModel } from '../lib/cloudflarePhoto'
import { type QualityResult } from '../lib/photoAnalysis'
import { analyzePhotoWithFallback, enhancePhotoInPython } from '../lib/pythonPhoto'
import { detectPrimaryFace, type DetectedFace } from '../lib/faceDetection'
import Turnstile from './Turnstile'
import { downloadPrintSheet, type PrintSheet } from '../lib/printSheets'
import { clearGenerated, loadPhoto, savePhoto } from '../lib/photoSession'

type Props = { imageUrl: string; fileName: string; onReset: () => void; onError: (message: string) => void }
const backgroundNames: Record<Background, string> = { white: 'White', blue: 'Light blue', gray: 'Light gray' }

type CropSize = { width: number; height: number }

export default function PhotoEditor({ imageUrl, fileName, onReset, onError }: Props) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [background, setBackground] = useState<Background>('white')
  const [format, setFormat] = useState<Format>('png')
  const [pixels, setPixels] = useState<PixelCrop | null>(null)
  const [busy, setBusy] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [studioStyle, setStudioStyle] = useState<StudioStyle>('suit')
  const [studioBackdrop, setStudioBackdrop] = useState<StudioBackdrop>('white')
  const [studioModel, setStudioModel] = useState<StudioModel>('klein')
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const generatedRef = useRef<string | null>(null)
  const [quality, setQuality] = useState<QualityResult | null>(null)
  const [faceCheck, setFaceCheck] = useState('Checking face…')
  const [aiBusy, setAiBusy] = useState<'remove' | 'align' | 'professional' | null>(null)
  const [enhancement, setEnhancement] = useState(0)
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [activeTab, setActiveTab] = useState<'generate' | 'adjust' | 'export'>('generate')
  const [quota, setQuota] = useState<{remaining:number;dailyLimit:number;globalRemaining:number} | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const turnstileKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
  const [preview, setPreview] = useState<string | null>(null)
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)
  const [useCutout, setUseCutout] = useState(false)
  const mediaSize = useRef<MediaSize | null>(null)
  const cropSize = useRef<CropSize | null>(null)
  const processedUrlRef = useRef<string | null>(null)
  const source = generatedUrl ?? (useCutout && processedUrl ? processedUrl : imageUrl)

  useEffect(() => () => { if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current); if (generatedRef.current) URL.revokeObjectURL(generatedRef.current) }, [])
  useEffect(() => { analyzePhotoWithFallback(imageUrl).then(setQuality).catch(() => {}); detectPrimaryFace(imageUrl).then(face => setFaceCheck(face ? 'Face detected' : 'No face detected: use a front-facing portrait')).catch(() => setFaceCheck('Face check unavailable')) }, [imageUrl])
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
  const refreshQuota = useCallback(() => { void getGenerationQuota().then(setQuota).catch(() => setQuota(null)) }, [])
  useEffect(() => { refreshQuota() }, [refreshQuota])

  const onCropComplete = useCallback((_area: Area, croppedPixels: Area) => setPixels(croppedPixels), [])
  const resetCrop = () => { setCrop({ x: 0, y: 0 }); setZoom(1); setNotice('Crop reset. You can reposition the image manually.') }

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
    return () => { disposed = true; if (objectUrl && preview !== objectUrl) URL.revokeObjectURL(objectUrl) }
  // Pixel values are intentional dependencies so changing crop updates the preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pixels?.x, pixels?.y, pixels?.width, pixels?.height, background, enhancement])

  // Free the previous preview only after a replacement has been set.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function positionFace(face: DetectedFace) {
    const media = mediaSize.current
    const frame = cropSize.current
    if (!media || !frame) {
      setNotice('Photo is still loading. Please try Auto-align again.')
      return
    }
    // Zoom to a face size of roughly 40% of the crop height; use an editable starting point,
    // not a claim of compliance with an official ID specification.
    const targetZoom = Math.max(1, Math.min(3, (frame.height * 0.40) / (face.height * media.height)))
    setZoom(targetZoom)
    const x = -(face.x - 0.5) * media.width * targetZoom
    const y = -(face.y - 0.5) * media.height * targetZoom - frame.height * 0.075
    setCrop({ x, y })
    setNotice('Face centered automatically. Review the crop and adjust it if needed.')
  }

  async function handleAlign() {
    try {
      setAiBusy('align'); setStatus('Loading face detector…'); setNotice(''); onError('')
      // Detection uses the original image, avoiding transparent-edge artifacts.
      const face = await detectPrimaryFace(imageUrl)
      if (!face) { setNotice('No face was detected. You can still adjust the crop manually.'); return }
      // Media dimensions match the current source if cutout has the original dimensions.
      positionFace(face)
    } catch (error) {
      console.error(error)
      onError('Could not load the face detector. Check the internet connection and try again; manual cropping still works.')
    } finally { setAiBusy(null); setStatus('') }
  }

  async function handleRemoveBackground() {
    if (processedUrl) { setUseCutout(true); setNotice('Background-free image enabled.'); return }
    try {
      setAiBusy('remove'); setStatus('Starting background removal…'); setNotice(''); onError('')
      const blob = await removePhotoBackground(imageUrl, setStatus)
      const url = URL.createObjectURL(blob)
      if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current)
      processedUrlRef.current = url
      setProcessedUrl(url)
      setPixels(null) // Ensure a new crop is calculated after switching to the cutout.
      setUseCutout(true)
      setNotice('Background removed. Choose a canvas color below, then review the edges.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not remove the background.')
    } finally { setAiBusy(null); setStatus('') }
  }

  async function handleProfessionalize() {
    setAiBusy('professional')
    setNotice('')
    onError('')
    setEnhancement(75)
    setBackground('white')
    const outcomes: string[] = []
    try {
      // Do face detection independently: one AI failure must not prevent the other adjustment.
      setStatus('Detecting and framing your face…')
      try {
        const face = await detectPrimaryFace(imageUrl)
        if (face) { positionFace(face); outcomes.push('Face aligned') }
        else outcomes.push('No face detected: adjust crop manually')
      } catch (error) {
        console.warn('Face detection unavailable:', error)
        outcomes.push('Face detection unavailable: adjust crop manually')
      }
      setStatus('Separating subject from background…')
      try {
        if (processedUrl) {
          setUseCutout(true)
        } else {
          const blob = await removePhotoBackground(imageUrl, setStatus)
          const url = URL.createObjectURL(blob)
          if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current)
          processedUrlRef.current = url
          setProcessedUrl(url)
          setUseCutout(true)
          setPixels(null)
        }
        outcomes.push('White studio-style background applied')
      } catch (error) {
        console.warn('Background removal unavailable:', error)
        outcomes.push('Background removal failed: original background kept')
      }
      outcomes.push('Gentle lighting and contrast adjustment applied')
      setNotice(`${outcomes.join('. ')}. Review the result before downloading.`)
    } finally {
      setAiBusy(null)
      setStatus('')
    }
  }

  async function handlePythonEnhance() {
    try {
      setAiBusy('professional'); setStatus('Enhancing your original photo with Python…'); setNotice(''); onError('')
      const blob = await enhancePhotoInPython(source, 0.6)
      const url = URL.createObjectURL(blob)
      if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
      generatedRef.current = url
      setGeneratedUrl(url)
      void savePhoto('generated', blob, 'idframe-enhanced-photo.jpg').catch(console.warn)
      setPixels(null); setCrop({x:0,y:0}); setZoom(1); setEnhancement(0)
      setNotice('Python enhanced the existing pixels without generating a new face or outfit. You can continue editing or use Cloudflare to generate professional clothing.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Python enhancement failed.')
    } finally { setAiBusy(null); setStatus('') }
  }

  async function handleCloudflareGenerate() {
    try {
      setCloudBusy(true); setStatus('Cloudflare is generating your portrait…'); setNotice(''); onError('')
      const blob = await generateStudioPhoto(imageUrl, studioStyle, studioBackdrop, studioModel, turnstileToken)
      const url = URL.createObjectURL(blob)
      if (generatedRef.current) URL.revokeObjectURL(generatedRef.current)
      generatedRef.current = url
      setGeneratedUrl(url)
      void savePhoto('generated', blob, 'idframe-generated.png').catch(error => console.warn('Generated photo could not be saved:', error))
      setPixels(null)
      setCrop({ x: 0, y: 0 }); setZoom(1)
      setEnhancement(0)
      setNotice(`Portrait generated with ${studioModel === 'dev' ? 'FLUX.2 Dev' : 'FLUX.2 Klein 4B'}. Compare the face with your original before downloading; generated results may change facial features.`)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'AI generation failed.')
    } finally { setCloudBusy(false); setStatus(''); setTurnstileToken(''); setTurnstileReset(v=>v+1); refreshQuota() }
  }

  async function handleDownload() {
    if (!pixels) return onError('Your image crop is not ready yet.')
    try {
      setBusy(true); onError('')
      const blob = await exportPhoto(source, pixels, background, format, enhancement)
      downloadBlob(blob, `idframe-professional-photo.${format === 'jpeg' ? 'jpg' : 'png'}`)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to export the photo.')
    } finally { setBusy(false) }
  }

  async function handlePdf(kind: PrintSheet) {
    if (!pixels) return onError('Your crop is not ready yet.')
    try {
      setPdfBusy(true); onError('')
      const photo = await exportPhoto(source, pixels, background, 'png', enhancement)
      await downloadPrintSheet(photo, kind)
      setNotice('PDF created. Print at Actual size / 100% on 4 × 6-inch paper.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not create the PDF.')
    } finally {setPdfBusy(false)}
  }

  return <div className="editor-page studio-app">
    <div className="editor-heading studio-toolbar">
      <div><div className="eyebrow"><span className="eyebrow-dot"/> IDFRAME / WORKSPACE</div><h1>Professional Photo Studio</h1><p>Generate, refine, and print your portrait, all in one workspace.</p></div>
      <button className="outline-button change-button" type="button" onClick={onReset}><Upload size={16}/> New photo</button>
    </div>
    <div className="studio-layout">
      <section className="studio-canvas card" aria-label="Photo editor">
        <div className="card-heading studio-canvas-head"><div><h2>Canvas</h2><span className="subtle">Drag to reposition · scroll or drag the zoom slider</span></div><span className="pill"><span className="status-dot"/> Live preview</span></div>
        <div className="crop-stage studio-crop-stage"><Cropper key={source} image={source} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onCropComplete={onCropComplete} onZoomChange={setZoom} onMediaLoaded={size => {mediaSize.current=size}} onCropSizeChange={size => {cropSize.current=size}} showGrid objectFit="contain"/></div>
        <div className="studio-canvas-bottom">
          <div className="zoom-control"><div className="field-head"><span>Zoom</span><span className="mono-value">{Math.round(zoom*100)}%</span></div><div className="zoom-row"><button className="icon-button" onClick={()=>setZoom(v=>Math.max(1,+(v-.1).toFixed(2)))} aria-label="Zoom out"><Minus size={16}/></button><input type="range" aria-label="Zoom" min="1" max="3" step="0.01" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><button className="icon-button" onClick={()=>setZoom(v=>Math.min(3,+(v+.1).toFixed(2)))} aria-label="Zoom in"><Plus size={16}/></button></div></div>
          <div className="studio-small-preview"><div className="mini-label">EXPORT PREVIEW · 600 × 600</div><div className="mini-preview">{preview?<img src={preview} alt="Current photo export preview"/>:<span>Preparing…</span>}</div></div>
        </div>
        <div className="studio-canvas-footer"><span><ImageIcon size={14}/> {fileName}</span><button className="text-button" type="button" onClick={resetCrop}><RotateCcw size={15}/> Reset crop</button></div>
      </section>
      <aside className="studio-sidebar card" aria-label="Studio controls">
        <div className="studio-tabs" role="tablist" aria-label="Editor options">
          <button role="tab" type="button" aria-selected={activeTab==='generate'} className={activeTab==='generate'?'active':''} onClick={()=>setActiveTab('generate')}><Sparkles size={15}/> Generate</button>
          <button role="tab" type="button" aria-selected={activeTab==='adjust'} className={activeTab==='adjust'?'active':''} onClick={()=>setActiveTab('adjust')}><SlidersHorizontal size={15}/> Adjust</button>
          <button role="tab" type="button" aria-selected={activeTab==='export'} className={activeTab==='export'?'active':''} onClick={()=>setActiveTab('export')}><Download size={15}/> Export</button>
        </div>
        <div className="studio-sidebar-scroll">
          {activeTab==='generate'&&<div className="studio-tab-content" role="tabpanel">
            <div className="studio-panel-title"><h2>AI portrait generation</h2><p>Convert an everyday photo into a studio-style portrait.</p></div>
            <div className="studio-quota"><ShieldCheck size={17}/><span>{quota?`${quota.remaining} generation${quota.remaining===1?'':'s'} left today (max ${quota.dailyLimit} per visitor)`:'Daily usage: checking…'}</span></div>
            <label htmlFor="studio-model">AI model</label><select id="studio-model" value={studioModel} onChange={e=>setStudioModel(e.target.value as StudioModel)} disabled={cloudBusy}><option value="klein">FLUX.2 Klein 4B · economical</option><option value="dev">FLUX.2 Dev · higher-detail, heavier quota</option></select>
            <label htmlFor="studio-attire">Professional outfit</label><select id="studio-attire" value={studioStyle} onChange={e=>setStudioStyle(e.target.value as StudioStyle)} disabled={cloudBusy}><option value="suit">Formal business suit</option><option value="business-casual">Smart business casual</option><option value="original">Keep original clothing</option></select>
            <label htmlFor="studio-background">Studio background</label><select id="studio-background" value={studioBackdrop} onChange={e=>setStudioBackdrop(e.target.value as StudioBackdrop)} disabled={cloudBusy}><option value="white">Clean white</option><option value="gray">Neutral gray</option><option value="blue">Soft blue</option></select>
            <Turnstile siteKey={turnstileKey} onToken={updateToken} resetKey={turnstileReset}/>
            <button className="primary-button professional-action" type="button" disabled={cloudBusy||!!aiBusy||quota?.remaining===0||(!!turnstileKey&&!turnstileToken)} onClick={handleCloudflareGenerate}>{cloudBusy?<LoaderCircle className="spinning" size={17}/>:<Sparkles size={17}/>} {cloudBusy?'Generating portrait…':'Generate professional photo'} <ArrowRight size={16}/></button>
            {generatedUrl&&<button className="outline-button ai-action" type="button" onClick={()=>{setGeneratedUrl(null);setPixels(null);void clearGenerated().catch(console.warn);setNotice('Original photo restored.')}}><Undo2 size={16}/> Return to original</button>}
            <p className="help-text">Your photo is sent to Cloudflare only when you generate. AI may change facial details. This is not guaranteed to meet official ID requirements.</p>
            <div className="studio-quality"><strong>Photo checks</strong><span>{faceCheck}</span>{quality&&<><span>{quality.width} × {quality.height} pixels</span>{quality.tips.map((tip,i)=><span key={i}>{tip}</span>)}</>}</div>
          </div>}
          {activeTab==='adjust'&&<div className="studio-tab-content" role="tabpanel">
            <div className="studio-panel-title"><h2>Refine your portrait</h2><p>Manual tools and private browser-based AI.</p></div>
            <button className="outline-button ai-action" type="button" disabled={!!aiBusy||cloudBusy} onClick={handlePythonEnhance}><SlidersHorizontal size={16}/> Enhance with Python</button>
            <button className="primary-button professional-action" type="button" disabled={!!aiBusy} onClick={handleProfessionalize}>{aiBusy==='professional'?<LoaderCircle className="spinning" size={17}/>:<Sparkles size={17}/>} Auto prepare photo</button>
            <div className="ai-actions"><button className="outline-button ai-action" type="button" disabled={!!aiBusy} onClick={handleRemoveBackground}><Scissors size={16}/> Remove background</button><button className="outline-button ai-action" type="button" disabled={!!aiBusy} onClick={handleAlign}><ScanFace size={16}/> Align face</button></div>
            {processedUrl&&<button className="text-button" onClick={()=>{setPixels(null);setUseCutout(v=>!v)}}>{useCutout?'Show original photo':'Show cutout image'}</button>}
            <div className="studio-divider"/><div className="field-head"><label htmlFor="studio-lighting">Lighting</label><span>{enhancement}%</span></div><input id="studio-lighting" type="range" min="0" max="100" step="5" value={enhancement} onChange={e=>setEnhancement(Number(e.target.value))}/>
            <label>Background color</label><div className="swatch-list">{(Object.keys(BACKGROUNDS) as Background[]).map(key=><button key={key} className={`swatch-choice ${background===key?'selected':''}`} type="button" onClick={()=>setBackground(key)} aria-pressed={background===key}><span className="swatch" style={{background:BACKGROUNDS[key]}}>{background===key&&<Check size={14} color="#333"/>}</span>{backgroundNames[key]}</button>)}</div>
            <p className="help-text"><Info size={13}/> Background colors show through transparent photos only. Remove the background first to replace an opaque one.</p>
          </div>}
          {activeTab==='export'&&<div className="studio-tab-content" role="tabpanel">
            <div className="studio-panel-title"><h2>Download & print</h2><p>Save one portrait or an accurately sized photo sheet.</p></div>
            <div className="studio-export-preview">{preview?<img src={preview} alt="Final portrait"/>:<span>Preparing final preview…</span>}</div>
            <label htmlFor="studio-format">Single photo format</label><select id="studio-format" value={format} onChange={e=>setFormat(e.target.value as Format)}><option value="png">PNG · 600 × 600</option><option value="jpeg">JPG · 600 × 600</option></select>
            <button type="button" className="primary-button professional-action" onClick={handleDownload} disabled={!pixels||busy}>{busy?<LoaderCircle className="spinning" size={16}/>:<Download size={16}/>} Download single photo</button>
            <div className="studio-divider"/><div className="studio-panel-title"><h2>Print-ready PDF sheets</h2><p>Each PDF is 4 × 6 inches. Print at 100% scale, not “Fit to page.”</p></div>
            <button type="button" className="print-option" disabled={!pixels||pdfBusy} onClick={()=>handlePdf('four-2x2')}><Printer size={19}/><span><strong>4 photos · 2 × 2 inches</strong><small>2 columns × 2 rows · PDF</small></span><Download size={16}/></button>
            <button type="button" className="print-option" disabled={!pixels||pdfBusy} onClick={()=>handlePdf('eight-1x1')}><Printer size={19}/><span><strong>8 photos · 1 × 1 inch</strong><small>4 columns × 2 rows · PDF</small></span><Download size={16}/></button>
            <p className="help-text">Print on 4 × 6-inch photo paper at actual size. Confirm the photo requirements of the document or organization before use.</p>
          </div>}
          {status&&<p className="ai-progress" role="status"><LoaderCircle className="spinning" size={15}/> {status}</p>}
          {notice&&<p className="ai-notice" role="status">{notice}</p>}
        </div>
        <div className="studio-sidebar-footer"><button type="button" className="outline-button" onClick={()=>setActiveTab('export')}><Download size={16}/> Downloads & PDF</button><span>Private local edits</span></div>
      </aside>
    </div>
  </div>
}
