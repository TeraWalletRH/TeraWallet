// Client API helper for Admin Dashboard endpoints

const getAdminToken = (): string => {
  return localStorage.getItem("tera_admin_token") || "";
};

export const setAdminToken = (token: string): void => {
  localStorage.setItem("tera_admin_token", token);
};

export const removeAdminToken = (): void => {
  localStorage.removeItem("tera_admin_token");
};

export async function adminFetch<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("x-admin-token", token);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });

    if (response.status === 502 || response.status === 404) {
      throw new Error(`Proxy error ${response.status}`);
    }
  } catch {
    // Fall back to direct backend port 3001 if local server-side proxy fails or is not running
    const directUrl = path.startsWith("http")
      ? path
      : `http://127.0.0.1:3001${path}`;
    response = await fetch(directUrl, {
      ...options,
      headers,
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !path.includes("/api/admin/auth/login")) {
      removeAdminToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/admin/login")) {
        window.location.href = "/admin/login";
      }
    }
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export const adminApi = {
  login: (password: string) =>
    adminFetch<{ success: boolean; token: string; expiresAt: string }>(
      "/api/admin/auth/login",
      { method: "POST", body: JSON.stringify({ password }) },
    ),

  me: () =>
    adminFetch<{ success: boolean; authenticated: boolean; role: string }>(
      "/api/admin/auth/me",
    ),

  logout: () =>
    adminFetch<{ success: boolean }>("/api/admin/auth/logout", {
      method: "POST",
    }),

  getStats: () =>
    adminFetch<{ success: boolean; stats: any; recentActivity: any[] }>(
      "/api/admin/stats",
    ),

  getAccounts: (params: { page?: number; limit?: number; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.search) q.set("search", params.search);
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number }>(
      `/api/admin/accounts?${q.toString()}`,
    );
  },

  getAccountDetail: (address: string) =>
    adminFetch<{ success: boolean; account: any; sessionKeys: any[]; intents: any[] }>(
      `/api/admin/accounts/${encodeURIComponent(address)}`,
    ),

  revokeSessionKey: (id: string) =>
    adminFetch<{ success: boolean; message: string }>(
      `/api/admin/sessions/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  getTags: (params: { page?: number; limit?: number; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.search) q.set("search", params.search);
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number }>(
      `/api/admin/tags?${q.toString()}`,
    );
  },

  registerTag: (tag: string, ownerAddress: string) =>
    adminFetch<{ success: boolean; message: string }>("/api/admin/tags", {
      method: "POST",
      body: JSON.stringify({ tag, ownerAddress }),
    }),

  deleteTag: (tag: string) =>
    adminFetch<{ success: boolean; message: string }>(
      `/api/admin/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" },
    ),

  getBusinessEmails: (params: { page?: number; limit?: number; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.search) q.set("search", params.search);
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number }>(
      `/api/admin/business-emails?${q.toString()}`,
    );
  },

  verifyBusinessEmail: (email: string, ownerAddress: string, businessName: string) =>
    adminFetch<{ success: boolean; message: string }>("/api/admin/business-emails/verify", {
      method: "POST",
      body: JSON.stringify({ email, ownerAddress, businessName }),
    }),

  deleteBusinessEmail: (email: string) =>
    adminFetch<{ success: boolean; message: string }>(
      `/api/admin/business-emails/${encodeURIComponent(email)}`,
      { method: "DELETE" },
    ),

  getTeams: (params: { page?: number; limit?: number; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.search) q.set("search", params.search);
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number }>(
      `/api/admin/teams?${q.toString()}`,
    );
  },

  getTeamDetail: (safeAddress: string) =>
    adminFetch<{ success: boolean; team: any; members: any[]; proposals: any[] }>(
      `/api/admin/teams/${encodeURIComponent(safeAddress)}`,
    ),

  getPaymentLinks: (params: { page?: number; limit?: number; search?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.search) q.set("search", params.search);
    if (params.status) q.set("status", params.status);
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number }>(
      `/api/admin/payment-links?${q.toString()}`,
    );
  },

  cancelPaymentLink: (id: string) =>
    adminFetch<{ success: boolean; message: string }>(
      `/api/admin/payment-links/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),

  getPrivateJobs: (params: { page?: number; limit?: number; type?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.type) q.set("type", params.type);
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number; type: string }>(
      `/api/admin/private-jobs?${q.toString()}`,
    );
  },

  retryPrivateJob: (type: string, id: string) =>
    adminFetch<{ success: boolean; message: string }>(
      `/api/admin/private-jobs/${encodeURIComponent(type)}/${encodeURIComponent(id)}/retry`,
      { method: "POST" },
    ),

  getAuditLogs: (params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    return adminFetch<{ success: boolean; items: any[]; total: number; page: number; limit: number }>(
      `/api/admin/audit-logs?${q.toString()}`,
    );
  },
};
