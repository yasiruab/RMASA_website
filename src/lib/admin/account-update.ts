// Validation for PATCH /api/admin/accounts/[id]. Pure (no runtime `@/` imports)
// so `npm test` can load it.
//
// Before this, `role` went to Prisma unchecked: an unknown value surfaced as a
// Prisma enum error (500) instead of a 400, and a non-boolean `active` could
// slip past the "removes super-admin capability" check.

export type AdminRole = "admin" | "super_admin";

export type AccountUpdate = {
  role?: AdminRole;
  active?: boolean;
  name?: string;
};

export const MAX_ACCOUNT_NAME_LEN = 100;

export type AccountUpdateResult = { ok: true; update: AccountUpdate } | { ok: false; message: string };

export function parseAccountUpdate(payload: unknown): AccountUpdateResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const { role, active, name } = payload as Record<string, unknown>;
  const update: AccountUpdate = {};

  if (role !== undefined) {
    if (role !== "admin" && role !== "super_admin") {
      return { ok: false, message: "role must be admin or super_admin." };
    }
    update.role = role;
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") return { ok: false, message: "active must be true or false." };
    update.active = active;
  }
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length > MAX_ACCOUNT_NAME_LEN) {
      return { ok: false, message: `name must be text of at most ${MAX_ACCOUNT_NAME_LEN} characters.` };
    }
    update.name = name.trim();
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, message: "Nothing to update." };
  }
  return { ok: true, update };
}
