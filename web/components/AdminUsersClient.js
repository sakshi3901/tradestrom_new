"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Toaster, toast } from "react-hot-toast";

function formatDate(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function RoleTable({
  title,
  users,
  onRevoke,
  onCopyEmail,
  pending,
  currentEmail
}) {
  const rowsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(users.length / rowsPerPage));
  const offset = (currentPage - 1) * rowsPerPage;
  const visibleRows = users.slice(offset, offset + rowsPerPage);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function goToPage(page) {
    if (page < 1 || page > totalPages) {
      return;
    }
    setCurrentPage(page);
  }

  return (
    <section className="card overflow-hidden">
      <header className="border-b border-ink/10 px-5 py-4">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/75">
            <tr>
              <th className="px-5 py-3 font-semibold">Email</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Created At</th>
              <th className="px-5 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="px-5 py-4 text-ink/60" colSpan={4}>
                  No users found.
                </td>
              </tr>
            ) : (
              visibleRows.map((user) => {
                const disableRevoke = pending || user.email === currentEmail;
                return (
                  <tr key={`${user.email}-${user.role}`} className="border-t border-ink/10">
                    <td className="px-5 py-4 text-ink">
                      <button
                        type="button"
                        onClick={() => onCopyEmail(user.email)}
                        className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-sea"
                        title="Copy email"
                      >
                        {user.email}
                      </button>
                    </td>
                    <td className="px-5 py-4 capitalize text-ink/80">{user.role}</td>
                    <td className="px-5 py-4 text-ink/80">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        disabled={disableRevoke}
                        onClick={() => onRevoke(user.email)}
                        className="rounded-lg border border-danger/35 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink/10 px-5 py-3">
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold text-ink transition hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>

          {Array.from({ length: totalPages }, (_, index) => {
            const page = index + 1;
            const active = page === currentPage;
            return (
              <button
                key={`${title}-page-${page}`}
                type="button"
                onClick={() => goToPage(page)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? "bg-ink text-white"
                    : "border border-ink/25 text-ink hover:bg-ink hover:text-white"
                }`}
              >
                {page}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="rounded-md border border-ink/25 px-3 py-1 text-xs font-semibold text-ink transition hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </footer>
      ) : null}
    </section>
  );
}

export default function AdminUsersClient({
  initialClients,
  initialAdmins,
  actorEmail
}) {
  const [clients, setClients] = useState(initialClients || []);
  const [admins, setAdmins] = useState(initialAdmins || []);
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState("client");
  const [isPending, startTransition] = useTransition();

  const counts = useMemo(
    () => ({
      client: clients.length,
      admin: admins.length
    }),
    [clients, admins]
  );

  async function fetchRole(role) {
    const response = await fetch(`/api/admin/users?role=${encodeURIComponent(role)}`, {
      method: "GET",
      cache: "no-store"
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to fetch users");
    }

    return payload.users || [];
  }

  async function refreshTables() {
    const [nextClients, nextAdmins] = await Promise.all([
      fetchRole("client"),
      fetchRole("admin")
    ]);

    setClients(nextClients);
    setAdmins(nextAdmins);
  }

  async function handleGrant(event) {
    event.preventDefault();

    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      toast.error("Email is required");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/grant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: targetEmail,
            role: selectedRole
          })
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to grant access");
        }

        setEmail("");
        await refreshTables();
        toast.success("Access granted successfully");
      } catch (error) {
        toast.error(error.message || "Failed to grant access");
      }
    });
  }

  async function handleRevoke(targetEmail) {
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email: targetEmail })
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to revoke access");
        }

        await refreshTables();
        toast.success(`Access revoked for ${targetEmail}`);
      } catch (error) {
        toast.error(error.message || "Failed to revoke access");
      }
    });
  }

  async function handleCopyEmail(targetEmail) {
    try {
      await navigator.clipboard.writeText(targetEmail);
      toast.success("Email copied");
    } catch (error) {
      toast.error("Failed to copy email");
    }
  }

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />

      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink/55">Clients</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{counts.client}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-ink/55">Admins</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{counts.admin}</p>
        </div>
      </div>

      <RoleTable
        title="All Clients"
        users={clients}
        onCopyEmail={handleCopyEmail}
        pending={isPending}
        currentEmail={actorEmail}
        onRevoke={handleRevoke}
      />
      <RoleTable
        title="All Admins"
        users={admins}
        onCopyEmail={handleCopyEmail}
        pending={isPending}
        currentEmail={actorEmail}
        onRevoke={handleRevoke}
      />

      <section className="card p-6">
        <h2 className="text-xl font-semibold text-ink">Grant Access</h2>
        <p className="mt-2 text-sm text-ink/70">
          Add a Gmail user and assign access role.
        </p>

        <form onSubmit={handleGrant} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="name@gmail.com"
              className="w-full rounded-xl border border-ink/25 bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
            />
          </label>

          <label className="sm:w-48">
            <span className="mb-1 block text-sm font-medium text-ink">Role</span>
            <select
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value)}
              className="w-full rounded-xl border border-ink/25 bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-accent"
            >
              <option value="client">Client</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-success px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Grant Access"}
          </button>
        </form>
      </section>
    </div>
  );
}
