import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import VideosClient from "@/components/videos/VideosClient";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export const metadata = {
  title: "Strategy Video | Tradestrom"
};

export default async function VideosPage() {
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
    <VideosClient
      userName={session.user.name || ""}
      userEmail={session.user.email || ""}
      userImage={session.user.image || ""}
      isAdmin={isAdmin}
    />
  );
}
