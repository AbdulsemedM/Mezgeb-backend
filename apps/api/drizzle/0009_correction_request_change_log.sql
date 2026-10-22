-- ADR-012: correction requests sync to the shop's phones (ADR-010). The pull sends them to
-- owner and staff only, never to the customer.
CREATE OR REPLACE FUNCTION mezgeb_change_correction_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid := (SELECT account_id FROM entry WHERE id = NEW.entry_id);
BEGIN
  PERFORM mezgeb_log_change(
    (SELECT merchant_id FROM account WHERE id = v_account),
    v_account, 'correction_request', NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_correction_request AFTER INSERT OR UPDATE ON correction_request
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_correction_request();
