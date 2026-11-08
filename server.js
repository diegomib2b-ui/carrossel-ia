const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./src/store');
const auth = require('./src/auth');
const pagamento = require('./src/pagamento');
const avatar = require('./src/avatar');
const { gerarCarrossel, gerarRoteiroAvatar } = require('./src/ai');
const { renderSlides } = require('./src/render');
const { editarVideo } = require('./src/video');
const { TEMPLATES } = require('./src/templates');

const app = express();
const OUT = path.join(store.DATA_DIR, 'out');
const AV = path.join(store.DATA_DIR, 'avatares');
const upload = multer({ dest: path.join(store.DATA_DIR, 'uploads'), limits: { fileSize: 200 * 1024 * 1024 } });
const uploadImg = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const id = () => crypto.randomBytes(5).toString('hex');
const pagina = f => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
// Envolve rotas async: qualquer erro vira JSON {erro} com o status certo
const rota = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { if (!e.status || e.status >= 500) console.error(e); res.status(e.status || 500).json({ erro: e.message }); });

app.use(express.json({ limit: '1mb' }));
app.get('/app', pagina('app.html'));
app.get('/entrar', pagina('entrar.html'));
app.get('/boas-vindas', pagina('boas-vindas.html'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/out', express.static(OUT));
app.use('/avatares', express.static(AV));
app.use('/arquivos-marca', express.static(path.join(store.DATA_DIR, 'marcas')));

// ================= Públicas =================
app.get('/api/config', (req, res) => res.json({ login: auth.ativo, pagamento: pagamento.ativo() ? 'mercadopago' : 'demo' }));
app.get('/api/planos', rota(async (req, res) => res.json(await store.planos())));
app.post('/api/auth/cadastro', rota(async (req, res) => res.json(await auth.cadastrar(req.body || {}))));
app.post('/api/auth/entrar', rota(async (req, res) => res.json(await auth.entrar(req.body || {}))));
app.post('/api/auth/renovar', rota(async (req, res) => res.json(await auth.renovar(req.body?.refresh_token))));
app.post('/api/webhooks/mercadopago', rota(async (req, res) => res.json(await pagamento.processarWebhook(req))));

// ================= Logadas =================
const api = express.Router();
api.use(auth.exigirLogin);

api.get('/me', rota(async (req, res) => {
  const [perfil, marca, planos, assinatura] = await Promise.all([store.perfil(req.uid), store.marca(req.uid), store.planos(), store.assinaturaAtual(req.uid)]);
  res.json({ ...perfil, email: req.email, marca, planos, assinatura, custos: store.CUSTO_CREDITOS, templates: TEMPLATES,
    ia: !!process.env.ANTHROPIC_API_KEY, whisper: !!process.env.OPENAI_API_KEY, voz: avatar.temVoz(), lipsync: avatar.temLipsync(),
    estilos: avatar.ESTILOS, max_chars: avatar.MAX_CHARS, modo: store.modo, pagamento: pagamento.ativo() ? 'mercadopago' : 'demo' });
}));

// ----- Marca / onboarding -----
const CAMPOS_MARCA = ['nome', 'handle', 'nicho', 'descricao', 'publico', 'tom', 'estilo_escrita', 'cor', 'cor2'];
api.post('/marca', uploadImg.fields([{ name: 'logo', maxCount: 1 }, { name: 'foto', maxCount: 1 }]), rota(async (req, res) => {
  const b = req.body || {};
  if (!String(b.nome || '').trim()) return res.status(400).json({ erro: 'Informe o nome da marca' });
  const m = {};
  CAMPOS_MARCA.forEach(k => { if (b[k] !== undefined) m[k] = String(b[k]).slice(0, k === 'estilo_escrita' || k === 'descricao' ? 1500 : 120); });
  if (m.handle && !m.handle.startsWith('@')) m.handle = '@' + m.handle.replace(/^@+/, '');
  if (m.cor && !/^#[0-9a-f]{6}$/i.test(m.cor)) delete m.cor;
  for (const k of ['logo', 'foto']) {
    const f = req.files?.[k]?.[0];
    if (f) {
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.mimetype)) return res.status(400).json({ erro: 'Envie PNG, JPG, WEBP ou SVG' });
      m[`${k}_url`] = await store.subirArquivo(req.uid, `${k}.${f.mimetype.split('/')[1].replace('svg+xml', 'svg')}`, f.buffer, f.mimetype);
    }
  }
  const marca = await store.salvarMarca(req.uid, m);
  if (b.concluir === 'true') await store.atualizarPerfil(req.uid, { onboarding_ok: true });
  res.json(marca);
}));

// ----- Planos / assinatura -----
api.post('/assinar', rota(async (req, res) => {
  const plano = (await store.planos()).find(p => p.id === req.body?.plano);
  if (!plano) return res.status(400).json({ erro: 'Escolha um plano' });
  res.json(await pagamento.criarAssinatura({ uid: req.uid, email: req.email, plano }));
}));
// Só para teste (modo demo, sem Mercado Pago): confirma o pagamento da última assinatura pendente
api.post('/teste/simular-pagamento', rota(async (req, res) => {
  if (pagamento.ativo()) return res.status(403).json({ erro: 'Indisponível com o Mercado Pago ativo' });
  const a = await store.assinaturaAtual(req.uid);
  if (!a) return res.status(400).json({ erro: 'Escolha um plano antes' });
  await store.salvarAssinatura({ ...a, status: 'ativo' });
  await pagamento.ativarPlano({ uid: req.uid, planoId: a.plano, referencia: `demo-${a.provedor_id}` });
  res.json(await store.perfil(req.uid));
}));
api.post('/teste/creditos', rota(async (req, res) => {
  if (pagamento.ativo() && process.env.NODE_ENV === 'production') return res.status(403).json({ erro: 'Indisponível em produção' });
  const p = await store.perfil(req.uid);
  const alvo = Math.max(0, Number(req.body?.creditos ?? store.CREDITOS_BOAS_VINDAS));
  if (alvo !== p.creditos) await store.mover(req.uid, alvo - p.creditos, 'teste');
  res.json(await store.perfil(req.uid));
}));

api.get('/historico', rota(async (req, res) => res.json(await store.historico(req.uid))));
api.get('/geracoes/:gid', rota(async (req, res) => { const g = await store.buscar(req.params.gid, req.uid); g ? res.json(g) : res.status(404).json({ erro: 'Não encontrado' }); }));

// Cobra antes; devolve se der erro
async function cobrar(uid, n, motivo) { if (n > 0) await store.mover(uid, -n, motivo); return n; }
async function devolver(uid, n, motivo) { if (n > 0) await store.mover(uid, n, 'estorno ' + motivo).catch(() => {}); }

// ----- Carrossel -----
const urlsSlides = (gid, arquivos) => arquivos.map(f => `/out/${gid}/${f}?v=${Date.now()}`);
api.post('/carrossel', rota(async (req, res) => {
  const marca = await store.marca(req.uid);
  const b = req.body || {};
  const tema = String(b.tema || '').trim();
  if (!tema) return res.status(400).json({ erro: 'Informe o tema' });
  const opts = { template: b.template || 'escuro', cor: b.cor || marca?.cor || '#c6ff3d', handle: b.handle || marca?.handle || '@seuperfil' };
  const custo = store.CUSTO_CREDITOS.carrossel;
  await cobrar(req.uid, custo, 'carrossel');
  try {
    const gid = id();
    const roteiro = await gerarCarrossel({ tema, nicho: b.nicho || marca?.nicho, tom: b.tom || marca?.tom, qtd: b.qtd, marca });
    const arquivos = await renderSlides(roteiro.slides, opts, path.join(OUT, gid));
    fs.writeFileSync(path.join(OUT, gid, 'legenda.txt'), roteiro.legenda || '');
    const g = await store.registrar({ id: gid, usuario_id: req.uid, tipo: 'carrossel', status: 'pronto', creditos: custo, custo_usd: roteiro.custo_usd,
      dados: { tema, opts, slides: roteiro.slides, legenda: roteiro.legenda, arquivos, fonte: roteiro.fonte } });
    console.log(`[custo] carrossel ${gid}: US$ ${roteiro.custo_usd.toFixed(5)}`);
    res.json({ ...g, urls: urlsSlides(gid, arquivos), zip: `/api/carrossel/${gid}/zip`, saldo: (await store.perfil(req.uid)).creditos });
  } catch (e) { await devolver(req.uid, custo, 'carrossel'); throw e; }
}));

api.post('/carrossel/:gid/rerender', rota(async (req, res) => {
  const g = await store.buscar(req.params.gid, req.uid);
  if (!g || g.tipo !== 'carrossel') return res.status(404).json({ erro: 'Não encontrado' });
  const slides = req.body.slides || g.dados.slides;
  const opts = { ...g.dados.opts, ...(req.body.opts || {}) };
  const dir = path.join(OUT, g.id);
  fs.rmSync(dir, { recursive: true, force: true });
  const arquivos = await renderSlides(slides, opts, dir);
  fs.writeFileSync(path.join(dir, 'legenda.txt'), req.body.legenda ?? g.dados.legenda ?? '');
  const novo = await store.atualizar(g.id, { dados: { ...g.dados, slides, opts, arquivos, legenda: req.body.legenda ?? g.dados.legenda } });
  res.json({ ...novo, urls: urlsSlides(g.id, arquivos), zip: `/api/carrossel/${g.id}/zip` });
}));

// ZIP é aberto por link direto (sem cabeçalho de login): o id aleatório funciona como chave
app.get('/api/carrossel/:gid/zip', (req, res) => {
  const dir = path.join(OUT, path.basename(req.params.gid));
  if (!fs.existsSync(dir)) return res.status(404).end();
  res.attachment(`deepcut-${req.params.gid}.zip`);
  const z = archiver('zip'); z.pipe(res);
  fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().forEach(f => z.file(path.join(dir, f), { name: f }));
  if (fs.existsSync(path.join(dir, 'legenda.txt'))) z.file(path.join(dir, 'legenda.txt'), { name: 'legenda.txt' });
  z.finalize();
});

// ----- Edição de vídeo -----
api.post('/video', upload.single('video'), rota(async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie um vídeo' });
  const marca = await store.marca(req.uid);
  const custo = store.CUSTO_CREDITOS.video;
  try { await cobrar(req.uid, custo, 'edição'); } catch (e) { fs.rmSync(req.file.path, { force: true }); throw e; }
  const gid = id(), b = req.body;
  const g = await store.registrar({ id: gid, usuario_id: req.uid, tipo: 'video', status: 'processando', creditos: custo, custo_usd: 0, dados: { nome: req.file.originalname } });
  res.json({ ...g, saldo: (await store.perfil(req.uid)).creditos });
  try {
    const r = await editarVideo({ entrada: req.file.path, outDir: path.join(OUT, gid), cortarSilencio: b.cortarSilencio !== 'false', legendas: b.legendas !== 'false', roteiro: b.roteiro, cor: b.cor || marca?.cor || '#c6ff3d' });
    await store.atualizar(gid, { status: 'pronto', custo_usd: r.custo_usd, dados: { ...g.dados, url: `/out/${gid}/${r.arquivo}`, log: r.log } });
  } catch (e) {
    await devolver(req.uid, custo, 'edição');
    await store.atualizar(gid, { status: 'erro', erro: e.message });
  } finally { fs.rmSync(req.file.path, { force: true }); }
}));

