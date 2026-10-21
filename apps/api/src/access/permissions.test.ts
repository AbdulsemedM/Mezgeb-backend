import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_PERMISSIONS,
  accountAllows,
  type AccountRole,
  MERCHANT_PERMISSIONS,
  merchantAllows,
  type MerchantRole,
} from './permissions.js';

/**
 * The spec's roles table (application-spec "Roles and permissions") + ADR-003 + ADR-006,
 * typed in independently of permissions.ts. O = owner, S = staff, C = customer.
 */
const EXPECTED_ACCOUNT: Record<string, string> = {
  // "Onboard customer, set nickname": owner yes, staff yes, customer no
  set_nickname: 'OS',
  // "Record purchase entry": owner yes, staff yes
  record_purchase: 'OS',
  // "Record correction": owner yes, staff request only, customer dispute only
  record_correction: 'O',
  request_correction: 'S',
  dispute_entry: 'C',
  // "See all balances and totals": owner yes, staff no, customer own account only
  view_balance: 'OC',
  view_statement: 'OC',
  // "Set merchant-side limits" / "Set customer-side limits"
  set_merchant_limit: 'O',
  set_customer_limit: 'C',
  // "Add or revoke representatives": customer only; the picker is visible to the shop
  manage_representatives: 'C',
  view_representatives: 'OSC',
  // "Send pay-me request": owner; "Report payment": customer; "Confirm or reject": owner
  send_payme: 'O',
  report_payment: 'C',
  review_payment: 'O',
  // ADR-006: recording cash received posts as confirmed → owner only
  record_payment: 'O',
  // "Send delivery order": customer; "Accept and deliver order": owner, staff
  send_order: 'C',
  handle_order: 'OS',
  // "Change record detail mode": owner (shop/customer default), customer (own view)
  set_customer_detail_mode: 'O',
  set_view_preference: 'C',
  // ONB-4: the customer accepts the terms
  accept_terms: 'C',
  // Everyone on the account sees it; ADR-006: staff see entries, not balances
  view_account: 'OSC',
  view_entries: 'OSC',
};

const EXPECTED_MERCHANT: Record<string, string> = {
  // "Onboard customer": owner, staff
  create_account: 'OS',
  // ADR-003: staff cannot manage staff; detail-mode shop default is the owner's
  manage_staff: 'O',
  update_shop: 'O',
  view_merchant: 'OS',
};

const LETTER: Record<string, string> = { owner: 'O', staff: 'S', customer: 'C' };

describe('permission table', () => {
  it('covers exactly the expected account actions', () => {
    expect(Object.keys(ACCOUNT_PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED_ACCOUNT).sort());
  });

  it('covers exactly the expected shop actions', () => {
    expect(Object.keys(MERCHANT_PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED_MERCHANT).sort());
  });

  const accountCases = Object.entries(EXPECTED_ACCOUNT).flatMap(([action, who]) =>
    (['owner', 'staff', 'customer'] as AccountRole[]).map((role) => ({
      action,
      role,
      allowed: who.includes(LETTER[role]!),
    })),
  );

  it.each(accountCases)('$role → $action: $allowed', ({ action, role, allowed }) => {
    expect(accountAllows(role, action as keyof typeof ACCOUNT_PERMISSIONS)).toBe(allowed);
  });

  const merchantCases = Object.entries(EXPECTED_MERCHANT).flatMap(([action, who]) =>
    (['owner', 'staff'] as MerchantRole[]).map((role) => ({
      action,
      role,
      allowed: who.includes(LETTER[role]!),
    })),
  );

  it.each(merchantCases)('shop $role → $action: $allowed', ({ action, role, allowed }) => {
    expect(merchantAllows(role, action as keyof typeof MERCHANT_PERMISSIONS)).toBe(allowed);
  });
});
