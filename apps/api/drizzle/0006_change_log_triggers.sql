-- M7, ADR-010: every change to a synced table writes a change_log row in the same transaction.
-- Services never write change_log themselves, so no route can forget to.

CREATE OR REPLACE FUNCTION mezgeb_log_change(
  p_merchant uuid, p_account uuid, p_type text, p_object text, p_op text
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO change_log (xid, merchant_id, account_id, object_type, object_id, op)
  VALUES (pg_current_xact_id()::text::bigint, p_merchant, p_account, p_type, p_object, p_op);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION mezgeb_change_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mezgeb_log_change(NEW.merchant_id, NEW.id, 'account', NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_account AFTER INSERT OR UPDATE ON account
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_account();--> statement-breakpoint

CREATE OR REPLACE FUNCTION mezgeb_change_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mezgeb_log_change(
    (SELECT merchant_id FROM account WHERE id = NEW.account_id),
    NEW.account_id, 'entry', NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_entry AFTER INSERT ON entry
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_entry();--> statement-breakpoint

CREATE OR REPLACE FUNCTION mezgeb_change_representative() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mezgeb_log_change(
    (SELECT merchant_id FROM account WHERE id = NEW.account_id),
    NEW.account_id, 'representative', NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_representative AFTER INSERT OR UPDATE ON representative
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_representative();--> statement-breakpoint

CREATE OR REPLACE FUNCTION mezgeb_change_dispute() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid := (SELECT account_id FROM entry WHERE id = NEW.entry_id);
BEGIN
  PERFORM mezgeb_log_change(
    (SELECT merchant_id FROM account WHERE id = v_account),
    v_account, 'dispute', NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_dispute AFTER INSERT OR UPDATE ON dispute
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_dispute();--> statement-breakpoint

-- Limits have a composite key; the object id is "<account_id>:<set_by>".
CREATE OR REPLACE FUNCTION mezgeb_change_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  v_side text := CASE WHEN TG_OP = 'DELETE' THEN OLD.set_by::text ELSE NEW.set_by::text END;
BEGIN
  PERFORM mezgeb_log_change(
    (SELECT merchant_id FROM account WHERE id = v_account),
    v_account, 'limit', v_account::text || ':' || v_side,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_limit AFTER INSERT OR UPDATE OR DELETE ON account_limit
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_limit();--> statement-breakpoint

CREATE OR REPLACE FUNCTION mezgeb_change_catalogue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mezgeb_log_change(NEW.merchant_id, NULL, 'catalogue', NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_catalogue AFTER INSERT OR UPDATE ON catalogue_item
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_catalogue();--> statement-breakpoint

-- A shop profile change also reaches every customer, whose account view shows the shop.
CREATE OR REPLACE FUNCTION mezgeb_change_merchant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mezgeb_log_change(NEW.id, NULL, 'merchant', NEW.id::text, 'upsert');
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO change_log (xid, merchant_id, account_id, object_type, object_id, op)
    SELECT pg_current_xact_id()::text::bigint, NEW.id, a.id, 'account', a.id::text, 'upsert'
    FROM account a WHERE a.merchant_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_merchant AFTER INSERT OR UPDATE ON merchant
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_merchant();--> statement-breakpoint

-- Staff joining or leaving changes the shop's staff list.
CREATE OR REPLACE FUNCTION mezgeb_change_staff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_merchant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.merchant_id ELSE NEW.merchant_id END;
BEGIN
  PERFORM mezgeb_log_change(v_merchant, NULL, 'merchant', v_merchant::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_staff AFTER INSERT OR UPDATE OR DELETE ON merchant_staff
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_staff();
