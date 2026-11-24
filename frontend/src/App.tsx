import { useEffect, useState } from 'react'
import { Aperture, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Download, Github, Image as ImageIcon, LockKeyhole, Menu, Moon, ScanFace, ShieldCheck, Sparkles, Sun, WandSparkles, X } from 'lucide-react'
import PhotoUploader from './components/PhotoUploader'
import PhotoEditor from './components/PhotoEditor'
import { clearPhotos, loadPhoto, savePhoto } from './lib/photoSession'

type Photo = { url: string; name: string }
const steps = [
  { number:'01', title:'Upload your photo', description:'Start with a clear selfie or everyday portrait. You don’t need a studio or a camera setup.', icon: ImageIcon },
  { number:'02', title:'Create your look', description:'Choose a formal outfit and a clean backdrop, then generate with Cloudflare AI.', icon: WandSparkles },
  { number:'03', title:'Make it yours', description:'Fine-tune the crop, compare the result, and download a polished portrait.', icon: Download },
]
const faqs = [
  {question:'Can I use any photo?', answer:'A clear photo with one visible, front-facing person works best. Very blurry, low-light or partially hidden faces can reduce the quality of the result.'},
  {question:'Will AI change my face?', answer:'Generative AI can sometimes alter facial details. Always compare the result to your original photo before using it. For official identification, use a photo that follows the specific agency’s requirements.'},
  {question:'Are my photos private?', answer:'Manual crop and adjustment tools run in your browser. When you choose AI generation, your photo is sent to the Cloudflare Worker you configured for processing.'},
  {question:'Do I need to create an account?', answer:'No account is required in this version. Your ongoing editing session is stored locally in your browser.'},
]

