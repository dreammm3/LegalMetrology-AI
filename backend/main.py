"""FastAPI app implementing the prototype endpoints from API_CONTRACT.md.

Run:
    uvicorn main:app --reload --port 8000
"""
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from models.schemas import SessionCreateRequest
from services import quality, ocr, declarations, coverage as coverage_service
from services import rules_engine, evidence
from storage import db

app = FastAPI(title="Legal Metrology Inspection Intelligence Platform — Prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)


@app.post("/session")
def create_session(payload: SessionCreateRequest):
    session = db.create_session(
        inspector_id=payload.inspector_id,
        location=payload.location,
        category=payload.category,
        product_identifier=payload.product_identifier,
    )
    return {
        "session_id": session["session_id"],
        "status": session["status"],
        "created_at": session["created_at"],
    }


@app.post("/session/{session_id}/photo")
async def upload_photo(session_id: str, file: UploadFile, view_type: str = Form(...)):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    image_bytes = await file.read()
    q = quality.check_quality(image_bytes)
    image_id = db.new_id("img")
    image_hash = evidence.hash_bytes(image_bytes)

    # Save uploaded image file to uploads directory
    file_path = UPLOADS_DIR / f"{image_id}.jpg"
    with open(file_path, "wb") as f:
        f.write(image_bytes)

    image_url = f"/session/{session_id}/image/{image_id}"

    record = {
        "view_type": view_type,
        "quality": q,
        "ocr": None,
        "declarations": None,
        "hash": image_hash,
        "accepted": q["accepted"],
        "image_url": image_url,
    }

    if q["accepted"]:
        ocr_result = ocr.run_ocr(image_bytes)
        decl_result = declarations.extract_declarations(ocr_result["text"])
        record["ocr"] = ocr_result
        record["declarations"] = decl_result
        ocr_status = ocr_result["state"]
    else:
        ocr_status = "SKIPPED"

    db.add_image(session_id, image_id, record)

    return {
        "image_id": image_id,
        "accepted": q["accepted"],
        "retake_requested": q["retake_requested"],
        "reason": q["reason"],
        "quality_metrics": q["metrics"],
        "ocr_status": ocr_status,
        "image_url": image_url,
    }


@app.get("/session/{session_id}/image/{image_id}")
def get_session_image(session_id: str, image_id: str):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if image_id not in session.get("images", {}):
        raise HTTPException(404, "Image not found in session")
    file_path = UPLOADS_DIR / f"{image_id}.jpg"
    if not file_path.exists():
        raise HTTPException(404, "Image file not found on disk")
    return FileResponse(file_path, media_type="image/jpeg")


@app.post("/session/{session_id}/evaluate")
def evaluate_session(session_id: str):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    per_image_declarations = {
        image_id: rec["declarations"]
        for image_id, rec in session["images"].items()
        if rec["accepted"] and rec["declarations"]
    }

    if not per_image_declarations:
        raise HTTPException(400, "No accepted images with readable declarations yet — upload photos first.")

    cov_result = coverage_service.build_coverage(session["category"], per_image_declarations)
    coverage = cov_result["coverage"]
    missing = coverage_service.missing_evidence_list(coverage)

    measurements = []

    rule_result = rules_engine.evaluate_rules(session["category"], coverage, measurements)

    combined_hash = "sha256:" + "0" * 64
    for rec in session["images"].values():
        combined_hash = evidence.chain_hash(combined_hash, rec["hash"])

    evaluation = {
        "session_id": session_id,
        "coverage": coverage,
        "missing_evidence": missing,
        "measurements": measurements,
        "rule_version": rule_result["rule_version"],
        "findings": rule_result["findings"],
        "verdict": rule_result["verdict"],
        "verdict_reason": rule_result["verdict_reason"],
        "evidence_hash": combined_hash,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.save_evaluation(session_id, evaluation)
    return evaluation


@app.get("/session/{session_id}")
def get_session(session_id: str):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sessions")
def list_sessions():
    sessions = db.get_all_sessions()
    # Return a lightweight summary, not full image/OCR payloads
    return [
        {
            "session_id": s["session_id"],
            "product_identifier": s["product_identifier"],
            "category": s["category"],
            "created_at": s["created_at"],
            "image_count": len(s["images"]),
            "verdict": s["last_evaluation"]["verdict"] if s["last_evaluation"] else None,
        }
        for s in sessions
    ]