// ----- Avatar com IA -----
const pubAvatar = a => ({ id: a.id, nome: a.nome, criado_em: a.criado_em, foto: `/avatares/${a.id}/${a.foto}`, voz_clonada: !!a.voice_id, fonte_voz: a.fonte_voz, amostra_seg: a.amostra_seg });
api.get('/avatares', rota(async (req, res) => res.json((await store.avatares(req.uid)).map(pubAvatar))));

api.post('/avatares', upload.fields([{ name: 'foto', maxCount: 1 }, { name: 'voz', maxCount: 1 }]), rota(async (req, res) => {
  const foto = req.files?.foto?.[0], voz = req.files?.voz?.[0];
  const limpar = () => [foto, voz].forEach(f => f && fs.rmSync(f.path, { force: true }));
  try {
    if (!foto) return res.status(400).json({ erro: 'Envie uma foto de frente' });
    const custo = (await store.avatares(req.uid)).length ? store.CUSTO_CREDITOS.avatar_extra : 0;
    await cobrar(req.uid, custo, 'avatar');
    try {
      const aid = id();
      const r = await avatar.criarAvatar({ fotoPath: foto.path, vozPath: voz?.path, nome: req.body.nome, dir: path.join(AV, aid) });
      const a = await store.salvarAvatar({ id: aid, usuario_id: req.uid, nome: (req.body.nome || 'Meu avatar').slice(0, 40), ...r });
      res.json({ ...pubAvatar(a), creditos_usados: custo, saldo: (await store.perfil(req.uid)).creditos });
    } catch (e) { await devolver(req.uid, custo, 'avatar'); throw e; }
  } finally { limpar(); }
}));

