# ADR-002 — Client applications

Status: accepted · Date: 2026-10-21

- **One Flutter app** (`apps/mobile`) for both merchants and customers. A person may own a shop
  and also be a customer of other shops. Home has a "My shop / My dube" switch; permissions come
  from the role on each account.
- **Customer PWA** (`apps/web`) for the no-install invite link: React, lightweight, must work on
  3G. Customer features only. No merchant features.
- The separate native customer app in the original spec is dropped.
- Build order: backend → Flutter → PWA.
