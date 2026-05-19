"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AdminSessionValue = {
  userId: string;
  email: string | null;
  role: "admin" | "super_admin";
  isSuperAdmin: boolean;
};

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

// Provider mounted from the admin layout. Each page reads identity + role via
// useAdminSession() without re-calling getServerSession in client code.
export function AdminSessionProvider({
  value,
  children,
}: {
  value: AdminSessionValue;
  children: ReactNode;
}) {
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) {
    throw new Error("useAdminSession must be called inside <AdminSessionProvider>");
  }
  return ctx;
}
