"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton({ className = "" }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className={`rounded-xl border border-ink/25 px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink hover:text-white ${className}`}
    >
      Sign out
    </button>
  );
}
