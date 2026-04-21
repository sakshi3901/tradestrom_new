import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export default async function HomePage() {
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Tradestrom</p>
          <h1 className="text-3xl font-bold text-ink">Welcome, {session.user.email}</h1>
        </div>
      </header>

      <section className="card p-6">
        <p className="text-sm text-ink/80">Your role: <span className="font-semibold capitalize">{access.role}</span></p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/nifty-contribution"
            className="inline-flex items-center rounded-xl bg-sea px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink"
          >
            NIFTY Contribution Dashboard
          </Link>
          <Link
            href="/community"
            className="inline-flex items-center rounded-xl bg-[#204b80] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Community
          </Link>
          {access.role === "admin" ? (
            <Link
              href="/admin"
              className="inline-flex items-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
            >
              Admin Dashboard
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
