// Armazenamento por usuário. Dois modos:
//  - Supabase (produção): quando SUPABASE_URL + SUPABASE_SECRET_KEY estão no .env
//  - Local (teste/demo): arquivo data/db.json com um usuário "demo", sem login
const fs = require('fs');
const path = require('path');

// Em produção (Railway) aponte DATA_DIR para o volume persistente, ex.: /app/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'out'), { recursive: true });

// Preço em créditos de cada ação (custo real de API registrado no Histórico)
const CUSTO_CREDITOS = { roteiro: 0, carrossel: 2, video: 5, avatar_extra: 30, avatar_por_min: 45, avatar_minimo: 10 };
const creditosAvatar = seg => Math.max(CUSTO_CREDITOS.avatar_minimo, Math.ceil(seg / 60 * CUSTO_CREDITOS.avatar_por_min));
const CREDITOS_BOAS_VINDAS = 30;

const erroCreditos = (precisa, tem) => Object.assign(new Error(`Créditos insuficientes (precisa ${precisa}${tem != null ? `, tem ${tem}` : ''}). Veja os planos.`), { status: 402 });

// ---------------- Modo Supabase ----------------
function supabaseStore() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    modo: 'supabase', sb,
    perfil: async uid => ok(await sb.from('perfis').select('*').eq('id', uid).single()),
    atualizarPerfil: async (uid, p) => ok(await sb.from('perfis').update(p).eq('id', uid).select().single()),
    marca: async uid => ok(await sb.from('marcas').select('*').eq('usuario_id', uid).maybeSingle()),
    salvarMarca: async (uid, m) => ok(await sb.from('marcas').upsert({ ...m, usuario_id: uid, atualizado_em: new Date().toISOString() }, { onConflict: 'usuario_id' }).select().single()),
    async mover(uid, delta, motivo, ref) {
      const { data, error } = await sb.rpc('mover_creditos', { p_usuario: uid, p_delta: delta, p_motivo: motivo, p_ref: ref || null });
      if (error) { if (/CREDITOS_INSUFICIENTES/.test(error.message)) throw erroCreditos(-delta); throw new Error(error.message); }
      return data;
    },
    registrar: async g => ok(await sb.from('geracoes').insert(g).select().single()),
    atualizar: async (id, p) => ok(await sb.from('geracoes').update(p).eq('id', id).select().single()),
    buscar: async (id, uid) => ok(await sb.from('geracoes').select('*').eq('id', id).eq('usuario_id', uid).maybeSingle()),
    historico: async uid => ok(await sb.from('geracoes').select('*').eq('usuario_id', uid).order('criado_em', { ascending: false }).limit(50)),
    salvarAvatar: async a => ok(await sb.from('avatares').insert(a).select().single()),
    avatares: async uid => ok(await sb.from('avatares').select('*').eq('usuario_id', uid).order('criado_em', { ascending: false })),
    buscarAvatar: async (id, uid) => ok(await sb.from('avatares').select('*').eq('id', id).eq('usuario_id', uid).maybeSingle()),
    salvarAudio: async a => ok(await sb.from('audios').insert(a).select().single()),
    buscarAudio: async (id, uid) => ok(await sb.from('audios').select('*').eq('id', id).eq('usuario_id', uid).maybeSingle()),
    planos: async () => ok(await sb.from('planos').select('*').eq('ativo', true).order('ordem')),
    salvarAssinatura: async a => ok(await sb.from('assinaturas').upsert({ ...a, atualizado_em: new Date().toISOString() }, { onConflict: 'provedor_id' }).select().single()),
    assinaturaPorProvedor: async pid => ok(await sb.from('assinaturas').select('*').eq('provedor_id', pid).maybeSingle()),
    assinaturaAtual: async uid => ok(await sb.from('assinaturas').select('*').eq('usuario_id', uid).order('criado_em', { ascending: false }).limit(1).maybeSingle()),
    async subirArquivo(uid, nome, buffer, tipo) {
      const caminho = `${uid}/${Date.now()}-${nome}`;
      ok(await sb.storage.from('marcas').upload(caminho, buffer, { contentType: tipo, upsert: true }));
      return sb.storage.from('marcas').getPublicUrl(caminho).data.publicUrl;
    }
  };
}

