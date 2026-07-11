-- Enforces "at most one sync_run with status='running' at a time" at the
-- database level, closing a race condition in the application-level guard
-- (a check-then-create pattern is not atomic: two concurrent requests can
-- both pass the check before either has committed its row). A partial
-- unique index makes the second INSERT fail with a unique violation
-- instead, which the orchestrator now catches and turns into a 409.
CREATE UNIQUE INDEX "sync_run_single_active_idx" ON "sync_run" ((true)) WHERE "status" = 'running';
