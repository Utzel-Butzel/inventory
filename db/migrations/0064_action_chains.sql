ALTER TABLE stock_scan_workflows
  ADD COLUMN actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN once_per_code boolean NOT NULL DEFAULT false;
ALTER TABLE stock_scan_workflows ADD CONSTRAINT stock_scan_workflows_actions_array CHECK (jsonb_typeof(actions) = 'array');
ALTER TABLE stock_scan_executions ADD COLUMN deduplication_key varchar(64);
CREATE UNIQUE INDEX stock_scan_executions_deduplication_unique ON stock_scan_executions (organization_id, deduplication_key) WHERE deduplication_key IS NOT NULL;
