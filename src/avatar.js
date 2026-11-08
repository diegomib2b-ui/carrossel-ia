// Avatar com IA: foto + voz clonada → avatar fala o roteiro → vídeo vertical com legenda.
// Provedores (todos opcionais; sem chave roda em modo demo, custo zero):
//   Voz:      ElevenLabs (clonagem instantânea + TTS com marcação de tempo por letra)
//   Lip-sync: fal.ai (padrão: Kling AI Avatar v2 Standard, cobrado por segundo de vídeo)
const fs = require('fs');
const path = require('path');
const { run, duracao, gerarASS, tempo, hexAss } = require('./video');

const W = 1080, H = 1920;
const MAX_CHARS = 900; // ~60 s de fala: limita o custo por vídeo
const VOZ_MODELO = process.env.ELEVEN_MODEL || 'eleven_flash_v2_5'; // flash = metade do preço do multilingual
const PRECO_VOZ_1K = Number(process.env.PRECO_VOZ_1K_CHARS || 0.15); // US$ por 1.000 caracteres
const FAL_MODELO = process.env.FAL_AVATAR_MODEL || 'fal-ai/kling-video/ai-avatar/v2/standard';
const PRECO_LIPSYNC_SEG = Number(process.env.PRECO_LIPSYNC_SEG || 0.0562); // US$ por segundo de vídeo

const temVoz = () => !!process.env.ELEVENLABS_API_KEY;
const temLipsync = () => !!process.env.FAL_KEY;

