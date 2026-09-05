import os
from datetime import datetime
from collections.abc import Generator

from dotenv import load_dotenv
from sqlalchemy import JSON, DateTime, Integer, String, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:jayant192007P@localhost:5432/legal_metrology",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Inspection(Base):
    __tablename__ = "inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    overall_status: Mapped[str] = mapped_column(String(32), nullable=False)
    product_name: Mapped[str | None] = mapped_column(String, nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String, nullable=True)
    packer: Mapped[str | None] = mapped_column(String, nullable=True)
    importer: Mapped[str | None] = mapped_column(String, nullable=True)
    net_quantity: Mapped[str | None] = mapped_column(String, nullable=True)
    mrp: Mapped[str | None] = mapped_column(String, nullable=True)
    batch_number: Mapped[str | None] = mapped_column(String, nullable=True)
    manufacturing_date: Mapped[str | None] = mapped_column(String, nullable=True)
    expiry_date: Mapped[str | None] = mapped_column(String, nullable=True)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    violation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    product_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    compliance_data: Mapped[dict] = mapped_column(JSON, nullable=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
