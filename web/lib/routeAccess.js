import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkAccess } from "@/lib/api";

const ACCESS_CACHE_TTL_MS = 15 * 1000;
const accessCache = new Map();
const accessInflight = new Map();

async function getCachedAccess(email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) {
    return { allowed: false, role: "client" };
  }

  const now = Date.now();
  const cached = accessCache.get(key);
  const staleCachedValue = cached?.value && typeof cached.value === "object"
    ? cached.value
    : null;
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (accessInflight.has(key)) {
    return accessInflight.get(key);
  }

  const promise = checkAccess(email)
    .catch(() => ({
      ...(staleCachedValue || {}),
      allowed: typeof staleCachedValue?.allowed === "boolean" ? staleCachedValue.allowed : false,
      role: String(staleCachedValue?.role || "client")
    }))
    .then((value) => {
      accessCache.set(key, {
        value,
        expiresAt: Date.now() + ACCESS_CACHE_TTL_MS
      });
      if (accessCache.size > 128) {
        const firstKey = accessCache.keys().next().value;
        accessCache.delete(firstKey);
      }
      return value;
    })
    .finally(() => {
      accessInflight.delete(key);
    });

  accessInflight.set(key, promise);
  return promise;
}

export async function requireMarketAccess() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized"
    };
  }

  const access = await getCachedAccess(session.user.email);

  if (!access.allowed) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden"
    };
  }

  return {
    ok: true,
    session,
    access
  };
}
