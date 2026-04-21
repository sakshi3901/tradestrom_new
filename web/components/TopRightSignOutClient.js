"use client";

import { usePathname } from "next/navigation";
import SignOutButton from "@/components/SignOutButton";

export default function TopRightSignOutClient() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/nifty-contribution") {
    return null;
  }

  return (
    <header className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      <div className="flex justify-end">
        <SignOutButton className="bg-white/90 shadow-sm backdrop-blur" />
      </div>
    </header>
  );
}
