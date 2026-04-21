"use client";

import { useEffect, useState, useTransition } from "react";
import { Toaster, toast } from "react-hot-toast";

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function StatusChip({ label, value }) {
  return (
    <div className="rounded-xl bg-[#0a1a31]/95 px-4 py-3 ring-1 ring-[#2b4d77]">
      <p className="text-[11px] uppercase tracking-[0.11em] text-[#8ea9cc]">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${value ? "text-emerald-300" : "text-rose-300"}`}>
        {value ? "Configured" : "Missing"}
      </p>
    </div>
  );
}

export default function AdminZerodhaSettingsClient() {
  const [status, setStatus] = useState({
    has_api_key: false,
    has_api_secret: false,
    has_access_token: false,
    updated_by: "",
    updated_at: ""
  });
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refreshStatus() {
    const response = await fetch("/api/admin/zerodha", {
      method: "GET",
      cache: "no-store"
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load Zerodha settings");
    }

    setStatus(payload || {});
  }

  useEffect(() => {
    startTransition(async () => {
      try {
        await refreshStatus();
      } catch (error) {
        toast.error(error.message || "Failed to load Zerodha settings");
      }
    });
  }, []);

  function submitSettings(event) {
    event.preventDefault();

    const payload = {
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      accessToken: accessToken.trim()
    };

    if (!payload.apiKey && !payload.apiSecret && !payload.accessToken) {
      toast.error("Enter at least one value");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/zerodha", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Failed to save settings");
        }

        setApiSecret("");
        setAccessToken("");
        if (payload.apiKey) {
          setApiKey("");
        }

        if (result.status) {
          setStatus(result.status);
        } else {
          await refreshStatus();
        }

        toast.success("Zerodha settings updated");
      } catch (error) {
        toast.error(error.message || "Failed to save settings");
      }
    });
  }

  return (
    <section className="rounded-2xl bg-[#061224]/95 p-6 shadow-[0_22px_48px_rgba(0,0,0,0.42)] ring-1 ring-[#214164]">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            zIndex: 10000000,
            background: "#0a1a2e",
            color: "#dce9ff",
            border: "1px solid rgba(126,162,216,0.32)",
            boxShadow: "0 14px 32px rgba(0,0,0,0.35)"
          }
        }}
      />

      <h2 className="text-2xl font-semibold text-[#edf5ff]">Zerodha Credentials</h2>
      <p className="mt-2 text-sm text-[#9db4d3]">
        Update Kite credentials here. Access token must be updated daily.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StatusChip label="API Key" value={Boolean(status.has_api_key)} />
        <StatusChip label="API Secret" value={Boolean(status.has_api_secret)} />
        <StatusChip label="Access Token" value={Boolean(status.has_access_token)} />
      </div>

      <p className="mt-3 text-xs text-[#8ea8c9]">
        Last updated: {formatTimestamp(status.updated_at)} {status.updated_by ? `by ${status.updated_by}` : ""}
      </p>

      <form onSubmit={submitSettings} className="mt-5 grid gap-4">
        <label>
          <span className="mb-1 block text-sm font-medium text-[#d7e7ff]">API Key (set once or when changed)</span>
          <input
            type="text"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="srgx0vatlrzgmdrk"
            className="w-full rounded-xl border border-[#2b4d77] bg-[#0b1728] px-4 py-2.5 text-sm text-[#e6f0ff] outline-none transition placeholder:text-[#7d97bb] focus:border-[#60a3ff]"
          />
        </label>

        <label>
          <span className="mb-1 block text-sm font-medium text-[#d7e7ff]">API Secret (set once or when changed)</span>
          <input
            type="password"
            value={apiSecret}
            onChange={(event) => setApiSecret(event.target.value)}
            placeholder="k85tj2zvcfh8zzvob1gkh4ii8twxc95z"
            className="w-full rounded-xl border border-[#2b4d77] bg-[#0b1728] px-4 py-2.5 text-sm text-[#e6f0ff] outline-none transition placeholder:text-[#7d97bb] focus:border-[#60a3ff]"
          />
        </label>

        <label>
          <span className="mb-1 block text-sm font-medium text-[#d7e7ff]">Daily Access Token</span>
          <input
            type="text"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder="Paste today's Zerodha access token"
            className="w-full rounded-xl border border-[#2b4d77] bg-[#0b1728] px-4 py-2.5 text-sm text-[#e6f0ff] outline-none transition placeholder:text-[#7d97bb] focus:border-[#60a3ff]"
            required={false}
          />
        </label>

        <div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-[#1d5fbe] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2a73de] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Save Zerodha Settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
