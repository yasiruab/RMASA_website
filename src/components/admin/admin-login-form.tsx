"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

type AdminLoginFormProps = {
  nextPath: string;
};

export function AdminLoginForm({ nextPath }: AdminLoginFormProps) {
  const [submitting, setSubmitting] = useState(false);

  function onClick() {
    setSubmitting(true);
    void signIn("cognito", { callbackUrl: nextPath });
  }

  return (
    <div className="admin-login-form">
      <p className="admin-login-intro">
        You&rsquo;ll be redirected to a secure AWS Cognito sign-in page. After your password,
        Cognito will email you a 6-digit verification code to complete sign-in.
      </p>
      <button
        className="btn btn-primary"
        disabled={submitting}
        onClick={onClick}
        type="button"
      >
        {submitting ? "Redirecting…" : "Sign in"}
      </button>
    </div>
  );
}
