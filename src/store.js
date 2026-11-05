// Armazenamento simples em JSON (MVP). Estrutura já pensada para migrar ao Supabase:
// tabelas usuarios(id, creditos, plano) e geracoes(id, usuario_id, tipo, status, custo_usd, creditos, criado_em, dados)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CREDITOS_INICIAIS = 50;
const CUSTO_CREDITOS = { carrossel: 1, video: 3 };

fs.mkdirSync(path.join(DATA_DIR, 'out'), { recursive: true });

function load() {
  if (!fs.existsSync(DB_FILE)) {
    return { usuarios: { demo: { id: 'demo', creditos: CREDITOS_INICIAIS, plano: 'teste' } }, geracoes: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
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

module.exports = { usuario, debitar, estornar, registrar, atualizar, buscar, historico, resetCreditos, CUSTO_CREDITOS, DATA_DIR };
