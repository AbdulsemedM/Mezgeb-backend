-- ADR-014: delivery orders sync to the shop (owner and staff) and the customer (ADR-010).
CREATE TRIGGER change_delivery_order AFTER INSERT OR UPDATE ON delivery_order
  FOR EACH ROW EXECUTE FUNCTION mezgeb_change_account_scoped('delivery_order');
