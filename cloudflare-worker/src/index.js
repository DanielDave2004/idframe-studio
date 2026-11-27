// Select FLUX.2 Dev by default. Klein 4B remains available as a fallback.
const MODELS = {
  dev: '@cf/black-forest-labs/flux-2-dev',
  klein: '@cf/black-forest-labs/flux-2-klein-4b',
}
const DEFAULT_MODEL = 'klein'
// Fixed studio portrait composition. Outfit is selected from a strict server-controlled allowlist.
const FORMAL_PORTRAIT_PROMPT = `Edit input image 0 into a single photorealistic, front-facing formal studio ID portrait of the SAME person shown in the reference photo.

IDENTITY: Use the uploaded image for the person's face and identity. Keep their recognizable facial features, age, skin tone, face shape, jaw, eyes, nose, mouth, ears, hairline and hairstyle as faithful as possible. Do not beautify, change ethnicity, replace the person or invent different facial features. Preserve natural realistic skin texture.

RECOMPOSE POSE COMPLETELY: The person must be sitting or standing upright, facing directly forward toward the camera. Head straight and level, eyes looking into the lens. Torso squarely facing the camera. Both shoulders level, symmetrical, fully visible, and facing forward. Eliminate selfie perspective, tilted or rotated body, reaching or extended arm, hand close to camera, and any hands or objects in the frame. Do not carry over the original selfie pose or body orientation. Create a standard straight-on formal ID-photo composition.

MANDATORY CLOTHING: {OUTFIT_DESCRIPTION}

PORTRAIT FRAMING: One person only. Centered head and upper torso, with modest space above the hair. Head occupies about 40% of the frame height, cropped at approximately mid-chest. Symmetrical 2-by-2-inch ID portrait aesthetic. Solid clean WHITE background, with no objects or scenery. Diffuse even soft frontal studio light without dramatic shadows. Natural neutral professional expression, closed mouth, no exaggerated smiling.

OUTPUT: Realistic high-resolution photographic portrait, straight-on eye-level camera, sharp face, natural proportions. No raised arms, hands, tilted shoulders, selfies, accessories, text, logos, watermarks, frames, illustration, or composite-looking cutouts.

Important: PRIORITIZE the specified formal outfit and straight-on ID-photo format over maintaining the reference body's position or clothing. Use the reference for facial identity, not for posing.`

const OUTFITS = {
  male: "A realistic, properly fitted plain BLACK business suit jacket over a crisp WHITE formal dress shirt, with a centered solid BLACK NECKTIE and visible knot. Show jacket lapels, shirt collar, tie and both shoulders. No casual clothing, no open collar, no missing tie.",
  female: "A realistic, properly fitted plain BLACK tailored WOMEN'S blazer with clean lapels, over a crisp WHITE formal collared blouse, open at the neck WITHOUT any necktie, matching a classic women's professional ID portrait. Show both shoulders and upper chest. No jewelry, no revealing clothing, no casual shirt. Do not masculinize the subject or alter their facial identity.",
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

const VISITOR_LIMIT = 10
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
    const globalLimit = Math.max(1, Math.min(100, Number(env.GLOBAL_DAILY_LIMIT || 50)))
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
      const modelChoice = String(form.get('model') || DEFAULT_MODEL)
      const outfit = String(form.get('outfit') || 'male')
      if (!(photo instanceof File) || !['image/jpeg','image/png'].includes(photo.type) || photo.size > 1_000_000 || !photo.size) return json('Please upload a JPG or PNG under 1 MB.',400,headers)
      if (!Object.hasOwn(MODELS, modelChoice)) return json('Invalid AI model.',400,headers)
      if (!Object.hasOwn(OUTFITS, outfit)) return json('Invalid outfit selection.',400,headers)
      if (!await checkTurnstile(request, env, String(form.get('turnstileToken') || ''))) return json('Human verification required. Complete the Turnstile challenge and retry.',403,headers)

      // Count even failed requests as attempts to prevent repeated costly failures.
      const attempts = await usage(env,`${visitorKey}:attempts`,'reserve',24)
      if (!attempts.allowed) return json('Too many generation attempts today. Try again after midnight UTC.',429,headers)
      const global = await usage(env,globalKey,'reserve',globalLimit)
      if (!global.allowed) return json('The studio daily AI budget is exhausted. Manual editing and PDF downloads are still available. Try tomorrow (UTC).',429,headers)
      globalReserved = true
      const personal = await usage(env,visitorKey,'reserve',VISITOR_LIMIT)
      if (!personal.allowed) return json('Daily limit reached: 10 generations per visitor. You can edit and download existing photos, or return tomorrow (UTC).',429,headers)
      visitorReserved = true

      // The caller can select only these two server-defined outfits.
      const prompt = FORMAL_PORTRAIT_PROMPT.replace('{OUTFIT_DESCRIPTION}', OUTFITS[outfit])
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
