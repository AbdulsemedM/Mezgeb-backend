import type { AccountRow, MerchantRow } from '../access/access.service.js';
import { accountAllows, type AccountRole } from '../access/permissions.js';
import type { appUser } from '../db/schema.js';

type UserRow = typeof appUser.$inferSelect;

/** Chain head; both sides keep it as a receipt (ADR-001). */
interface Head {
  seq: number;
  hash: string;
}

export interface MerchantSideAccountView {
  id: string;
  merchant_id: string;
  status: AccountRow['status'];
  nickname: string | null;
  location_note: string | null;
  customer: { id: string; phone: string; name: string | null };
  detail_mode: AccountRow['detailMode'];
  terms_accepted_at: string | null;
  created_at: string;
  head: Head;
  /** Owner only (ADR-003). */
  balance_santim?: number;
}

export interface CustomerSideAccountView {
  id: string;
  status: AccountRow['status'];
  shop: {
    id: string;
    name: string;
    sub_city: string | null;
    woreda: string | null;
    landmark: string | null;
  };
  customer_detail_view: AccountRow['customerDetailView'];
  terms_accepted_at: string | null;
  created_at: string;
  head: Head;
  balance_santim: number;
}

export type AccountView = MerchantSideAccountView | CustomerSideAccountView;

/**
 * The only place account rows become JSON. The customer side never contains the merchant's
 * private notes (nickname, location_note; CLAUDE.md rule 8, ADR-006).
 */
export function accountView(
  role: AccountRole,
  a: AccountRow,
  m: MerchantRow,
  customer: UserRow,
): AccountView {
  const head = { seq: a.lastSeq, hash: a.lastHash };
  if (role === 'customer') {
    return {
      id: a.id,
      status: a.status,
      shop: {
        id: m.id,
        name: m.shopName,
        sub_city: m.subCity,
        woreda: m.woreda,
        landmark: m.landmark,
      },
      customer_detail_view: a.customerDetailView,
      terms_accepted_at: a.termsAcceptedAt?.toISOString() ?? null,
      created_at: a.createdAt.toISOString(),
      head,
      balance_santim: a.balanceSantim,
    };
  }
  const view: MerchantSideAccountView = {
    id: a.id,
    merchant_id: a.merchantId,
    status: a.status,
    nickname: a.nickname,
    location_note: a.locationNote,
    customer: { id: customer.id, phone: customer.phone, name: customer.name },
    detail_mode: a.detailMode,
    terms_accepted_at: a.termsAcceptedAt?.toISOString() ?? null,
    created_at: a.createdAt.toISOString(),
    head,
  };
  if (accountAllows(role, 'view_balance')) view.balance_santim = a.balanceSantim;
  return view;
}
