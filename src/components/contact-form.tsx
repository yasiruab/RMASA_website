"use client";

import { FormEvent, useMemo, useState } from "react";

type FormStatus = "idle" | "submitting" | "success" | "error";

type ContactFormValues = {
  name: string;
  phone: string;
  email: string;
  message: string;
  consent: boolean;
};

type ContactFormProps = {
  initialMessage?: string;
};

const emailRegex = /^\S+@\S+\.\S+$/;
const phoneRegex = /^[0-9+\-\s()]{7,20}$/;

function validateField(field: keyof ContactFormValues, values: ContactFormValues) {
  switch (field) {
    case "name":
      if (!values.name.trim()) return "Name is required.";
      if (values.name.trim().length < 2) return "Name must be at least 2 characters.";
      return "";
    case "phone":
      if (!values.phone.trim()) return "Contact number is required.";
      if (!phoneRegex.test(values.phone.trim())) return "Enter a valid contact number.";
      return "";
    case "email":
      if (!values.email.trim()) return "Email is required.";
      if (!emailRegex.test(values.email.trim())) return "Enter a valid email address.";
      return "";
    case "message":
      if (!values.message.trim()) return "Message is required.";
      if (values.message.trim().length < 10) return "Message should be at least 10 characters.";
      return "";
    case "consent":
      if (!values.consent) return "Please agree to the privacy policy.";
      return "";
    default:
      return "";
  }
}

function buildErrors(values: ContactFormValues) {
  return {
    name: validateField("name", values),
    phone: validateField("phone", values),
    email: validateField("email", values),
    message: validateField("message", values),
    consent: validateField("consent", values),
  };
}

export function ContactForm({ initialMessage = "" }: ContactFormProps) {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");
  const [values, setValues] = useState<ContactFormValues>({
    name: "",
    phone: "",
    email: "",
    message: initialMessage,
    consent: false,
  });
  const [touched, setTouched] = useState<Record<keyof ContactFormValues, boolean>>({
    name: false,
    phone: false,
    email: false,
    message: false,
    consent: false,
  });

  const errors = useMemo(() => buildErrors(values), [values]);
  const hasErrors = Object.values(errors).some(Boolean);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({
      name: true,
      phone: true,
      email: true,
      message: true,
      consent: true,
    });
    setMessage("");

    if (hasErrors) {
      setStatus("error");
      setMessage("Please correct the highlighted fields and try again.");
      return;
    }

    setStatus("submitting");

    const payload = {
      name: values.name.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      message: values.message.trim(),
      consent: values.consent,
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
      setValues({
        name: "",
        phone: "",
        email: "",
        message: initialMessage,
        consent: false,
      });
      setTouched({
        name: false,
        phone: false,
        email: false,
        message: false,
        consent: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Submission failed.";
      setStatus("error");
      setMessage(errorMessage);
    }
  }

  function onFieldBlur(field: keyof ContactFormValues) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function onFieldChange(field: keyof ContactFormValues, next: string | boolean) {
    setValues((current) => ({ ...current, [field]: next }));
  }

  return (
    <form className="contact-form" onSubmit={onSubmit}>
      <label>
        Name
        <input
          aria-describedby={touched.name && errors.name ? "name-error" : undefined}
          aria-invalid={Boolean(touched.name && errors.name)}
          name="name"
          onBlur={() => onFieldBlur("name")}
          onChange={(event) => onFieldChange("name", event.target.value)}
          required
          type="text"
          value={values.name}
        />
        {touched.name && errors.name ? (
          <p className="field-error" id="name-error">
            {errors.name}
          </p>
        ) : null}
      </label>
      <label>
        Contact Number
        <input
          aria-describedby={touched.phone && errors.phone ? "phone-error" : undefined}
          aria-invalid={Boolean(touched.phone && errors.phone)}
          name="phone"
          onBlur={() => onFieldBlur("phone")}
          onChange={(event) => onFieldChange("phone", event.target.value)}
          required
          type="tel"
          value={values.phone}
        />
        {touched.phone && errors.phone ? (
          <p className="field-error" id="phone-error">
            {errors.phone}
          </p>
        ) : null}
      </label>
      <label>
        Email
        <input
          aria-describedby={touched.email && errors.email ? "email-error" : undefined}
          aria-invalid={Boolean(touched.email && errors.email)}
          name="email"
          onBlur={() => onFieldBlur("email")}
          onChange={(event) => onFieldChange("email", event.target.value)}
          required
          type="email"
          value={values.email}
        />
        {touched.email && errors.email ? (
          <p className="field-error" id="email-error">
            {errors.email}
          </p>
        ) : null}
      </label>
      <label>
        Message
        <textarea
          aria-describedby={touched.message && errors.message ? "message-error" : undefined}
          aria-invalid={Boolean(touched.message && errors.message)}
          name="message"
          onBlur={() => onFieldBlur("message")}
          onChange={(event) => onFieldChange("message", event.target.value)}
          required
          rows={5}
          value={values.message}
        />
        {touched.message && errors.message ? (
          <p className="field-error" id="message-error">
            {errors.message}
          </p>
        ) : null}
      </label>
      <label className="consent">
        <input
          aria-describedby={touched.consent && errors.consent ? "consent-error" : undefined}
          aria-invalid={Boolean(touched.consent && errors.consent)}
          checked={values.consent}
          name="consent"
          onBlur={() => onFieldBlur("consent")}
          onChange={(event) => onFieldChange("consent", event.target.checked)}
          required
          type="checkbox"
        />
        I agree to the privacy policy.
      </label>
      {touched.consent && errors.consent ? (
        <p className="field-error" id="consent-error">
          {errors.consent}
        </p>
      ) : null}
      <button className="btn btn-primary" disabled={status === "submitting"} type="submit">
        {status === "submitting" ? "Sending enquiry..." : "Send Enquiry"}
      </button>
      {message ? (
        <p aria-live="polite" className={`form-message ${status}`} role={status === "error" ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
