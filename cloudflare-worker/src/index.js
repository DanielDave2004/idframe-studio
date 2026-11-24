// Select FLUX.2 Dev by default. Klein 4B remains available as a fallback.
const MODELS = {
  dev: '@cf/black-forest-labs/flux-2-dev',
  klein: '@cf/black-forest-labs/flux-2-klein-4b',
}
const DEFAULT_MODEL = 'klein'
const styleDescriptions = {
  suit: 'a simple tailored dark charcoal business blazer and white collared shirt',
  'business-casual': 'a neat business casual collared shirt and modest blazer',
  original: 'the same clothing shown in the reference image, without changing the outfit',
}
const backdrops = {
  white: 'a pure white seamless studio background',
  gray: 'a light neutral gray seamless studio background',
  blue: 'a plain pale blue seamless studio background',
}

function cors(origin, env) {
  const allowed = origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173' || origin === env.ALLOWED_ORIGIN
  return allowed ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {}
}

function json(message, status, headers) { return new Response(JSON.stringify({error: message}), {status, headers:{'Content-Type':'application/json',...headers}}) }

// The Durable Object is a persistent, atomic daily counter on Cloudflare.
// Each object stores only a number, not an image or a raw IP address.
export class GenerationCounter {
  constructor(ctx) {
    this.ctx = ctx
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, used INTEGER NOT NULL)')
    this.ctx.storage.sql.exec('INSERT INTO usage (id, used) VALUES (1, 0) ON CONFLICT(id) DO NOTHING')
  }
  async fetch(request) {
    const { action, limit } = await request.json()
    const maximum = Math.max(1, Math.floor(Number(limit) || 1))
    const current = this.ctx.storage.sql.exec('SELECT used FROM usage WHERE id = 1').one().used
    if (action === 'reserve' && current < maximum) {
      this.ctx.storage.sql.exec('UPDATE usage SET used = used + 1 WHERE id = 1')
      return Response.json({ allowed: true, remaining: maximum - current - 1 })
    }
    if (action === 'refund') {
      this.ctx.storage.sql.exec('UPDATE usage SET used = MAX(0, used - 1) WHERE id = 1')
      return Response.json({ allowed: true, remaining: Math.min(maximum, maximum - current + 1) })
    }
    return Response.json({ allowed: action !== 'reserve', remaining: Math.max(0, maximum - current) })
  }
}

