"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";
import { isClarityExcludedPath } from "@/lib/clarity-scope";

const CLARITY_PROJECT_ID = "wrxgldd8t5";

declare global {
  interface Window {
    clarity?: (command: string, ...args: unknown[]) => void;
  }
}

// Microsoft Clarity session recording for the public site only. Admin pages
// render customer names, emails, phones and payments as plain text, which
// Clarity's default masking does not hide — so the script is never loaded on
// /admin, and if a session started on a public page then navigates into the
// admin client-side, recording is stopped (and resumed on the way out).
export function ClarityAnalytics() {
  const pathname = usePathname() ?? "";
  const excluded = isClarityExcludedPath(pathname);

  useEffect(() => {
    if (!window.clarity) return;
    window.clarity(excluded ? "stop" : "start");
  }, [excluded]);

  if (excluded) return null;

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
    </Script>
  );
}
