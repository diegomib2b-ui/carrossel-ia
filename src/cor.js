// Contraste automático: decide a cor do texto (preto ou branco) a partir da cor da marca.
// Ex.: destaque preto → texto branco; destaque amarelo → texto preto.
function luminancia(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return 0.5;
  const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const textoSobre = hex => (luminancia(hex) > 0.4 ? '#111111' : '#ffffff');
// Para legendas em vídeo (contorno preto): cor escura demais some, então usa o lima da marca
const corLegivelEmVideo = hex => (luminancia(hex) < 0.12 ? '#c6ff3d' : hex);
module.exports = { luminancia, textoSobre, corLegivelEmVideo };
