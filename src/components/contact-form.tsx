"use client";

import { FormEvent, useState } from "react";

type FormStatus = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    const payload = {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      consent: formData.get("consent") === "on",
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { message?: string };

      if (!res.ok) {
        throw new Error(data.message || "Failed to submit enquiry.");
      }

      setStatus("success");
      setMessage("Your enquiry has been submitted. The RMASA team will contact you soon.");
      form.reset();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Submission failed.";
      setStatus("error");
      setMessage(errorMessage);
    }
  }

  return (
    <form className="contact-form" onSubmit={onSubmit}>
      <label>
        Name
        <input name="name" type="text" required />
      </label>
      <label>
        Contact Number
        <input name="phone" type="tel" required />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Message
        <textarea name="message" rows={5} required />
      </label>
      <label className="consent">
        <input name="consent" type="checkbox" required />
        I agree to the privacy policy.
      </label>
      <button className="btn btn-primary" disabled={status === "submitting"} type="submit">
        {status === "submitting" ? "Sending..." : "Send Enquiry"}
      </button>
      {message ? <p className={`form-message ${status}`}>{message}</p> : null}
    </form>
  );
}