api.post('/avatar/roteiro', rota(async (req, res) => {
  const marca = await store.marca(req.uid);
  const r = await gerarRoteiroAvatar({ ...(req.body || {}), nicho: req.body?.nicho || marca?.nicho, tom: req.body?.tom || marca?.tom, marca });
  console.log(`[custo] roteiro avatar: US$ ${r.custo_usd.toFixed(5)}`);
  res.json(r);
}));

api.post('/avatar/audio', rota(async (req, res) => {
  const a = await store.buscarAvatar(req.body?.avatarId, req.uid);
  if (!a) return res.status(404).json({ erro: 'Avatar não encontrado' });
  const aud = id();
  const r = await avatar.gerarAudio({ avatar: a, roteiro: req.body.roteiro, dir: path.join(OUT, 'audio-' + aud) });
  console.log(`[custo] áudio avatar ${aud}: US$ ${r.custo_usd.toFixed(5)}`);
  await store.salvarAudio({ id: aud, usuario_id: req.uid, avatar_id: a.id, roteiro: req.body.roteiro, ...r });
  res.json({ id: aud, url: `/out/audio-${aud}/${r.arquivo}`, duracao: r.duracao, fonte: r.fonte, creditos_video: store.creditosAvatar(r.duracao) });
}));

api.post('/avatar/video', rota(async (req, res) => {
  const marca = await store.marca(req.uid);
  const { audioId, estilo = 'classico' } = req.body || {};
  const cor = req.body?.cor || marca?.cor || '#c6ff3d';
  const aud = await store.buscarAudio(audioId, req.uid);
  if (!aud) return res.status(404).json({ erro: 'Gere o áudio antes' });
  if (!avatar.ESTILOS[estilo]) return res.status(400).json({ erro: 'Estilo inválido' });
  const a = await store.buscarAvatar(aud.avatar_id, req.uid);
  const cred = store.creditosAvatar(Number(aud.duracao));
  await cobrar(req.uid, cred, 'avatar vídeo');
  const gid = id();
  const g = await store.registrar({ id: gid, usuario_id: req.uid, tipo: 'avatar', status: 'processando', creditos: cred, custo_usd: aud.custo_usd,
    dados: { avatar: a.nome, estilo, duracao: Number(aud.duracao), roteiro: aud.roteiro } });
  res.json({ ...g, saldo: (await store.perfil(req.uid)).creditos });
  try {
    const r = await avatar.montarVideo({ avatar: a, avatarDir: path.join(AV, a.id), audio: { ...aud, duracao: Number(aud.duracao) }, audioDir: path.join(OUT, 'audio-' + aud.id), estilo, cor, outDir: path.join(OUT, gid) });
    const total = Number(aud.custo_usd) + r.custo_usd;
    console.log(`[custo] avatar ${gid}: US$ ${total.toFixed(4)} (${cred} créditos, ${aud.duracao}s, ${r.fonte})`);
    await store.atualizar(gid, { status: 'pronto', custo_usd: total, dados: { ...g.dados, url: `/out/${gid}/${r.arquivo}`, fonte: r.fonte, voz: aud.fonte } });
  } catch (e) {
    await devolver(req.uid, cred, 'avatar vídeo');
    await store.atualizar(gid, { status: 'erro', erro: e.message });
  }
}));

app.use('/api', api);

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => console.log(`deep cut rodando em http://localhost:${PORT}  (dados: ${store.modo} · IA: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : 'demo'} · pagamento: ${pagamento.ativo() ? 'Mercado Pago' : 'demo'})`));
