# Legal Metrology Compliance System

AI-assisted packaged commodity label inspection for Legal Metrology review.

## Overview

The system accepts one to three views of the same packaged product, extracts declarations from the images, and evaluates those declarations against a deterministic set of Legal Metrology checks. It presents PASS, FAIL, and REVIEW outcomes, detailed compliance findings, and a browser-generated PDF report.

## Problem Statement

Packaged commodity labels contain declarations that must be checked across multiple product surfaces. Manual review is time-consuming, inconsistent, and makes it difficult to connect an identified declaration with the relevant rule and evidence.

## Solution

The application combines Gemini Vision for image reading and structured extraction with a deterministic rule engine for compliance decisions. AI extracts what is visible; the rule engine applies the configured decision logic. These responsibilities remain separate so results can be reviewed and explained.

## Key Features

- Upload Front, Back, and optional Side label images
- Support for one-image use as well as multi-image inspection
- Combined Gemini Vision extraction across all uploaded views
- Structured product information display
- Deterministic PASS, FAIL, and REVIEW checks
- Compliance findings with evidence, explanation, and legal references
- Browser-side PDF report generation
- Optional image inclusion in the generated report
- Human verification guidance for REVIEW results and extracted declarations

## System Architecture

```text
User
  |
  v
Vercel-hosted Next.js frontend
  |  multipart/form-data: image (1-3 files)
  v
Render-hosted FastAPI backend
  |
  +--> Gemini Vision: image reading and structured extraction
  |
  +--> Deterministic Legal Metrology rule engine
  |
  v
PASS / FAIL / REVIEW response
  |
  +--> Findings shown in frontend
  +--> PDF generated in the browser

PostgreSQL / SQLAlchemy configuration exists in the backend database module.
Inspection-history persistence and history endpoints are not active in the
current reverted implementation.
```

## End-to-End Workflow

1. The user selects one to three product label images.
2. The frontend sends every selected image using the multipart field `image`.
3. FastAPI validates the uploads and passes all image parts to Gemini Vision.
4. Gemini combines the views and returns structured product fields.
5. The deterministic rule engine evaluates the extracted fields.
6. The frontend displays product information, compliance findings, and the overall result.
7. The user can download a PDF inspection report generated entirely in the browser.

## Compliance Engine

The rule engine does not make visual judgments. It receives the structured extraction and evaluates configured declaration fields such as product name, manufacturer or packer, net quantity, MRP, manufacturing date, expiry information, consumer care details, FSSAI number, country of origin, and batch number.

- `PASS`: the relevant value was detected.
- `FAIL`: a required value was not detected.
- `REVIEW`: applicability cannot be determined conclusively, such as country of origin for a product that may be domestic.

A result is not a substitute for official inspection. Human verification remains necessary where the extraction is uncertain or applicability requires context.

## Technology Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python, Uvicorn
- Vision and extraction: Google Gemini Vision through `google-genai`
- Compliance: deterministic Python rule engine
- Reports: `jspdf` and `jspdf-autotable` in the browser
- Database configuration: SQLAlchemy with PostgreSQL-compatible drivers
- Deployment: Vercel frontend and Render backend

## API Endpoints Currently Available

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Service status |
| `GET` | `/health` | Health check |
| `GET` | `/models` | Lists available Gemini models |
| `POST` | `/inspect` | Accepts one to three multipart image files under `image` and returns the inspection result |

The current revision does not expose `/inspections` history endpoints.

## Database / Inspection History

The backend contains SQLAlchemy database configuration and reads `DATABASE_URL` from the environment. The current reverted implementation does not create an inspection-history model, persist `/inspect` results, or expose history endpoints. PostgreSQL inspection history is therefore a future integration point for this revision, not an active deployed feature.

Uploaded image files are processed in memory and are not stored by the current application.

## Deployment

The intended deployment topology is:

- Frontend deployed on Vercel
- FastAPI backend deployed on Render
- Frontend `NEXT_PUBLIC_API_URL` points to the backend `/inspect` service
- Backend `GEMINI_API_KEY` is configured as a Render environment variable
- Secrets and database URLs are supplied through deployment environment settings, never committed to this repository

## Limitations

- Gemini extraction can be uncertain when text is blurred, obstructed, or poorly photographed.
- The rule engine evaluates extracted structured values and cannot confirm physical absence from a package.
- Legal applicability may require human context, especially for REVIEW results.
- The current revision has no active PostgreSQL inspection-history persistence or history API.
- The PDF report is generated locally in the browser and is not uploaded to the backend.
- No authentication or user-specific inspection access control is implemented.

## Future Scope

- Activate PostgreSQL inspection history and add history retrieval endpoints.
- Add authenticated user and organization access controls.
- Add stronger evidence traceability for each extracted field.
- Add versioned rule sets and configurable jurisdiction support.
- Add review workflows for inspectors and correction feedback for extraction.

## Running Locally

### Backend

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:GEMINI_API_KEY = "your-key"
$env:DATABASE_URL = "postgresql+psycopg://user:password@host:5432/database"
uvicorn app.main:app --reload
```

The backend is available at `http://127.0.0.1:8000`.

### Frontend

```powershell
cd frontend\my-app
npm install
```

Create `.env.local` with a local backend URL:

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Start the frontend:

```powershell
npm run dev
```

The Next.js application is typically available at `http://localhost:3000`.

## SIH Relevance / Key Design Principle

This project addresses a practical inspection workflow by reducing repetitive label-reading work while keeping compliance decisions deterministic and explainable. The key design principle is separation of concerns: Gemini Vision reads and structures label evidence, while the rule engine applies explicit Legal Metrology logic. Every result should remain auditable and subject to human verification.