const VISITOR_LIMIT = 5
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
function utcDay() { return new Date().toISOString().slice(0, 10) }
function nextReset() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1)).toISOString() }
async function anonVisitor(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || (new URL(request.url).hostname === 'localhost' ? '127.0.0.1' : '')
  if (!ip || !env.RATE_LIMIT_SALT) throw new Error('RATE_LIMIT_CONFIGURATION_MISSING')
  const data = new TextEncoder().encode(`${env.RATE_LIMIT_SALT}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), c => c.toString(16).padStart(2, '0')).join('')
}
async function usage(env, key, action, limit) {
  const id = env.GENERATION_COUNTER.idFromName(key)
  const stub = env.GENERATION_COUNTER.get(id)
  const response = await stub.fetch('https://counter.internal/', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action, limit}),
  })
  if (!response.ok) throw new Error('RATE_LIMITER_UNAVAILABLE')
  return response.json()
}
async function checkTurnstile(request, env, token) {
  // Local bypass works only for a local Worker hostname, NEVER for public deployment.
  const hostname = new URL(request.url).hostname
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && env.DEV_SKIP_TURNSTILE === 'true') return true
  if (!env.TURNSTILE_SECRET || !token) return false
  const body = new FormData()
  body.append('secret', env.TURNSTILE_SECRET)
  body.append('response', token)
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip) body.append('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method:'POST', body})
  if (!response.ok) return false
  const outcome = await response.json()
  return outcome.success === true
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const headers = cors(origin, env)
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers})
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ok:true, model:MODELS[DEFAULT_MODEL], models:MODELS}, {headers:{...headers,...JSON_HEADERS}})
    if (!['/api/generate','/api/usage'].includes(url.pathname)) return json('Route not found.',404,headers)
    if (!headers['Access-Control-Allow-Origin']) return json('Origin not allowed. Check ALLOWED_ORIGIN.',403,headers)
    if (!env.GENERATION_COUNTER) return json('Counter binding missing. Deploy with the Durable Object configuration.',503,headers)
    if (!env.RATE_LIMIT_SALT) return json('RATE_LIMIT_SALT is not configured. See README.',503,headers)
    const globalLimit = Math.max(1, Math.min(100, Number(env.GLOBAL_DAILY_LIMIT || 12)))
    let visitorKey
    try { visitorKey = `${utcDay()}:visitor:${await anonVisitor(request,env)}` }
    catch { return json('Rate limiter cannot identify the visitor. Check Worker configuration.',503,headers) }
    const globalKey = `${utcDay()}:global`
    if (url.pathname === '/api/usage' && request.method === 'GET') {
      try {
        const [personal, global] = await Promise.all([usage(env,visitorKey,'status',VISITOR_LIMIT), usage(env,globalKey,'status',globalLimit)])
        return Response.json({remaining:Math.min(personal.remaining,global.remaining), personalRemaining:personal.remaining, globalRemaining:global.remaining, dailyLimit:VISITOR_LIMIT, resetAt:nextReset(), note:'Resets at next UTC midnight'}, {headers:{...headers,...JSON_HEADERS}})
      } catch { return json('Usage service unavailable.',503,headers) }
    }
    if (url.pathname !== '/api/generate' || request.method !== 'POST') return json('Method not allowed.',405,headers)
    if (!env.AI) return json('Workers AI binding is missing.',503,headers)
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.startsWith('multipart/form-data')) return json('Expected multipart form data.',415,headers)
    if (Number(request.headers.get('content-length') || 0) > 2_000_000) return json('Upload too large.',413,headers)
    let globalReserved = false
    let visitorReserved = false
    let success = false
    try {
      const form = await request.formData()
      const photo = form.get('photo')
      const style = form.get('style')
      const backdrop = form.get('backdrop')
      const modelChoice = String(form.get('model') || DEFAULT_MODEL)
      if (!(photo instanceof File) || !['image/jpeg','image/png'].includes(photo.type) || photo.size > 1_000_000 || !photo.size) return json('Please upload a JPG or PNG under 1 MB.',400,headers)
      if (!(style in styleDescriptions) || !(backdrop in backdrops) || !Object.hasOwn(MODELS, modelChoice)) return json('Invalid photo settings or model.',400,headers)
      if (!await checkTurnstile(request, env, String(form.get('turnstileToken') || ''))) return json('Human verification required. Complete the Turnstile challenge and retry.',403,headers)

      // Count even failed requests as attempts to prevent repeated costly failures.
      const attempts = await usage(env,`${visitorKey}:attempts`,'reserve',12)
      if (!attempts.allowed) return json('Too many generation attempts today. Try again after midnight UTC.',429,headers)
      const global = await usage(env,globalKey,'reserve',globalLimit)
      if (!global.allowed) return json('The studio daily AI budget is exhausted. Manual editing and PDF downloads are still available. Try tomorrow (UTC).',429,headers)
      globalReserved = true
      const personal = await usage(env,visitorKey,'reserve',VISITOR_LIMIT)
      if (!personal.allowed) return json('Daily limit reached: 5 generations per visitor. You can edit and download existing photos, or return tomorrow (UTC).',429,headers)
      visitorReserved = true

      const prompt = `Edit input image 0 into a realistic head-and-shoulders professional studio photograph of the SAME person. The uploaded photo is the identity reference. Keep the original face, jawline, eyes, nose, lips, ears, skin tone, apparent age, hairstyle, hairline and facial expression as close to the reference as possible. Do not add a smile, beautify, alter facial proportions, change hairstyle, or invent different facial characteristics. Keep the face forward and preserve the original expression. Modify ONLY the clothes to ${styleDescriptions[style]}, the backdrop to ${backdrops[backdrop]}, and apply subtle even studio lighting. Natural skin texture, headroom, centered shoulders, no beauty filter, no text, watermark, extra people, or illustration. Faithful photographic edit of the original person, not a different person.`
      const input = new FormData()
      input.append('prompt', prompt)
      input.append('input_image_0', photo, 'photo.jpg')
      input.append('width', '768')
      input.append('height', '768')
      const message = new Response(input)
      const result = await env.AI.run(MODELS[modelChoice], {multipart: {body: message.body, contentType: message.headers.get('content-type')}})
      if (!result?.image || typeof result.image !== 'string') throw new Error('Image generation returned no image.')
      const bytes = Uint8Array.from(atob(result.image), char => char.charCodeAt(0))
      const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png'
      success = true
      return new Response(bytes, {headers:{...headers,'Content-Type':mime,'Cache-Control':'no-store','X-IDFrame-Remaining':String(personal.remaining),'Access-Control-Expose-Headers':'X-IDFrame-Remaining'}})
    } catch (error) {
      const message = String(error?.message || error)
      console.error('IDFrame Worker generation error:', message)
      if (/quota|neurons|rate.?limit|limit reached/i.test(message)) return json('Cloudflare AI daily quota reached. Try again after the reset.',429,headers)
      if (/model|subscription|plan|permission|not available|forbidden|not found|unsupported/i.test(message)) return json('This model is unavailable on your Cloudflare account. Try FLUX.2 Klein 4B.',502,headers)
      return json('Generation failed. Check the Cloudflare Worker logs and try again.',502,headers)
    } finally {
      // Failed AI requests do not consume a generation. Reservations avoid race conditions.
      if (!success) {
        if (visitorReserved) await usage(env,visitorKey,'refund',VISITOR_LIMIT).catch(console.error)
        if (globalReserved) await usage(env,globalKey,'refund',globalLimit).catch(console.error)
      }
    }
  },
}
