const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./src/store');
const { gerarCarrossel } = require('./src/ai');
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
  res.json({ ...u, custos: store.CUSTO_CREDITOS, templates: TEMPLATES, ia: !!process.env.ANTHROPIC_API_KEY, whisper: !!process.env.OPENAI_API_KEY });
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

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => console.log(`Carrossel IA rodando em http://localhost:${PORT}  (IA: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : 'demo'})`));
