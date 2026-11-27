from fastapi import APIRouter, File, UploadFile, HTTPException, Form
from fastapi.responses import Response
from app.services.images import read_image, analyze, polish

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
