from alembic import context

from tawreed.core.db import Base
from tawreed.decisions import Decision  # noqa: F401
from tawreed.ledger import Item, Layout  # noqa: F401
from tawreed.packages import Assignment, Package, Rule  # noqa: F401
from tawreed.projects import Consent, Project  # noqa: F401
from tawreed.publish import Revision  # noqa: F401
from tawreed.sources import Source, SourcePage  # noqa: F401
from tawreed.workflow.records import StepRecord  # noqa: F401  (registers the tables on Base.metadata)

connection = context.config.attributes["connection"]
context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)

with context.begin_transaction():
    context.run_migrations()
