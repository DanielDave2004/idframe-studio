import os

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 18_000_000
ALLOWED_ORIGINS = [v.strip() for v in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",") if v.strip()]
