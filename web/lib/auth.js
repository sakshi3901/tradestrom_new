import GoogleProvider from "next-auth/providers/google";
import { checkAccess } from "@/lib/api";
import { isGmail } from "@/lib/email";

export const authOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt"
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "select_account"
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user }) {
      return isGmail(user?.email);
    },
    async jwt({ token, user, trigger }) {
      const email = user?.email || token?.email;

      if (!email) {
        return token;
      }

      token.email = email;

      if (!isGmail(email)) {
        token.role = "client";
        token.hasAccess = false;
        return token;
      }

      if (
        user ||
        trigger === "update" ||
        typeof token.role === "undefined" ||
        typeof token.hasAccess === "undefined"
      ) {
        try {
          const result = await checkAccess(email);
          token.role = result?.role || "client";
          token.hasAccess = Boolean(result?.allowed);
        } catch (error) {
          token.role = "client";
          token.hasAccess = false;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email;
        session.user.role = token.role || "client";
        session.user.hasAccess = Boolean(token.hasAccess);
      }

      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      if (url.startsWith(baseUrl)) {
        return url;
      }
      return `${baseUrl}/post-login`;
    }
  },
  pages: {
    signIn: "/"
  }
};
