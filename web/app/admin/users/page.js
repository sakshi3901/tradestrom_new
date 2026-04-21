import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AdminUsersClient from "@/components/AdminUsersClient";
import AppTopHeaderClient from "@/components/AppTopHeaderClient";
import { authOptions } from "@/lib/auth";
import { checkAccess, listUsersByRole } from "@/lib/api";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  let access;
  try {
    access = await checkAccess(session.user.email);
  } catch (error) {
    redirect("/");
  }

  if (!access.allowed) {
    redirect("/");
  }

  if (access.role !== "admin") {
    redirect("/home");
  }

  const [clientsResult, adminsResult] = await Promise.all([
    listUsersByRole("client"),
    listUsersByRole("admin")
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 pb-10 pt-0 sm:px-6 lg:px-8">
      <AppTopHeaderClient
        userName={session.user.name || ""}
        userEmail={session.user.email || ""}
        userImage={session.user.image || ""}
        isAdmin
      />

      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Administration</p>
          <h1 className="text-3xl font-bold text-ink">User Access Manager</h1>
        </div>
        <Link
          href="/admin"
          className="rounded-xl border border-ink/25 px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink hover:text-white"
        >
          Back to Dashboard
        </Link>
      </header>

      <AdminUsersClient
        initialClients={clientsResult.users || []}
        initialAdmins={adminsResult.users || []}
        actorEmail={session.user.email}
      />
    </main>
  );
}
