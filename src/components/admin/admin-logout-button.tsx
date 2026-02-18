"use client";

import { signOut } from "next-auth/react";

export function AdminLogoutButton() {
  return (
    <button
      className="btn btn-secondary"
      onClick={() => void signOut({ callbackUrl: "/admin/login" })}
      type="button"
    >
      Sign Out
    </button>
  );
}
