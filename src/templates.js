// Templates de slide 1080x1350 (formato retrato do Instagram). Cada um vira PNG via Puppeteer.
const { luminancia, textoSobre } = require('./cor');
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// *palavra* -> <mark>palavra</mark>
const destacar = s => esc(s).replace(/\*(.+?)\*/g, '<mark>$1</mark>');

const TEMAS = {
  escuro:   { bg: 'radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--cor) 16%, #0a0a0c) 0%, #0a0a0c 60%)', txt: '#ffffff', sub: '#b7b7bf', markBg: 'var(--cor)', markTxt: 'auto', fundo: '#0a0a0c' },
  claro:    { bg: '#f7f5f0', txt: '#141414', sub: '#555', markBg: 'var(--cor)', markTxt: 'auto', fundo: '#f7f5f0' },
  colorido: { bg: 'linear-gradient(150deg, var(--cor) 0%, #7b4dff 55%, #ff7a45 100%)', txt: '#ffffff', sub: 'rgba(255,255,255,.85)', markBg: '#fff', markTxt: '#111' }
};

function slideHTML({ slide, i, total, template = 'escuro', cor = '#c6ff3d', handle = '@seuperfil' }) {
  const t = TEMAS[template] || TEMAS.escuro;
  const capa = i === 0, final = i === total - 1;
  const markTxt = t.markTxt === 'auto' ? textoSobre(cor) : t.markTxt;
  // Se a cor quase some no fundo (preto no escuro, branco no claro), o destaque ganha um contorno
  const pertoDoFundo = t.fundo && Math.abs(luminancia(cor) - luminancia(t.fundo)) < 0.12;
  const contorno = pertoDoFundo ? `box-shadow:0 0 0 3px ${t.txt}33;` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  :root{--cor:${esc(cor)}}
  body{width:1080px;height:1350px;font-family:'Inter','DejaVu Sans',sans-serif;background:${t.bg};color:${t.txt};
       padding:96px 88px;display:flex;flex-direction:column;justify-content:${capa ? 'center' : 'flex-start'};position:relative;overflow:hidden}
  .num{font-size:30px;font-weight:600;color:${t.sub};letter-spacing:4px;margin-bottom:48px}
  h1{font-family:'Inter Display','Inter',sans-serif;font-weight:800;line-height:1.05;letter-spacing:-2px;
     font-size:${capa ? 104 : 76}px;margin-bottom:44px}
  mark{background:${t.markBg};color:${markTxt};${contorno}padding:0 14px;border-radius:14px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
  p{font-size:${capa ? 40 : 44}px;line-height:1.45;color:${t.sub};font-weight:400;max-width:900px}
  .rodape{position:absolute;left:88px;right:88px;bottom:72px;display:flex;justify-content:space-between;font-size:30px;font-weight:600;color:${t.sub}}
  .barra{position:absolute;left:0;bottom:0;height:12px;background:${t.markBg};width:${((i + 1) / total) * 100}%}
  </style></head><body>
  ${capa ? '' : `<div class="num">${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div>`}
  <h1>${destacar(slide.titulo)}</h1>
  <p>${esc(slide.texto)}</p>
  <div class="rodape"><span>${esc(handle)}</span><span>${final ? 'salva ★' : 'arrasta →'}</span></div>
  <div class="barra"></div>
  </body></html>`;
}

module.exports = { slideHTML, TEMPLATES: Object.keys(TEMAS) };
