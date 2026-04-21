import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";
import AdminZerodhaSettingsClient from "@/components/AdminZerodhaSettingsClient";
import AppTopHeaderClient from "@/components/AppTopHeaderClient";

export const metadata = {
  title: "Admin Token | Tradestrom"
};

export default async function AdminTokenPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  let access;
  try {
    access = await checkAccess(session.user.email);
  } catch (_) {
    redirect("/");
  }

  if (!access?.allowed || access.role !== "admin") {
    redirect("/nifty-contribution");
  }

  return (
    <main className="min-h-screen w-full bg-[radial-gradient(90%_140%_at_10%_0%,rgba(35,68,110,0.35),transparent_50%),radial-gradient(110%_140%_at_100%_100%,rgba(25,52,88,0.25),transparent_58%),#02060f]">
      <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-0 sm:px-6 lg:px-8">
        <AppTopHeaderClient
          userName={session.user.name || ""}
          userEmail={session.user.email || ""}
          userImage={session.user.image || ""}
          isAdmin
        />

        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#8aa8cd]">Administration</p>
            <h1 className="text-3xl font-bold text-[#edf5ff]">Token</h1>
          </div>
          <Link
            href="/admin"
            className="rounded-lg border border-[#2f4f78] bg-[#0b1b31] px-4 py-2 text-sm font-medium text-[#d8e7ff] transition hover:bg-[#12305a]"
          >
            Back to Dashboard
          </Link>
        </header>

        <AdminZerodhaSettingsClient />
      </div>
    </main>
  );
}
