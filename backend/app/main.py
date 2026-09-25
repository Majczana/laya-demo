from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(
    title="LAYA Emoji Demo API",
    version="0.1.0",
    description="Local API used to compare LAYA choice and noul decisions.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Confirm that the API layer is running before loading the model."""

    return {
        "status": "ok",
        "phase": "environment-ready",
        "model": "not-loaded",
    }

