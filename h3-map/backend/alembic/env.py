import os

from alembic import context
from sqlalchemy import create_engine, pool

from app.db.app_models import SCHEMA, Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    url = config.get_main_option("sqlalchemy.url") or os.environ.get("H3MAP_APP_DATABASE_URL", "")
    if not url:
        raise SystemExit("Set H3MAP_APP_DATABASE_URL (postgresql+psycopg://user:password@host/db)")
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


def run() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, include_schemas=True,
                          version_table_schema=SCHEMA)
        with context.begin_transaction():
            conn.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
            context.run_migrations()


run()
