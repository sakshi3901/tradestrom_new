import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export default async function NoAccessPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  let accessAllowed = false;

  try {
    const access = await checkAccess(session.user.email);
    accessAllowed = Boolean(access.allowed);
  } catch (error) {
    accessAllowed = false;
  }

  if (accessAllowed) {
    redirect("/nifty-contribution");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <section className="card w-full max-w-lg p-8 text-center">
        <h1 className="text-3xl font-bold text-ink">Access Pending</h1>
        <p className="mt-4 text-sm text-ink/75">
          Your account is authenticated but not granted access yet. Ask an admin to grant your email.
        </p>
      </section>
    </main>
  );
}
