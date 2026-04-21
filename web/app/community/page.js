import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import CommunityClient from "@/components/community/CommunityClient";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export const metadata = {
  title: "Community | Tradestrom"
};

export default async function CommunityPage() {
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

  if (!access?.allowed) {
    redirect("/");
  }

  const isAdmin = String(access?.role || "").toLowerCase() === "admin";

  return (
    <CommunityClient
      userName={session.user.name || ""}
      userEmail={session.user.email || ""}
      userImage={session.user.image || ""}
      isAdmin={isAdmin}
    />
  );
}
