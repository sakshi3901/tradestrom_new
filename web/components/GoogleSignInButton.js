"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function GoogleSignInButton({
  className = "",
  label = "Continue with Google"
}) {
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setPending(true);
    await signIn(
      "google",
      { callbackUrl: "/post-login" },
      { prompt: "select_account" }
    );
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={handleSignIn}
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-sea disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {pending ? "Redirecting..." : label}
    </button>
  );
}