function App() {
  const [photo,setPhoto] = useState<Photo|null>(null)
  const [restoring,setRestoring] = useState(true)
  const [error,setError] = useState('')
  const [dark,setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [help,setHelp] = useState(false)
  const [menuOpen,setMenuOpen] = useState(false)
  const [expandedFaq,setExpandedFaq] = useState<number|null>(0)
  useEffect(() => {document.documentElement.dataset.theme=dark?'dark':'light'},[dark])
  useEffect(() => {
    let active=true
    loadPhoto('original').then(saved=>{if(active && saved) setPhoto({url:URL.createObjectURL(saved.blob),name:saved.name})})
      .catch(error=>console.warn('Could not restore photo session:',error))
      .finally(()=>{if(active)setRestoring(false)})
    return()=>{active=false}
  },[])
  useEffect(()=>()=>{if(photo) URL.revokeObjectURL(photo.url)},[photo])
  const onUpload=(file:File)=>{
    setPhoto({url:URL.createObjectURL(file),name:file.name})
    setError('')
    window.scrollTo({top:0,behavior:'smooth'})
    void clearPhotos().then(()=>savePhoto('original',file,file.name)).catch(error=>console.warn('Photo session could not be saved:',error))
  }
  const reset=()=>{setPhoto(null);setError('');void clearPhotos().catch(console.warn);window.scrollTo({top:0,behavior:'smooth'})}
  const scrollToUpload=()=>document.getElementById('start')?.scrollIntoView({behavior:'smooth',block:'center'})
  const closeMenu=()=>setMenuOpen(false)
  return <div className={`site-shell site-redesign ${photo ? 'editing-mode' : ''}`}>
    <header className="site-header"><div className="header-inner">
      <a href="#top" className="brand" onClick={event=>{if(photo){event.preventDefault();reset()}closeMenu()}} aria-label="IDFrame home"><span className="brand-icon"><Aperture size={21} strokeWidth={2.2}/></span><span>ID<span className="brand-light">Frame</span></span><span className="brand-beta">STUDIO</span></a>
      <nav className={`main-nav ${menuOpen?'nav-open':''}`} aria-label="Main navigation">
        <a href="#how-it-works" onClick={closeMenu}>How it works</a><a href="#features" onClick={closeMenu}>Features</a><a href="#faq" onClick={closeMenu}>FAQ</a>
      </nav>
      <div className="header-actions"><span className="header-caption"><span className="live-dot"/> AI portrait studio</span><button className="header-icon" onClick={()=>setDark(v=>!v)} aria-label="Toggle theme" title="Toggle theme">{dark?<Sun size={19}/>:<Moon size={19}/>}</button><button className="header-icon help-icon" onClick={()=>setHelp(true)} aria-label="About IDFrame"><CircleHelp size={19}/></button><button className="nav-cta" onClick={photo?reset:scrollToUpload}>{photo?'New photo':'Open studio'} <ArrowUpRight size={16}/></button><button className="header-icon mobile-nav-toggle" onClick={()=>setMenuOpen(v=>!v)} aria-label="Toggle navigation">{menuOpen?<X size={20}/>:<Menu size={20}/>}</button></div>
    </div></header>
    <main id="top" className="main-content">
      {error&&<div className="alert" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={18}/></button></div>}
      {restoring?<div className="restore-state" role="status">Restoring your photo studio…</div>:photo?<PhotoEditor imageUrl={photo.url} fileName={photo.name} onReset={reset} onError={setError}/>:<>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy"><div className="hero-kicker"><span className="kicker-mark"><Sparkles size={14}/></span> YOUR PERSONAL AI PHOTO STUDIO <span className="kicker-rule"/></div>
            <h1 id="hero-title">Your best first<br/>impression <em>starts here.</em></h1>
            <p className="hero-description">Turn an everyday photo into a clean, professional portrait. Studio-style backgrounds, polished outfits, and your best angle, all in one simple workspace.</p>
            <div className="hero-actions"><button className="hero-primary" onClick={scrollToUpload}>Create your portrait <ArrowRight size={19}/></button><a className="hero-link" href="#how-it-works">See how it works <ArrowUpRight size={17}/></a></div>
            <div className="hero-micro"><span><Check size={15}/> No account required</span><span><Check size={15}/> Edit before downloading</span></div>
          </div>
          <div className="hero-visual" aria-label="IDFrame studio preview illustration"><div className="visual-dot-grid"/><div className="visual-window"><div className="visual-toolbar"><span><span className="visual-orb"/> IDFRAME / PREVIEW</span><span>01 : 01 <span className="window-ellipsis">•••</span></span></div><div className="visual-art"><div className="portrait-halo"/><div className="silhouette-person"><div className="person-hair"/><div className="person-head"/><div className="person-neck"/><div className="person-jacket"/><div className="person-shirt"/><div className="person-tie"/></div><div className="frame-guides"><i/><i/><i/><i/></div></div><div className="visual-caption"><div><strong>Professional portrait</strong><span>Studio · Clean gray</span></div><span className="visual-check"><Check size={17}/></span></div></div><div className="floating-label"><span className="floating-sparkle"><Sparkles size={17}/></span><span>Made with AI<strong>Studio-ready look</strong></span></div><div className="visual-counter">PORTRAIT STUDIO <span>↗</span></div></div>
        </section>
        <div className="trust-strip"><span>MADE FOR YOUR NEXT OPPORTUNITY</span><div><span>Resumes</span><i/> <span>LinkedIn</span><i/> <span>Portfolios</span><i/> <span>Professional profiles</span></div></div>
        <section id="start" className="studio-section"><div className="section-intro"><div className="section-label"><span className="section-index">01 /</span> GET STARTED</div><h2>A polished photo, <span>in a few clicks.</span></h2><p>No special equipment needed. Choose a photo you like and make it ready for your next opportunity.</p></div><PhotoUploader onUpload={onUpload} onError={setError}/></section>
        <section id="how-it-works" className="process-section"><div className="section-intro section-intro-left"><div className="section-label"><span className="section-index">02 /</span> THE PROCESS</div><h2>From casual to <span>confident.</span></h2><p>A straightforward process from your camera roll to a professional-looking result.</p></div><div className="process-grid">{steps.map(step=><div className="process-card" key={step.number}><div className="process-card-top"><span>{step.number}</span><step.icon size={23} strokeWidth={1.65}/></div><h3>{step.title}</h3><p>{step.description}</p><span className="process-arrow"><ArrowUpRight size={18}/></span></div>)}</div></section>
        <section id="features" className="feature-section"><div className="feature-story"><div className="section-label"><span className="section-index">03 /</span> BUILT FOR REAL LIFE</div><h2>Everything you need.<br/><span>Nothing you don't.</span></h2><p>Keep your original photo, explore a professional look with Cloudflare AI, and make precise edits before downloading.</p><div className="feature-points"><div><span><Sparkles size={19}/></span><div><strong>AI studio transformation</strong><p>Optional outfits and clean backgrounds for profile portraits.</p></div></div><div><span><ScanFace size={19}/></span><div><strong>Smart framing</strong><p>Face detection, background removal, crop, and zoom tools.</p></div></div><div><span><ShieldCheck size={19}/></span><div><strong>You're in control</strong><p>Manual edits stay local. Cloud AI runs only when requested.</p></div></div></div></div><div className="feature-visual"><div className="feature-paper"><span className="paper-top">IDFRAME STUDIO <Aperture size={17}/></span><div className="paper-image"><div className="mini-person"><span/><i/></div></div><div className="paper-bottom"><span>DESIGNED FOR YOUR NEXT CHAPTER</span><span>001—2026</span></div></div><div className="feature-stamp">YOUR PHOTO,<br/>YOUR WAY <ArrowUpRight size={19}/></div></div></section>
        <section id="faq" className="faq-section"><div className="section-intro section-intro-left"><div className="section-label"><span className="section-index">04 /</span> GOOD TO KNOW</div><h2>Questions, <span>answered.</span></h2></div><div className="faq-list">{faqs.map((faq,index)=><div className="faq-entry" key={faq.question}><button aria-expanded={expandedFaq===index} onClick={()=>setExpandedFaq(v=>v===index?null:index)}><span>{faq.question}</span><ChevronDown size={19} className={expandedFaq===index?'chevron-open':''}/></button>{expandedFaq===index&&<p>{faq.answer}</p>}</div>)}</div></section>
        <section className="bottom-cta"><div><div className="section-label">READY WHEN YOU ARE</div><h2>A professional look<br/>starts with one photo.</h2><p>Bring your everyday photo. We'll help with the rest.</p></div><button className="hero-primary" onClick={scrollToUpload}>Create your portrait <ArrowRight size={19}/></button></section>
      </>}
    </main>
    {!photo&&<footer className="site-footer"><div className="footer-brand"><span className="footer-mark"><Aperture size={19}/></span><strong>IDFrame</strong><span>Professional portraits, made simpler.</span></div><div className="footer-links"><a href="#how-it-works">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a><a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub"><Github size={17}/></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} IDFrame. All rights reserved.</span><span>Generative AI can change facial details. Not intended to verify official ID compliance.</span></div></footer>}
    {help&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setHelp(false)}}><div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="close-modal" onClick={()=>setHelp(false)} aria-label="Close"><X size={20}/></button><span className="modal-mark"><Aperture size={24}/></span><h2 id="help-title">Welcome to IDFrame</h2><p>IDFrame helps turn ordinary portraits into professional-looking photos. Upload a photo, choose an AI style, review the result, then refine your crop and download.</p><div className="modal-note"><LockKeyhole size={18}/><span>Local editing stays in your browser. Cloud generation sends your photo to the Cloudflare Worker you configure.</span></div><p className="modal-caution">Generative AI can change facial details. The results are for resumes and profile photos, not guaranteed to satisfy official ID or passport rules.</p><button className="primary-button" onClick={()=>setHelp(false)}>Understood <ArrowRight size={17}/></button></div></div>}
  </div>
}
export default App
