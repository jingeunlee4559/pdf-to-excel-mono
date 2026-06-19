from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.services.llm_client import llm_status

app = FastAPI(title="Document Automation AI Server Lite", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True, "service": "ai-server-lite", "ocr": False, "llm": llm_status()}

app.include_router(router, prefix="/api")