// ---------------- Modo local (JSON) ----------------
function localStore() {
  const DB = path.join(DATA_DIR, 'db.json');
  const PLANOS = [
    { id: 'start', nome: 'Start', preco_centavos: 9700, creditos_mes: 150, ordem: 1 },
    { id: 'pro', nome: 'Pro', preco_centavos: 14700, creditos_mes: 300, ordem: 2 },
    { id: 'ultra', nome: 'Ultra', preco_centavos: 24700, creditos_mes: 500, ordem: 3 }
  ];
  const novo = () => ({ perfis: {}, marcas: {}, geracoes: [], avatares: [], audios: [], assinaturas: [], extrato: [] });
  let db = fs.existsSync(DB) ? { ...novo(), ...JSON.parse(fs.readFileSync(DB, 'utf8')) } : novo();
  if (!db.perfis || Array.isArray(db.perfis)) db.perfis = {};
  const save = () => fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  const agora = () => new Date().toISOString();
  const perfil = uid => {
    if (!db.perfis[uid]) { db.perfis[uid] = { id: uid, nome: 'Demo', creditos: CREDITOS_BOAS_VINDAS, plano: null, plano_status: 'teste', onboarding_ok: false, criado_em: agora() }; save(); }
    return db.perfis[uid];
  };
  return {
    modo: 'local',
    perfil: async uid => perfil(uid),
    atualizarPerfil: async (uid, p) => { Object.assign(perfil(uid), p); save(); return perfil(uid); },
    marca: async uid => db.marcas[uid] || null,
    salvarMarca: async (uid, m) => { db.marcas[uid] = { ...(db.marcas[uid] || { id: 'marca-' + uid, criado_em: agora() }), ...m, usuario_id: uid, atualizado_em: agora() }; save(); return db.marcas[uid]; },
    async mover(uid, delta, motivo, ref) {
      const p = perfil(uid);
      if (ref && db.extrato.some(e => e.referencia === ref)) return p.creditos;
      if (p.creditos + delta < 0) throw erroCreditos(-delta, p.creditos);
      p.creditos += delta; db.extrato.push({ usuario_id: uid, delta, motivo, referencia: ref || null, criado_em: agora() }); save();
      return p.creditos;
    },
    registrar: async g => { const r = { criado_em: agora(), ...g }; db.geracoes.unshift(r); save(); return r; },
    atualizar: async (id, p) => { const g = db.geracoes.find(x => x.id === id); if (g) { Object.assign(g, p); save(); } return g; },
    buscar: async (id, uid) => db.geracoes.find(x => x.id === id && x.usuario_id === uid) || null,
    historico: async uid => db.geracoes.filter(g => g.usuario_id === uid).slice(0, 50),
    salvarAvatar: async a => { const r = { criado_em: agora(), ...a }; db.avatares.unshift(r); save(); return r; },
    avatares: async uid => db.avatares.filter(a => a.usuario_id === uid),
    buscarAvatar: async (id, uid) => db.avatares.find(a => a.id === id && a.usuario_id === uid) || null,
    salvarAudio: async a => { const r = { criado_em: agora(), ...a }; db.audios.unshift(r); db.audios = db.audios.slice(0, 200); save(); return r; },
    buscarAudio: async (id, uid) => db.audios.find(a => a.id === id && a.usuario_id === uid) || null,
    planos: async () => PLANOS,
    salvarAssinatura: async a => { const i = db.assinaturas.findIndex(x => x.provedor_id === a.provedor_id); const r = { ...(db.assinaturas[i] || { id: 'ass-' + Date.now(), criado_em: agora() }), ...a, atualizado_em: agora() }; i >= 0 ? db.assinaturas[i] = r : db.assinaturas.push(r); save(); return r; },
    assinaturaPorProvedor: async pid => db.assinaturas.find(a => a.provedor_id === pid) || null,
    assinaturaAtual: async uid => db.assinaturas.filter(a => a.usuario_id === uid).slice(-1)[0] || null,
    async subirArquivo(uid, nome, buffer) {
      const dir = path.join(DATA_DIR, 'marcas', uid); fs.mkdirSync(dir, { recursive: true });
      const f = `${Date.now()}-${nome}`; fs.writeFileSync(path.join(dir, f), buffer);
      return `/arquivos-marca/${uid}/${f}`;
    }
  };
}

const store = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? supabaseStore() : localStore();
module.exports = { ...store, store, CUSTO_CREDITOS, creditosAvatar, CREDITOS_BOAS_VINDAS, DATA_DIR };
