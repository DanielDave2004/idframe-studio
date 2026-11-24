import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

/** Turnstile is required for public AI generation when configured on Cloudflare. */
export default function Turnstile({siteKey, onToken, resetKey}: {siteKey: string; onToken: (token: string) => void; resetKey: number}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!siteKey || !container.current) return
    let widget: string | undefined
    let cancelled = false
    const mount = () => {
      if (cancelled || !container.current || !window.turnstile) return
      container.current.replaceChildren()
      widget = window.turnstile.render(container.current, {
        sitekey:siteKey,
        callback:(token: string)=>onToken(token),
        'expired-callback':()=>onToken(''),
        'error-callback':()=>onToken(''),
        theme:'auto',
      })
    }
    const existing = document.querySelector('script[data-idframe-turnstile]') as HTMLScriptElement | null
    if (window.turnstile) mount()
    else if (existing) existing.addEventListener('load',mount)
    else {
      const script=document.createElement('script')
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async=true; script.defer=true; script.dataset.idframeTurnstile='true'
      script.addEventListener('load',mount)
      document.head.appendChild(script)
    }
    return () => {cancelled=true; if(existing)existing.removeEventListener('load',mount); if(widget && window.turnstile)window.turnstile.remove(widget); onToken('')}
  // The parent passes a stable onToken callback.
  },[siteKey,resetKey,onToken])
  if (!siteKey) return <p className="help-text">Verification is disabled in local development. Configure Turnstile before publishing.</p>
  return <div className="turnstile-container" ref={container} aria-label="Human verification" />
}
