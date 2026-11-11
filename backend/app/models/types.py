from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

# JSONB on PostgreSQL, plain JSON elsewhere (SQLite is used by the unit tests).
JSONType = JSON().with_variant(JSONB(), "postgresql")
