import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.gemini_extractor import extract_product_fields
from app.rule_engine import evaluate_compliance

from app.database import SessionLocal


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
load_dotenv(BACKEND_ROOT / ".env")

UPLOADS_DIR = PROJECT_ROOT / "uploads"
OCR_SCRIPT = BACKEND_ROOT / "test_ocr.py"
configured_ocr_python = os.getenv("OCR_PYTHON")
OCR_PYTHON = Path(configured_ocr_python) if configured_ocr_python else Path(sys.executable)
if not OCR_PYTHON.is_absolute():
    OCR_PYTHON = BACKEND_ROOT / OCR_PYTHON
OCR_TIMEOUT_SECONDS = 180

app = FastAPI(title="Legal Metrology Compliance System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://legal-metrology-orcin.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "Legal Metrology backend is running"}


def extract_json(stdout: str) -> dict:
    """Extract the final JSON object after PaddleOCR's diagnostic output."""
    decoder = json.JSONDecoder()
    for index in range(len(stdout) - 1, -1, -1):
        if stdout[index] != "{":
            continue
        try:
            value, _ = decoder.raw_decode(stdout[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and "success" in value:
            return value
    raise ValueError("OCR process did not return a valid JSON result")


async def _save_uploaded_image(file: UploadFile) -> Path:
    if not file.filename:
        raise HTTPException(status_code=400, detail="An image file is required")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="The uploaded file must be an image")

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix.lower() or ".img"
    with tempfile.NamedTemporaryFile(
        mode="wb",
        suffix=suffix,
        prefix="ocr_",
        dir=UPLOADS_DIR,
        delete=False,
    ) as saved_file:
        temporary_path = Path(saved_file.name)
        while chunk := await file.read(1024 * 1024):
            saved_file.write(chunk)
    return temporary_path


def _run_ocr(image_path: Path) -> dict:
    try:
        process = subprocess.run(
            [str(OCR_PYTHON), str(OCR_SCRIPT), str(image_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=OCR_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise HTTPException(status_code=504, detail="OCR process timed out") from error
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Could not run OCR: {error}") from error

    if process.returncode != 0:
        detail = process.stderr.strip() or process.stdout.strip()
        raise HTTPException(
            status_code=502,
            detail=f"OCR process failed: {detail[-2000:]}",
        )

    try:
        result = extract_json(process.stdout)
    except ValueError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "OCR failed"))
    return result


def _combine_ocr_text(ocr_result: dict) -> str:
    return "\n".join(
        str(line.get("text", ""))
        for line in ocr_result.get("text", [])
        if isinstance(line, dict) and line.get("text")
    )


@app.post("/ocr")
async def run_ocr(file: UploadFile = File(...)):
    temporary_path = None

    try:
        temporary_path = await _save_uploaded_image(file)
        return _run_ocr(temporary_path)
    except HTTPException:
        raise
    finally:
        await file.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


@app.post("/extract")
async def extract_fields(file: UploadFile = File(...)):
    temporary_path = None

    try:
        temporary_path = await _save_uploaded_image(file)
        ocr_result = _run_ocr(temporary_path)
        ocr_lines = ocr_result.get("text", [])
        ocr_text = _combine_ocr_text(ocr_result)

        try:
            extracted = extract_product_fields(ocr_text)
        except Exception as error:
            raise HTTPException(
                status_code=502,
                detail=f"Gemini extraction failed: {error}",
            ) from error

        return {
            "success": True,
            "ocr": {"text": ocr_lines},
            "extracted": extracted.model_dump(),
        }
    except HTTPException:
        raise
    finally:
        await file.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


@app.post("/inspect")
async def inspect_product(file: UploadFile = File(...)):
    temporary_path = None

    try:
        temporary_path = await _save_uploaded_image(file)
        ocr_result = _run_ocr(temporary_path)
        ocr_text = _combine_ocr_text(ocr_result)

        try:
            product_fields = extract_product_fields(ocr_text)
        except Exception as error:
            raise HTTPException(
                status_code=502,
                detail=f"Gemini extraction failed: {error}",
            ) from error

        try:
            compliance = evaluate_compliance(product_fields)
        except Exception as error:
            raise HTTPException(
                status_code=500,
                detail=f"Compliance evaluation failed: {error}",
            ) from error

        return {
            "success": True,
            "ocr": ocr_result,
            "product": product_fields.model_dump(),
            "compliance": compliance,
        }
    except HTTPException:
        raise
    finally:
        await file.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)



@app.get("/health/db")
def database_health_check() -> dict[str, bool | str]:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ok", "database": True}
    except SQLAlchemyError:
        return {"status": "unavailable", "database": False}
