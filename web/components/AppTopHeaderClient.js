"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

function getDisplayName(userName, userEmail) {
  const name = String(userName || "").trim();
  if (name) {
    return name;
  }
  const email = String(userEmail || "").trim();
  if (!email) {
    return "User";
  }
  return email.split("@")[0] || "User";
}

function getInitials(displayName) {
  const parts = displayName.split(" ").filter(Boolean);
  if (!parts.length) {
    return "U";
  }
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return `${first}${second}`.toUpperCase();
}

function DownArrowIcon({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 text-[#a9c3e7] transition ${open ? "rotate-180" : ""}`}
      fill="none"
      aria-hidden="true"
    >
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AppTopHeaderClient({
  userName = "",
  userEmail = "",
  userImage = ""
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dropdownRef = useRef(null);
  const [open, setOpen] = useState(false);

  const displayName = getDisplayName(userName, userEmail);
  const initials = getInitials(displayName);

  const navItems = useMemo(() => {
    const items = [
      { label: "Nifty Contribution", path: "/nifty-contribution" },
      { label: "Community", path: "/community" },
      { label: "Videos", path: "/videos" }
    ];

    return items;
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onClickOutside = (event) => {
      if (!dropdownRef.current) {
        return;
      }
      if (!dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const onEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const goToPage = (path) => {
    setOpen(false);
    if (pathname !== path) {
      router.push(path);
    }
  };

  return (
    <header className="mb-[50px] w-full">
      <div className="w-full border-b border-white/[0.07] px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => goToPage("/nifty-contribution")}
            className="inline-flex items-center px-0.5 py-0.5 transition hover:opacity-95"
            aria-label="Go to Nifty Contribution"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/images/logo/logo_b.png"
              alt="Tradestrom"
              className="h-7 w-auto object-contain"
            />
          </button>

          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="inline-flex items-center gap-2.5 px-1 py-1 transition hover:opacity-95"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              {userImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userImage}
                  alt={displayName}
                  className="h-8 w-8 rounded-full object-cover ring-1 ring-white/[0.18]"
                />
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1d3d66]/70 text-xs font-semibold text-[#dce9ff] ring-1 ring-white/[0.18]">
                  {initials}
                </span>
              )}

              <span className="max-w-[180px] truncate text-sm font-semibold text-[#e6f0ff]">
                {displayName}
              </span>
              <DownArrowIcon open={open} />
            </button>

            {open ? (
              <div
                className="absolute right-0 z-[1000] mt-2 w-64 rounded-xl bg-[#071427]/95 p-2 shadow-[0_24px_55px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.12]"
                role="menu"
              >
                <div className="mb-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#89a7cc]">
                  Navigation
                </div>

                <div className="max-h-56 overflow-y-auto">
                  {navItems.map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => goToPage(item.path)}
                      className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                        pathname === item.path
                          ? "bg-[#1a4d96]/90 text-white"
                          : "text-[#c2d6f2] hover:bg-white/[0.06]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="mt-1 border-t border-white/[0.1] pt-2">
                  <button
                    type="button"
                    onClick={() => goToPage("/admin")}
                    className="mb-1 w-full rounded-lg bg-[#1d5fbe] px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-[#2a73de]"
                  >
                    Admin Dashboard
                  </button>

                  <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="w-full rounded-lg bg-rose-500/20 px-3 py-2 text-left text-sm font-semibold text-rose-200 transition hover:bg-rose-500/30"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
