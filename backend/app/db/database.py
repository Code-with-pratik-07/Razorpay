from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine_options: dict[str, object] = {"connect_args": {"check_same_thread": False}} if db_url.startswith("sqlite") else {}
engine = create_engine(db_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.models import audit_event, communication_record, customer, payment_attempt, payment_case, recovery_policy, webhook_log  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Safe backward-compatible column migration for existing SQLite / Postgres tables
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            # payment_cases migrations
            for col_stmt in [
                "ALTER TABLE payment_cases ADD COLUMN selected_channel VARCHAR(30)",
                "ALTER TABLE payment_cases ADD COLUMN last_payment_method VARCHAR(30)",
                "ALTER TABLE customers ADD COLUMN preferred_channel VARCHAR(30)",
                "ALTER TABLE customers ADD COLUMN opted_out_channels VARCHAR(100)",
                "ALTER TABLE communication_records ADD COLUMN outcome VARCHAR(50) DEFAULT 'SENT'",
                "ALTER TABLE communication_records ADD COLUMN delivery_status VARCHAR(50) DEFAULT 'DELIVERED'",
                "ALTER TABLE communication_records ADD COLUMN recovery_attributed BOOLEAN DEFAULT 0",
            ]:
                try:
                    conn.execute(text(col_stmt))
                    conn.commit()
                except Exception:
                    pass
    except Exception:
        pass
