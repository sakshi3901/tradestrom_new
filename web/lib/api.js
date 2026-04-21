import "server-only";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function buildHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    "X-Internal-Secret": requireEnv("INTERNAL_API_SECRET"),
    ...extraHeaders
  };
}

export async function callGoApi(path, options = {}) {
  const baseUrl = requireEnv("GO_API_BASE_URL");
  const url = `${baseUrl}${path}`;
  const {
    timeoutMs = 0,
    signal: externalSignal,
    headers: extraHeaders = {},
    ...fetchOptions
  } = options || {};
  const controller = new AbortController();
  const timeoutValue = Number(timeoutMs);
  const timeoutEnabled = Number.isFinite(timeoutValue) && timeoutValue > 0;
  const timeoutId = timeoutEnabled ? setTimeout(() => controller.abort(), timeoutValue) : null;
  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...fetchOptions,
      signal: controller.signal,
      headers: buildHeaders(extraHeaders)
    });
  } catch (error) {
    if (String(error?.name || "").toLowerCase() === "aborterror") {
      const timeoutError = new Error(`Go API request timeout (${path})`);
      timeoutError.status = 504;
      timeoutError.path = path;
      timeoutError.url = url;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const message = payload?.error || `Go API request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.path = path;
    error.url = url;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function checkAccess(email) {
  const safeEmail = encodeURIComponent(email);
  return callGoApi(`/v1/access/check?email=${safeEmail}`, { timeoutMs: 1200 });
}

export async function listUsersByRole(role) {
  return callGoApi(`/v1/users?role=${encodeURIComponent(role)}`);
}

export async function grantUserAccess({ email, role = "client", actorEmail = "system" }) {
  return callGoApi("/v1/access/grant", {
    method: "POST",
    headers: {
      "X-Actor-Email": actorEmail
    },
    body: JSON.stringify({ email, role })
  });
}

export async function revokeUserAccess({ email, actorEmail = "system" }) {
  return callGoApi("/v1/access/revoke", {
    method: "POST",
    headers: {
      "X-Actor-Email": actorEmail
    },
    body: JSON.stringify({ email })
  });
}

export async function getAdminZerodhaSettings() {
  return callGoApi("/v1/admin/zerodha");
}

export async function updateAdminZerodhaSettings({
  apiKey,
  apiSecret,
  accessToken,
  actorEmail = "system"
}) {
  return callGoApi("/v1/admin/zerodha", {
    method: "POST",
    headers: {
      "X-Actor-Email": actorEmail
    },
    body: JSON.stringify({
      apiKey,
      apiSecret,
      accessToken
    })
  });
}

function toQuery(params) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    query.set(key, String(value));
  });

  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export async function fetchOhlc({
  symbol = "NIFTY50",
  from,
  to,
  interval = "1m"
}) {
  return callGoApi(
    `/v1/ohlc${toQuery({
      symbol,
      from,
      to,
      interval
    })}`
  );
}

export async function fetchMovers({
  from,
  to,
  interval = "1m",
  limit = 50
}) {
  return callGoApi(
    `/v1/movers${toQuery({
      from,
      to,
      interval,
      limit
    })}`
  );
}

export async function fetchMoversSnapshot({
  index = "NIFTY50",
  ts,
  limit = 50,
  dbOnly,
  signal
}) {
  return callGoApi(
    `/v1/movers/snapshot${toQuery({
      index,
      ts,
      limit,
      db_only: dbOnly
    })}`,
    {
      signal
    }
  );
}

export async function fetchContributionSeries({
  symbol,
  interval = "1m",
  at,
  onlySelected,
  signal
} = {}) {
  return callGoApi(
    `/v1/contribution-series${toQuery({
      symbol,
      interval,
      at,
      only_selected: onlySelected
    })}`,
    {
      signal
    }
  );
}

export async function fetchOptionSnapshot({
  symbol = "NIFTY",
  time,
  ts,
  signal,
  timeoutMs,
  historical
}) {
  const timestamp = ts ?? time;
  return callGoApi(
    `/v1/options/snapshot${toQuery({
      symbol,
      ts: timestamp,
      historical: historical ? 1 : undefined
    })}`,
    {
      signal,
      timeoutMs
    }
  );
}

export async function fetchOptionDiff({
  symbol = "NIFTY",
  from,
  to,
  limit = 10
}) {
  return callGoApi(
    `/v1/options/diff${toQuery({
      symbol,
      from,
      to,
      limit
    })}`
  );
}

export async function fetchOptionRange({
  symbol = "NIFTY",
  from,
  to
}) {
  return callGoApi(
    `/v1/options/range${toQuery({
      symbol,
      from,
      to
    })}`
  );
}

export async function fetchCommunityPosts({
  userEmail,
  authorEmail,
  category = "All",
  limit = 30,
  page = 1
}) {
  return callGoApi(
    `/v1/community/posts${toQuery({
      user_email: userEmail,
      author_email: authorEmail,
      category,
      limit,
      page
    })}`
  );
}

export async function createCommunityPost({
  userEmail,
  category,
  title,
  description,
  primaryImage,
  secondaryImage
}) {
  return callGoApi("/v1/community/posts", {
    method: "POST",
    headers: {
      "X-Actor-Email": userEmail
    },
    body: JSON.stringify({
      category,
      title,
      description,
      primary_image: primaryImage,
      secondary_image: secondaryImage
    })
  });
}

export async function deleteCommunityPost({
  userEmail,
  postId
}) {
  return callGoApi(`/v1/community/posts/${encodeURIComponent(postId)}`, {
    method: "DELETE",
    headers: {
      "X-Actor-Email": userEmail
    }
  });
}

export async function toggleCommunityPostLike({
  userEmail,
  postId
}) {
  return callGoApi(`/v1/community/posts/${encodeURIComponent(postId)}/like${toQuery({
    user_email: userEmail
  })}`, {
    method: "POST",
    headers: {
      "X-Actor-Email": userEmail
    }
  });
}

export async function fetchAdminCommunityPosts({
  actorEmail,
  status = "pending",
  category = "All",
  limit = 80,
  offset = 0
}) {
  return callGoApi(
    `/v1/admin/community/posts${toQuery({
      actor_email: actorEmail,
      status,
      category,
      limit,
      offset
    })}`
  );
}

export async function updateAdminCommunityPostStatus({
  actorEmail,
  postId,
  status
}) {
  return callGoApi(`/v1/admin/community/posts/${encodeURIComponent(postId)}/status`, {
    method: "POST",
    headers: {
      "X-Actor-Email": actorEmail
    },
    body: JSON.stringify({
      status
    })
  });
}
