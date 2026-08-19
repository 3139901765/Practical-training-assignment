const BASE = '/api';

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败（${res.status}）`);
  }
  return res.json();
}

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  meta: () => getJSON('/meta'),
  overview: (p) => getJSON(`/overview${qs(p)}`),
  topProducts: (p) => getJSON(`/top-products${qs(p)}`),
  stores: (p) => getJSON(`/stores${qs(p)}`),
  categories: (p) => getJSON(`/categories${qs(p)}`),
  chat: async (payload) => {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `请求失败（${res.status}）`);
    }
    return res.json();
  },
};
