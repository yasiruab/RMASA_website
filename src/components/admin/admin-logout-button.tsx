"use client";

import { signOut } from "next-auth/react";

export function AdminLogoutButton() {
  async function onClick() {
    // Clear the NextAuth session cookie, then redirect through our
    // federated-logout endpoint so the Cognito session is also terminated.
    // Without this, clicking "Sign in" after sign-out would auto-complete the
    // OAuth flow using the still-valid Cognito session cookie.
    await signOut({ redirect: false });
    window.location.href = "/api/auth/federated-logout";
  }

  return (
    <button className="btn btn-secondary" onClick={onClick} type="button">
      Sign Out
    </button>
  );
}
