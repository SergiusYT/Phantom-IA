const KEY = "phantom.token";

export const auth = {
  get token() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(token) {
    try { token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY); } catch { /* sin storage */ }
  },
};

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth.token) headers.Authorization = `Token ${auth.token}`;
  const res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    auth.set(null);
    window.dispatchEvent(new Event("phantom:logout"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

// Solo en desarrollo: permite abrir la consola con ?token=... (capturas automatizadas).
if (import.meta.env.DEV) {
  const t = new URLSearchParams(location.search).get("token");
  if (t) { auth.set(t); history.replaceState(null, "", location.pathname + location.hash); }
}
