"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

type AdminLoginFormProps = {
  nextPath: string;
};

export function AdminLoginForm({ nextPath }: AdminLoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: nextPath,
    });

    if (!result || result.error) {
      setErrorMessage(
        `Sign-in failed${result?.error ? ` (${result.error})` : ""}.`,
      );
      setSubmitting(false);
      return;
    }

    window.location.href = result.url ?? nextPath;
  }

  return (
    <form className="contact-form admin-login-form" onSubmit={onSubmit}>
      <label>
        Email
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button className="btn btn-primary" disabled={submitting} type="submit">
        {submitting ? "Signing in..." : "Sign In"}
      </button>
      {errorMessage ? <p className="form-message error">{errorMessage}</p> : null}
    </form>
  );
}
