const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./src/store');
const { gerarCarrossel, gerarRoteiroAvatar } = require('./src/ai');
const avatar = require('./src/avatar');
const { renderSlides } = require('./src/render');
const { editarVideo } = require('./src/video');
const { TEMPLATES } = require('./src/templates');

const app = express();
const OUT = path.join(store.DATA_DIR, 'out');
const upload = multer({ dest: path.join(store.DATA_DIR, 'uploads'), limits: { fileSize: 200 * 1024 * 1024 } });
const id = () => crypto.randomBytes(5).toString('hex');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/out', express.static(OUT));

const urlsSlides = (gid, arquivos) => arquivos.map(f => `/out/${gid}/${f}?v=${Date.now()}`);

app.get('/api/me', (req, res) => {
  const u = store.usuario();
  res.json({ ...u, custos: store.CUSTO_CREDITOS, templates: TEMPLATES, ia: !!process.env.ANTHROPIC_API_KEY, whisper: !!process.env.OPENAI_API_KEY,
    voz: avatar.temVoz(), lipsync: avatar.temLipsync(), estilos: avatar.ESTILOS, max_chars: avatar.MAX_CHARS });
});
app.get('/api/historico', (req, res) => res.json(store.historico()));
app.post('/api/creditos/reset', (req, res) => { store.resetCreditos(); res.json(store.usuario()); });

// Gera carrossel (1 crédito)
app.post('/api/carrossel', async (req, res) => {
  const { tema, nicho, tom, qtd, template = 'escuro', cor = '#ffe95c', handle = '@seuperfil' } = req.body || {};
  if (!tema || !tema.trim()) return res.status(400).json({ erro: 'Informe o tema' });
  let debitado = false;
  try {
    store.debitar('demo', 'carrossel'); debitado = true;
    const gid = id();
    const roteiro = await gerarCarrossel({ tema, nicho, tom, qtd });
    const opts = { template, cor, handle };
    const arquivos = await renderSlides(roteiro.slides, opts, path.join(OUT, gid));
    const g = store.registrar({ id: gid, tipo: 'carrossel', status: 'pronto', creditos: store.CUSTO_CREDITOS.carrossel,
      custo_usd: roteiro.custo_usd, dados: { tema, nicho, tom, opts, slides: roteiro.slides, legenda: roteiro.legenda, arquivos, fonte: roteiro.fonte } });
    res.json({ ...g, urls: urlsSlides(gid, arquivos), zip: `/api/carrossel/${gid}/zip`, saldo: store.usuario().creditos });
  } catch (e) {
    if (debitado) store.estornar('demo', 'carrossel');
    res.status(e.status || 500).json({ erro: e.message });
  }
});

// Re-renderiza com textos editados / outro visual (grátis — não chama IA)
app.post('/api/carrossel/:gid/rerender', async (req, res) => {
  const g = store.buscar(req.params.gid);
  if (!g || g.tipo !== 'carrossel') return res.status(404).json({ erro: 'Não encontrado' });
  try {
    const slides = req.body.slides || g.dados.slides;
    const opts = { ...g.dados.opts, ...(req.body.opts || {}) };
    const dir = path.join(OUT, g.id);
    fs.rmSync(dir, { recursive: true, force: true });
    const arquivos = await renderSlides(slides, opts, dir);
    store.atualizar(g.id, { dados: { ...g.dados, slides, opts, arquivos } });
    res.json({ ...store.buscar(g.id), urls: urlsSlides(g.id, arquivos), zip: `/api/carrossel/${g.id}/zip` });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/carrossel/:gid/zip', (req, res) => {
  const g = store.buscar(req.params.gid);
  if (!g) return res.status(404).end();
  res.attachment(`carrossel-${g.id}.zip`);
  const z = archiver('zip'); z.pipe(res);
  g.dados.arquivos.forEach(f => z.file(path.join(OUT, g.id, f), { name: f }));
  z.append(g.dados.legenda || '', { name: 'legenda.txt' });
  z.finalize();
});

// Edição de vídeo (3 créditos) — processa em segundo plano; o front consulta o status
app.post('/api/video', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Envie um vídeo' });
  try { store.debitar('demo', 'video'); } catch (e) { fs.rmSync(req.file.path, { force: true }); return res.status(e.status || 500).json({ erro: e.message }); }
  const gid = id();
  const b = req.body;
  const g = store.registrar({ id: gid, tipo: 'video', status: 'processando', creditos: store.CUSTO_CREDITOS.video, custo_usd: 0, dados: { nome: req.file.originalname } });
  res.json({ ...g, saldo: store.usuario().creditos });
  try {
    const r = await editarVideo({ entrada: req.file.path, outDir: path.join(OUT, gid),
      cortarSilencio: b.cortarSilencio !== 'false', legendas: b.legendas !== 'false', roteiro: b.roteiro, cor: b.cor || '#ffe95c' });
    store.atualizar(gid, { status: 'pronto', custo_usd: r.custo_usd, dados: { ...g.dados, url: `/out/${gid}/${r.arquivo}`, log: r.log } });
  } catch (e) {
    store.estornar('demo', 'video');
    store.atualizar(gid, { status: 'erro', erro: e.message });
  } finally { fs.rmSync(req.file.path, { force: true }); }
});
app.get('/api/geracoes/:gid', (req, res) => { const g = store.buscar(req.params.gid); g ? res.json(g) : res.status(404).end(); });


