-- Defence in depth for CLAUDE.md rule 1: entry, entry_line and audit_log are append-only.
-- Corrections are new entries; nothing may UPDATE, DELETE or TRUNCATE these tables.
CREATE FUNCTION mezgeb_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mezgeb: % is append-only (% forbidden)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'MZ001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entry_append_only BEFORE UPDATE OR DELETE ON entry
  FOR EACH ROW EXECUTE FUNCTION mezgeb_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER entry_no_truncate BEFORE TRUNCATE ON entry
  FOR EACH STATEMENT EXECUTE FUNCTION mezgeb_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER entry_line_append_only BEFORE UPDATE OR DELETE ON entry_line
  FOR EACH ROW EXECUTE FUNCTION mezgeb_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER entry_line_no_truncate BEFORE TRUNCATE ON entry_line
  FOR EACH STATEMENT EXECUTE FUNCTION mezgeb_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION mezgeb_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION mezgeb_forbid_mutation();
