// Geração do roteiro do carrossel. Usa Claude (modelo barato) se houver chave; senão, modo demo local (custo zero).
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
// Preço por 1 milhão de tokens (US$) — ajuste no .env conforme a tabela atual da Anthropic
const PRECO_IN = Number(process.env.PRECO_IN_MTOK || 1);
const PRECO_OUT = Number(process.env.PRECO_OUT_MTOK || 5);

function prompt({ tema, nicho, tom, qtd }) {
  return `Você é um copywriter de Instagram brasileiro especialista em carrosséis que viralizam.
Crie um carrossel com EXATAMENTE ${qtd} slides sobre: "${tema}".
Nicho: ${nicho || 'geral'}. Tom: ${tom || 'direto'}.
Regras:
- Slide 1: gancho forte (curiosidade, número ou dor), título com no máx. 8 palavras.
- Slides do meio: 1 ideia por slide, título curto + texto de no máx. 30 palavras, prático.
- Último slide: CTA (salvar, compartilhar, comentar ou seguir).
- Em cada título, marque entre *asteriscos* 1 a 2 palavras para destacar.
- Português do Brasil, sem emojis em excesso.
Responda SOMENTE com JSON válido: {"legenda":"legenda do post com 3-5 hashtags","slides":[{"titulo":"...","texto":"..."}]}`;
}

async function viaClaude(params) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt(params) }] })
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const txt = data.content.map(c => c.text || '').join('');
  const json = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const custo = (data.usage.input_tokens * PRECO_IN + data.usage.output_tokens * PRECO_OUT) / 1e6;
  return { ...json, custo_usd: custo, fonte: MODEL };
}

// Modo demo: estrutura fixa, para testar o fluxo sem gastar API
function viaDemo({ tema, qtd }) {
  const meio = Array.from({ length: Math.max(1, qtd - 2) }, (_, i) => ({
    titulo: `Passo ${i + 1}: *ponto-chave* ${i + 1}`,
    texto: `Aqui entra a ideia ${i + 1} sobre "${tema}". Com a chave da API configurada, este texto é escrito pela IA de forma prática e direta.`
  }));
  return {
    legenda: `Tudo sobre ${tema} em ${qtd} slides. Salva pra não esquecer! #dicas #empreendedorismo #conteudo`,
    slides: [
      { titulo: `O que ninguém te conta sobre *${tema}*`, texto: 'Arrasta para o lado →' },
      ...meio,
      { titulo: 'Gostou? *Salva* esse post', texto: 'Compartilha com quem precisa ver isso e me segue para mais.' }
    ],
    custo_usd: 0, fonte: 'demo'
  };
}

async function gerarCarrossel(params) {
  const qtd = Math.min(10, Math.max(3, Number(params.qtd) || 6));
  const p = { ...params, qtd };
  const out = process.env.ANTHROPIC_API_KEY ? await viaClaude(p) : viaDemo(p);
  out.slides = out.slides.slice(0, qtd);
  return out;
}

module.exports = { gerarCarrossel };
