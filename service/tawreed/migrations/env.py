from alembic import context

from tawreed.core.db import Base
from tawreed.projects import Project  # noqa: F401  (registers the tables on Base.metadata)
from tawreed.sources import Source  # noqa: F401

connection = context.config.attributes["connection"]
context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)

with context.begin_transaction():
    context.run_migrations()
