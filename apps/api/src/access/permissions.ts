/**
 * Who may do what (spec "Roles and permissions" + ADR-003 + ADR-006). Roles are per account
 * or per shop, never global (CLAUDE.md rule 7). Representatives have no app and no role here.
 */
export type AccountRole = 'owner' | 'staff' | 'customer';
export type MerchantRole = 'owner' | 'staff';

export const ACCOUNT_PERMISSIONS = {
  view_account: ['owner', 'staff', 'customer'],
  /** ADR-003: staff cannot see balances or totals. */
  view_balance: ['owner', 'customer'],
  /** ADR-006: staff see entries so they can request corrections. */
  view_entries: ['owner', 'staff', 'customer'],
  view_statement: ['owner', 'customer'],
  set_nickname: ['owner', 'staff'],
  record_purchase: ['owner', 'staff'],
  record_correction: ['owner'],
  request_correction: ['staff'],
  dispute_entry: ['customer'],
  set_merchant_limit: ['owner'],
  set_customer_limit: ['customer'],
  /** The merchant's picker needs the active representatives (REP-4). */
  view_representatives: ['owner', 'staff', 'customer'],
  manage_representatives: ['customer'],
  send_payme: ['owner'],
  report_payment: ['customer'],
  review_payment: ['owner'],
  /** ADR-006: cash at the counter posts as confirmed, so owner-only. */
  record_payment: ['owner'],
  send_order: ['customer'],
  handle_order: ['owner', 'staff'],
  set_customer_detail_mode: ['owner'],
  set_view_preference: ['customer'],
  accept_terms: ['customer'],
} as const satisfies Record<string, readonly AccountRole[]>;

export const MERCHANT_PERMISSIONS = {
  view_merchant: ['owner', 'staff'],
  update_shop: ['owner'],
  manage_staff: ['owner'],
  create_account: ['owner', 'staff'],
} as const satisfies Record<string, readonly MerchantRole[]>;

export type AccountAction = keyof typeof ACCOUNT_PERMISSIONS;
export type MerchantAction = keyof typeof MERCHANT_PERMISSIONS;

export function accountAllows(role: AccountRole, action: AccountAction): boolean {
  return (ACCOUNT_PERMISSIONS[action] as readonly AccountRole[]).includes(role);
}

export function merchantAllows(role: MerchantRole, action: MerchantAction): boolean {
  return (MERCHANT_PERMISSIONS[action] as readonly MerchantRole[]).includes(role);
}
