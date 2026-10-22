-- ADR-013: pay-me requests and payment reports sync to the shop's phones (and later the
-- customer's PWA) like the other account-scoped tables (ADR-010).
CREATE OR REPLACE FUNCTION mezgeb_change_account_scoped() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mezgeb_log_change(
    (SELECT merchant_id FROM account WHERE id = NEW.account_id),
    NEW.account_id, TG_ARGV[0], NEW.id::text, 'upsert');
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER change_payme_request AFTER INSERT OR UPDATE ON payme_request
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_account_scoped('payme_request');--> statement-breakpoint
CREATE TRIGGER change_payment_report AFTER INSERT OR UPDATE ON payment_report
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_account_scoped('payment_report');
