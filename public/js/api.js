// ─── API Client ───────────────────────────────────────────────────────────────
const API_BASE = '';

const API = {
  async get(path) {
    const r = await fetch(API_BASE + path);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  },
  async delete(path) {
    const r = await fetch(API_BASE + path, { method: 'DELETE' });
    return r.json();
  },
  async uploadFile(path, formData) {
    const r = await fetch(API_BASE + path, { method: 'POST', body: formData });
    return r.json();
  },
  downloadUrl(path) {
    window.location.href = API_BASE + path;
  },
};
