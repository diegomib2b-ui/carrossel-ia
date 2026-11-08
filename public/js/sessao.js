// Sessão do usuário: guarda o token, renova quando expira e manda pro login se precisar.
(function () {
  const CHAVE = 'dc_sessao';
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; } };
  const gravar = s => { try { s ? localStorage.setItem(CHAVE, JSON.stringify(s)) : localStorage.removeItem(CHAVE); } catch {} };
  let config = null;
  async function cfg() { if (!config) config = await fetch('/api/config').then(r => r.json()); return config; }

  async function renovar() {
    const s = ler(); if (!s?.refresh_token) return false;
    const r = await fetch('/api/auth/renovar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (!r.ok) return false;
    gravar(await r.json()); return true;
  }

  // fetch com login: aceita objeto (vira JSON) ou FormData
  async function api(url, opt = {}, tentou = false) {
    const s = ler();
    const headers = { ...(s?.access_token ? { Authorization: 'Bearer ' + s.access_token } : {}) };
    let body = opt.body;
    if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    const r = await fetch(url, { ...opt, headers, body });
    if (r.status === 401 && (await cfg()).login) {
      if (!tentou && await renovar()) return api(url, opt, true);
      sair(); throw new Error('Sessão expirada');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || `Erro ${r.status}`), { status: r.status });
    return j;
  }

  async function exigirLogin() {
    const c = await cfg();
    if (c.login && !ler()?.access_token) { location.href = '/entrar?volta=' + encodeURIComponent(location.pathname + location.hash); return false; }
    return true;
  }
  function sair() { gravar(null); location.href = '/entrar'; }

  window.DC = { api, cfg, exigirLogin, sair, gravar, ler };
})();
