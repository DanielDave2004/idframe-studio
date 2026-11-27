# Face validation assets

`npm run dev` and `npm run build` automatically run `scripts/prepare-face-assets.mjs`.
It copies the exact `@mediapipe/tasks-vision` WASM runtime from `node_modules`
and downloads the official Google BlazeFace short-range FP16 model into
`public/models/mediapipe`. It verifies the model's SHA-256 before use.

These generated binary assets are served by Cloudflare Pages from the site's
own domain, which should reduce cross-origin blocking by Brave. They are
intentionally not committed to the source ZIP. The deployment/build server
needs Internet access **once** on the first build (later builds can reuse the
verified model if it remains on disk). A missing or corrupt model aborts the
build rather than silently permitting generation without face validation.

If a legitimate portrait is still rejected, distinguish between:
- **Face verification could not start:** model or WASM file failed to load;
  check browser DevTools Network for `/models/mediapipe/` requests.
- **No face detected:** the model ran but found no face; try a clearer,
  closer, forward-facing portrait with good lighting.

This validates the presence of a detectable face, not the person's identity.
