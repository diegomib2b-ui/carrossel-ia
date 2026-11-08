// Armazenamento simples em JSON (MVP). Estrutura já pensada para migrar ao Supabase:
// tabelas usuarios(id, creditos, plano) e geracoes(id, usuario_id, tipo, status, custo_usd, creditos, criado_em, dados)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CREDITOS_INICIAIS = 50;
// avatar_seg: 1 crédito a cada N segundos de vídeo com avatar (lip-sync é cobrado por segundo)
const CUSTO_CREDITOS = { carrossel: 1, video: 3, avatar_extra: 10, avatar_seg: 5 };

fs.mkdirSync(path.join(DATA_DIR, 'out'), { recursive: true });

function load() {
  if (!fs.existsSync(DB_FILE)) {
    return { usuarios: { demo: { id: 'demo', creditos: CREDITOS_INICIAIS, plano: 'teste' } }, geracoes: [], avatares: [], audios: [] };
  }
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  d.avatares ||= []; d.audios ||= [];
  return d;
}
let db = load();
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

function usuario(id = 'demo') {
  if (!db.usuarios[id]) { db.usuarios[id] = { id, creditos: CREDITOS_INICIAIS, plano: 'teste' }; save(); }
  return db.usuarios[id];
}

// Desconta créditos antes de gerar; devolve se a geração falhar (estorno)
function debitar(userId, tipo) {
  const u = usuario(userId);
  const custo = CUSTO_CREDITOS[tipo];
  if (u.creditos < custo) { const e = new Error(`Créditos insuficientes (precisa ${custo}, tem ${u.creditos})`); e.status = 402; throw e; }
  u.creditos -= custo; save();
  return custo;
}
function estornar(userId, tipo) { usuario(userId).creditos += CUSTO_CREDITOS[tipo]; save(); }
// Débito/estorno por quantidade (usado no avatar, cobrado pela duração)
function debitarN(userId, n) {
  const u = usuario(userId);
  if (u.creditos < n) { const e = new Error(`Créditos insuficientes (precisa ${n}, tem ${u.creditos})`); e.status = 402; throw e; }
  u.creditos -= n; save(); return n;
}
function estornarN(userId, n) { usuario(userId).creditos += n; save(); }
const creditosAvatar = seg => Math.max(1, Math.ceil(seg / CUSTO_CREDITOS.avatar_seg));

// Avatares (foto + voz clonada) e áudios de prévia
function salvarAvatar(a) { db.avatares.unshift({ criado_em: new Date().toISOString(), usuario_id: 'demo', ...a }); save(); return db.avatares[0]; }
const avatares = (userId = 'demo') => db.avatares.filter(a => a.usuario_id === userId);
const buscarAvatar = id => db.avatares.find(a => a.id === id);
function salvarAudio(a) { db.audios.unshift({ criado_em: new Date().toISOString(), ...a }); db.audios = db.audios.slice(0, 200); save(); return db.audios[0]; }
const buscarAudio = id => db.audios.find(a => a.id === id);

function registrar(g) {
  const reg = { criado_em: new Date().toISOString(), usuario_id: 'demo', ...g };
  db.geracoes.unshift(reg); save();
  console.log(`[custo] ${reg.tipo} ${reg.id}: US$ ${(reg.custo_usd || 0).toFixed(5)} (${reg.creditos} créditos)`);
  return reg;
}
function atualizar(id, patch) {
  const g = db.geracoes.find(x => x.id === id); if (!g) return null;
  Object.assign(g, patch); save(); return g;
}
const buscar = id => db.geracoes.find(x => x.id === id);
const historico = (userId = 'demo') => db.geracoes.filter(g => g.usuario_id === userId).slice(0, 50);
function resetCreditos(userId = 'demo') { usuario(userId).creditos = CREDITOS_INICIAIS; save(); }

module.exports = { usuario, debitar, estornar, debitarN, estornarN, creditosAvatar, salvarAvatar, avatares, buscarAvatar, salvarAudio, buscarAudio, registrar, atualizar, buscar, historico, resetCreditos, CUSTO_CREDITOS, DATA_DIR };
