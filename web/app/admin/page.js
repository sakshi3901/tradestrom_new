import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AppTopHeaderClient from "@/components/AppTopHeaderClient";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export default async function AdminPage() {
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
    redirect("/nifty-contribution");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-6 px-4 pb-10 pt-0 sm:px-6 lg:px-8">
      <AppTopHeaderClient
        userName={session.user.name || ""}
        userEmail={session.user.email || ""}
        userImage={session.user.image || ""}
        isAdmin
      />

      <section className="rounded-2xl bg-[#061224]/95 p-8 shadow-[0_22px_48px_rgba(0,0,0,0.42)] ring-1 ring-[#214164]">
        <h1 className="text-3xl font-bold text-[#edf5ff]">Admin Dashboard</h1>
        <p className="mt-3 text-sm text-[#9db4d3]">
          Manage user access, community moderation, and Zerodha token settings.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/admin/users"
            className="inline-flex items-center rounded-xl bg-[#1d5fbe] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2a73de]"
          >
            Admin Users
          </Link>
          <Link
            href="/admin/community"
            className="inline-flex items-center rounded-xl bg-[#294f7c] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Community Management
          </Link>
          <Link
            href="/admin/token"
            className="inline-flex items-center rounded-xl bg-[#1d5fbe] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2a73de]"
          >
            Token
          </Link>
        </div>
      </section>
    </main>
  );
}