// ================= Avatar com IA =================
const AV = path.join(store.DATA_DIR, 'avatares');
app.use('/avatares', express.static(AV));
const pubAvatar = a => ({ id: a.id, nome: a.nome, criado_em: a.criado_em, foto: `/avatares/${a.id}/${a.foto}`, voz_clonada: !!a.voice_id, fonte_voz: a.fonte_voz, amostra_seg: a.amostra_seg });

app.get('/api/avatares', (req, res) => res.json(store.avatares().map(pubAvatar)));

// Cria avatar: foto + amostra de voz (áudio ou vídeo). O 1º é grátis; os seguintes custam créditos.
app.post('/api/avatares', upload.fields([{ name: 'foto', maxCount: 1 }, { name: 'voz', maxCount: 1 }]), async (req, res) => {
  const foto = req.files?.foto?.[0], voz = req.files?.voz?.[0];
  const limpar = () => [foto, voz].forEach(f => f && fs.rmSync(f.path, { force: true }));
  if (!foto) { limpar(); return res.status(400).json({ erro: 'Envie uma foto de frente' }); }
  const custo = store.avatares().length ? store.CUSTO_CREDITOS.avatar_extra : 0;
  let debitado = 0;
  try {
    if (custo) debitado = store.debitarN('demo', custo);
    const aid = id();
    const r = await avatar.criarAvatar({ fotoPath: foto.path, vozPath: voz?.path, nome: req.body.nome, dir: path.join(AV, aid) });
    const a = store.salvarAvatar({ id: aid, nome: (req.body.nome || 'Meu avatar').slice(0, 40), ...r });
    res.json({ ...pubAvatar(a), creditos_usados: custo, saldo: store.usuario().creditos });
  } catch (e) {
    if (debitado) store.estornarN('demo', debitado);
    res.status(e.status || 500).json({ erro: e.message });
  } finally { limpar(); }
});

// Roteiro escrito pela IA (grátis — custo de API desprezível, registrado no log)
app.post('/api/avatar/roteiro', async (req, res) => {
  try { const r = await gerarRoteiroAvatar(req.body || {}); console.log(`[custo] roteiro avatar: US$ ${r.custo_usd.toFixed(5)}`); res.json(r); }
  catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

// Prévia do áudio: o cliente ouve antes de gastar créditos com o vídeo
app.post('/api/avatar/audio', async (req, res) => {
  const a = store.buscarAvatar(req.body?.avatarId);
  if (!a) return res.status(404).json({ erro: 'Avatar não encontrado' });
  try {
    const aud = id();
    const r = await avatar.gerarAudio({ avatar: a, roteiro: req.body.roteiro, dir: path.join(OUT, 'audio-' + aud) });
    console.log(`[custo] áudio avatar ${aud}: US$ ${r.custo_usd.toFixed(5)}`);
    store.salvarAudio({ id: aud, avatar_id: a.id, roteiro: req.body.roteiro, ...r });
    res.json({ id: aud, url: `/out/audio-${aud}/${r.arquivo}`, duracao: r.duracao, fonte: r.fonte, creditos_video: store.creditosAvatar(r.duracao) });
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

// Gera o vídeo do avatar (créditos pela duração; roda em segundo plano)
app.post('/api/avatar/video', async (req, res) => {
  const { audioId, estilo = 'classico', cor = '#ffe95c' } = req.body || {};
  const aud = store.buscarAudio(audioId);
  if (!aud) return res.status(404).json({ erro: 'Gere o áudio antes' });
  const a = store.buscarAvatar(aud.avatar_id);
  if (!avatar.ESTILOS[estilo]) return res.status(400).json({ erro: 'Estilo inválido' });
  const cred = store.creditosAvatar(aud.duracao);
  try { store.debitarN('demo', cred); } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
  const gid = id();
  const g = store.registrar({ id: gid, tipo: 'avatar', status: 'processando', creditos: cred, custo_usd: aud.custo_usd,
    dados: { avatar: a.nome, estilo, duracao: aud.duracao, roteiro: aud.roteiro } });
  res.json({ ...g, saldo: store.usuario().creditos });
  try {
    const r = await avatar.montarVideo({ avatar: a, avatarDir: path.join(AV, a.id), audio: aud, audioDir: path.join(OUT, 'audio-' + aud.id), estilo, cor, outDir: path.join(OUT, gid) });
    const total = aud.custo_usd + r.custo_usd;
    console.log(`[custo] avatar ${gid}: US$ ${total.toFixed(4)} (${cred} créditos, ${aud.duracao}s, ${r.fonte})`);
    store.atualizar(gid, { status: 'pronto', custo_usd: total, dados: { ...g.dados, url: `/out/${gid}/${r.arquivo}`, fonte: r.fonte, voz: aud.fonte } });
  } catch (e) {
    store.estornarN('demo', cred);
    store.atualizar(gid, { status: 'erro', erro: e.message });
  }
});

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => console.log(`Carrossel IA rodando em http://localhost:${PORT}  (IA: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : 'demo'})`));
