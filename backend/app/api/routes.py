from fastapi import APIRouter, File, UploadFile, HTTPException, Form
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from app.services.images import read_image, analyze, polish, remove_background

router = APIRouter(prefix="/api")

@router.post("/analyze")
async def analyze_photo(photo: UploadFile = File(...)):
    image = await read_image(photo)
    return analyze(image)

@router.post("/enhance")
async def enhance_photo(photo: UploadFile = File(...), strength: float = Form(0.6)):
    if not 0.0 <= strength <= 1.0:
        raise HTTPException(422, "Strength must be between 0 and 1.")
    image = await read_image(photo)
    return Response(content=polish(image, strength), media_type="image/jpeg", headers={"Cache-Control":"no-store"})

@router.post("/remove-background")
async def remove_background_photo(photo: UploadFile = File(...)):
    """Remove background from an AI-generated photo and return transparent PNG."""
    image = await read_image(photo)
    try:
        png = await run_in_threadpool(remove_background, image)
    except (ImportError, ModuleNotFoundError) as exc:
        raise HTTPException(503, "Background removal is unavailable. Check the Python server dependencies.") from exc
    except Exception as exc:
        raise HTTPException(503, "Background removal could not finish on this server. Please try again later.") from exc
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})
