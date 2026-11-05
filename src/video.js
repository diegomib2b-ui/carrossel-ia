// Editor de vídeo: corta silêncios (FFmpeg) e queima legendas estilo Reels (palavra ativa destacada).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PRECO_WHISPER_MIN = Number(process.env.PRECO_WHISPER_MIN || 0.006); // US$/minuto, ajustável

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args); let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? res({ out, err }) : rej(new Error(`${cmd} falhou: ${err.slice(-600)}`)));
  });
}

async function duracao(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(out);
}
async function temAudio(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return out.trim().length > 0;
}

// 1) Detecta trechos de silêncio e devolve os trechos com fala
async function trechosComFala(file, total, { ruido = -35, minSilencio = 0.6, folga = 0.12 } = {}) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', `silencedetect=noise=${ruido}dB:d=${minSilencio}`, '-f', 'null', '-']);
  const silencios = []; let ini = null;
  for (const l of err.split('\n')) {
    const s = l.match(/silence_start: ([\d.]+)/); if (s) ini = parseFloat(s[1]);
    const e = l.match(/silence_end: ([\d.]+)/); if (e && ini !== null) { silencios.push([ini, parseFloat(e[1])]); ini = null; }
  }
  if (ini !== null) silencios.push([ini, total]);
  const fala = []; let cursor = 0;
  for (const [a, b] of silencios) {
    if (a - cursor > 0.05) fala.push([Math.max(0, cursor - folga), Math.min(total, a + folga)]);
    cursor = b;
  }
  if (total - cursor > 0.05) fala.push([Math.max(0, cursor - folga), total]);
  return { fala, silencios };
}

async function cortar(file, trechos, saida) {
  const parts = trechos.map(([a, b], i) =>
    `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS[a${i}];`).join('');
  const concat = trechos.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${trechos.length}:v=1:a=1[v][a]`;
  await run('ffmpeg', ['-y', '-i', file, '-filter_complex', parts + concat, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', saida]);
}

// 2) Transcrição: Whisper (OpenAI) se houver chave; senão usa o roteiro colado (ex.: do teleprompter) distribuído no tempo
async function transcrever(file, roteiro, dur) {
  if (process.env.OPENAI_API_KEY) {
    const audio = file.replace(/\.\w+$/, '.mp3');
    await run('ffmpeg', ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]);
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(audio)]), 'audio.mp3');
    form.append('model', 'whisper-1'); form.append('language', 'pt');
    form.append('response_format', 'verbose_json'); form.append('timestamp_granularities[]', 'word');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (!r.ok) throw new Error(`Whisper ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return { palavras: j.words.map(w => ({ w: w.word.trim(), s: w.start, e: w.end })), custo_usd: (dur / 60) * PRECO_WHISPER_MIN, fonte: 'whisper' };
  }
  const tokens = String(roteiro || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return { palavras: [], custo_usd: 0, fonte: 'nenhuma' };
  // Distribui proporcional ao tamanho de cada palavra (palavra longa = mais tempo falando)
  const pesos = tokens.map(t => t.length + 2), soma = pesos.reduce((a, b) => a + b, 0);
  let t = 0;
  const palavras = tokens.map((w, i) => { const d = dur * pesos[i] / soma; const o = { w, s: t, e: t + d }; t += d; return o; });
  return { palavras, custo_usd: 0, fonte: 'roteiro' };
}

// 3) Gera arquivo .ass (formato de legenda com estilo) — blocos de 3 palavras, a palavra falada fica destacada
const tempo = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}`; };
const hexAss = hex => { const h = hex.replace('#', ''); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };

function gerarASS(palavras, { w, h, cor = '#ffe95c', porBloco = 3 }) {
  const fs_ = Math.round(h * 0.047);
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Reels,Inter,${fs_},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(fs_ / 9)},2,2,60,60,${Math.round(h * 0.22)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const linhas = [];
  for (let i = 0; i < palavras.length; i += porBloco) {
    const bloco = palavras.slice(i, i + porBloco);
    bloco.forEach((p, j) => {
      const fim = j < bloco.length - 1 ? bloco[j + 1].s : p.e;
      const txt = bloco.map((q, k) => k === j ? `{\\c${hexAss(cor)}\\fscx106\\fscy106}${q.w.toUpperCase()}{\\r}` : q.w.toUpperCase()).join(' ');
      linhas.push(`Dialogue: 0,${tempo(p.s)},${tempo(fim)},Reels,,0,0,0,,${txt}`);
    });
  }
  return head + linhas.join('\n') + '\n';
}

async function dimensoes(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]);
  const [w, h] = out.trim().split('x').map(Number); return { w, h };
}

async function editarVideo({ entrada, outDir, cortarSilencio = true, legendas = true, roteiro = '', cor }) {
  fs.mkdirSync(outDir, { recursive: true });
  const total = await duracao(entrada);
  const audio = await temAudio(entrada);
  const log = { duracao_original: +total.toFixed(2) };
  let atual = entrada;

  if (cortarSilencio && audio) {
    const { fala } = await trechosComFala(entrada, total);
    if (fala.length && fala.reduce((a, [x, y]) => a + y - x, 0) < total - 0.3) {
      atual = path.join(outDir, 'cortado.mp4');
      await cortar(entrada, fala, atual);
    }
    log.trechos = fala.length;
  }
  const dur = await duracao(atual);
  log.duracao_final = +dur.toFixed(2);
  log.segundos_removidos = +(total - dur).toFixed(2);

  let custo = 0;
  if (legendas) {
    const tr = await transcrever(atual, roteiro, dur);
    custo += tr.custo_usd; log.transcricao = tr.fonte; log.palavras = tr.palavras.length;
    if (tr.palavras.length) {
      const { w, h } = await dimensoes(atual);
      const ass = path.join(outDir, 'legenda.ass');
      fs.writeFileSync(ass, gerarASS(tr.palavras, { w, h, cor }));
      const saida = path.join(outDir, 'final.mp4');
      await run('ffmpeg', ['-y', '-i', atual, '-vf', `ass=${ass}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'copy', saida]);
      atual = saida;
    }
  }
  if (path.basename(atual) !== 'final.mp4') { fs.copyFileSync(atual, path.join(outDir, 'final.mp4')); }
  return { arquivo: 'final.mp4', custo_usd: custo, log };
}

module.exports = { editarVideo };
