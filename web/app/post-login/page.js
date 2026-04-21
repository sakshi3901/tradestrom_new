import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

export default async function PostLoginPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  let hasAccess = false;
  try {
    const access = await checkAccess(session.user.email);
    hasAccess = Boolean(access?.allowed);
  } catch (error) {
    hasAccess = false;
  }

  redirect(hasAccess ? "/nifty-contribution" : "/?unauthorized=1");
}
