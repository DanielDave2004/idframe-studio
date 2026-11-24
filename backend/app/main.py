from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.core.config import ALLOWED_ORIGINS

app = FastAPI(title="IDFrame Image API", version="1.0.0", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

@app.get("/health")
def health():
    return {"ok": True, "service": "idframe-python-api"}

app.include_router(router)