// ---------- 1) Criar avatar ----------
// Normaliza a foto (máx. 1280 px, JPG) e extrai a amostra de voz em MP3 (aceita áudio ou vídeo).
async function criarAvatar({ fotoPath, vozPath, nome, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const foto = path.join(dir, 'foto.jpg');
  await run('ffmpeg', ['-y', '-i', fotoPath, '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', foto]);
  let voice_id = null, voz = null, amostra_seg = 0;
  if (vozPath) {
    voz = path.join(dir, 'voz.mp3');
    await run('ffmpeg', ['-y', '-i', vozPath, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', '-t', '180', voz]);
    amostra_seg = +(await duracao(voz)).toFixed(1);
    if (amostra_seg < 10) throw Object.assign(new Error(`A amostra de voz tem ${amostra_seg}s. Envie pelo menos 20 segundos falando.`), { status: 400 });
    if (temVoz()) voice_id = await clonarVoz(voz, nome);
  }
  return { foto: 'foto.jpg', voz: voz ? 'voz.mp3' : null, voice_id, amostra_seg, fonte_voz: voice_id ? 'elevenlabs' : 'demo' };
}

async function clonarVoz(arquivo, nome) {
  const form = new FormData();
  form.append('name', `carrossel-ia ${nome || ''}`.trim());
  form.append('files', new Blob([fs.readFileSync(arquivo)], { type: 'audio/mpeg' }), 'voz.mp3');
  const r = await fetch('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form });
  if (!r.ok) throw new Error(`ElevenLabs (clonar voz) ${r.status}: ${await r.text()}`);
  return (await r.json()).voice_id;
}

// ---------- 2) Áudio do roteiro (prévia antes de gastar com o vídeo) ----------
// Devolve o MP3 + o tempo de cada palavra (usado na legenda e no estilo "Dados").
async function gerarAudio({ avatar, roteiro, dir }) {
  const texto = String(roteiro || '').replace(/\s+/g, ' ').trim();
  if (!texto) throw Object.assign(new Error('Escreva o roteiro'), { status: 400 });
  if (texto.length > MAX_CHARS) throw Object.assign(new Error(`Roteiro com ${texto.length} caracteres. Máximo ${MAX_CHARS} (~60 s).`), { status: 400 });
  fs.mkdirSync(dir, { recursive: true });
  const mp3 = path.join(dir, 'fala.mp3');
  if (temVoz() && avatar.voice_id) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${avatar.voice_id}/with-timestamps`, {
      method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text: texto, model_id: VOZ_MODELO, language_code: 'pt' })
    });
    if (!r.ok) throw new Error(`ElevenLabs (voz) ${r.status}: ${await r.text()}`);
    const j = await r.json();
    fs.writeFileSync(mp3, Buffer.from(j.audio_base64, 'base64'));
    const palavras = palavrasDoAlinhamento(j.alignment || j.normalized_alignment);
    return { arquivo: 'fala.mp3', duracao: +(await duracao(mp3)).toFixed(2), palavras, custo_usd: texto.length / 1000 * PRECO_VOZ_1K, fonte: 'elevenlabs' };
  }
  // Demo: áudio mudo com a duração de uma fala normal (~2,6 palavras/s) e tempos estimados
  const tokens = texto.split(' ');
  const dur = Math.max(3, tokens.length / 2.6);
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', dur.toFixed(2), '-b:a', '64k', mp3]);
  const pesos = tokens.map(t => t.length + 2), soma = pesos.reduce((a, b) => a + b, 0);
  let t = 0;
  const palavras = tokens.map((w, i) => { const d = dur * pesos[i] / soma; const o = { w, s: t, e: t + d }; t += d; return o; });
  return { arquivo: 'fala.mp3', duracao: +dur.toFixed(2), palavras, custo_usd: 0, fonte: 'demo' };
}

// Junta letras em palavras usando o tempo de início/fim de cada caractere
function palavrasDoAlinhamento(al) {
  const out = []; let atual = null;
  al.characters.forEach((c, i) => {
    if (/\s/.test(c)) { if (atual) out.push(atual); atual = null; return; }
    if (!atual) atual = { w: '', s: al.character_start_times_seconds[i], e: 0 };
    atual.w += c; atual.e = al.character_end_times_seconds[i];
  });
  if (atual) out.push(atual);
  return out;
}

// ---------- 3) Vídeo do avatar ----------
async function lipsyncFal(fotoPath, audioPath) {
  const dataUri = (f, mime) => `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
  const auth = { Authorization: `Key ${process.env.FAL_KEY}` };
  const r = await fetch(`https://queue.fal.run/${FAL_MODELO}`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ image_url: dataUri(fotoPath, 'image/jpeg'), audio_url: dataUri(audioPath, 'audio/mpeg') })
  });
  if (!r.ok) throw new Error(`fal.ai ${r.status}: ${await r.text()}`);
  const { status_url, response_url } = await r.json();
  // Fila: consulta o status até terminar (máx. ~15 min)
  for (let i = 0; i < 300; i++) {
    await new Promise(ok => setTimeout(ok, 3000));
    const s = await (await fetch(status_url, { headers: auth })).json();
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED' || s.error || s.detail) throw new Error('fal.ai falhou: ' + JSON.stringify(s).slice(0, 300));
  }
  const res = await (await fetch(response_url, { headers: auth })).json();
  if (res.detail) throw new Error('fal.ai: ' + JSON.stringify(res.detail).slice(0, 300));
  const url = res.video?.url;
  if (!url) throw new Error('fal.ai não devolveu vídeo: ' + JSON.stringify(res).slice(0, 300));
  const v = await fetch(url);
  return Buffer.from(await v.arrayBuffer());
}

// Demo: a foto com zoom lento (efeito "Ken Burns") no lugar da boca mexendo
async function animacaoDemo(fotoPath, dur, saida) {
  const frames = Math.ceil(dur * 30);
  await run('ffmpeg', ['-y', '-loop', '1', '-framerate', '30', '-i', fotoPath, '-t', dur.toFixed(2),
    '-vf', `scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5},zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', saida]);
}

// Legenda em caixa preta no topo (igual aos anúncios de avatar) — blocos de 3 palavras
function assCaixa(palavras, porBloco = 3) {
  const fs_ = 84;
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caixa,Inter,${fs_},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,14,0,8,80,80,${Math.round(H * 0.17)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const linhas = [];
  for (let i = 0; i < palavras.length; i += porBloco) {
    const b = palavras.slice(i, i + porBloco);
    const fim = palavras[i + porBloco] ? palavras[i + porBloco].s : b[b.length - 1].e;
    linhas.push(`Dialogue: 0,${tempo(b[0].s)},${tempo(fim)},Caixa,,0,0,0,,${b.map(p => p.w.toUpperCase()).join(' ')}`);
  }
  return head + linhas.join('\n') + '\n';
}

// Estilo "Dados": quando o avatar fala um número, ele aparece gigante no topo
function eventosNumeros(palavras, cor) {
  const ev = [];
  palavras.forEach((p, i) => {
    if (!/\d/.test(p.w)) return;
    let txt = p.w.replace(/[.,;:!?]+$/, '');
    const prox = palavras[i + 1]?.w.replace(/[.,;:!?]+$/, '') || '';
    if (/^(%|mil|milhões|milhão|bilhões|reais|anos|meses|semanas|dias|horas?|minutos|segundos|vezes|pessoas|clientes|x)$/i.test(prox)) txt += prox === '%' ? '%' : ' ' + prox;
    ev.push(`Dialogue: 1,${tempo(p.s)},${tempo(p.e + 1.6)},Numero,,0,0,0,,{\\fad(120,200)\\c${hexAss(cor)}}${txt.toUpperCase()}`);
  });
  return ev;
}
const estiloNumero = `Style: Numero,Inter,190,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,-2,0,1,8,6,8,60,60,${Math.round(H * 0.12)},1\n`;

const ESTILOS = {
  classico: 'Clássico — legenda palavra por palavra embaixo',
  gancho: 'Gancho — frases em caixa preta no topo',
  dados: 'Dados — números falados aparecem gigantes'
};

async function montarVideo({ avatar, avatarDir, audio, audioDir, estilo = 'classico', cor = '#c6ff3d', outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const foto = path.join(avatarDir, avatar.foto), mp3 = path.join(audioDir, audio.arquivo);
  const base = path.join(outDir, 'base.mp4');
  let custo = 0, fonte;
  if (temLipsync()) {
    fs.writeFileSync(path.join(outDir, 'lipsync.mp4'), await lipsyncFal(foto, mp3));
    // Enquadra em 9:16 (1080x1920) sem distorcer
    await run('ffmpeg', ['-y', '-i', path.join(outDir, 'lipsync.mp4'), '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', base]);
    custo += audio.duracao * PRECO_LIPSYNC_SEG; fonte = FAL_MODELO;
  } else {
    await animacaoDemo(foto, audio.duracao, base); fonte = 'demo (sem lip-sync)';
  }
  // Legenda conforme o estilo
  let ass;
  if (estilo === 'gancho') ass = assCaixa(audio.palavras);
  else {
    ass = gerarASS(audio.palavras, { w: W, h: H, cor });
    if (estilo === 'dados') {
      const ev = eventosNumeros(audio.palavras, cor);
      ass = ass.replace('\n[Events]', estiloNumero + '\n[Events]') + (ev.length ? ev.join('\n') + '\n' : '');
    }
  }
  const assPath = path.join(outDir, 'legenda.ass');
  fs.writeFileSync(assPath, ass);
  await run('ffmpeg', ['-y', '-i', base, '-i', mp3, '-map', '0:v', '-map', '1:a', '-vf', `ass=${assPath}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', path.join(outDir, 'final.mp4')]);
  fs.rmSync(base, { force: true });
  return { arquivo: 'final.mp4', custo_usd: custo, fonte };
}

module.exports = { criarAvatar, gerarAudio, montarVideo, ESTILOS, MAX_CHARS, temVoz, temLipsync, PRECO_LIPSYNC_SEG };
