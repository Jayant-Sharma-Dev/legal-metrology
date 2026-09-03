from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal

app = FastAPI(title="Legal Metrology Backend")


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "Legal Metrology backend is running"}


@app.get("/health/db")
def database_health_check() -> dict[str, bool | str]:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ok", "database": True}
    except SQLAlchemyError:
        return {"status": "unavailable", "database": False}
