// Geração do roteiro do carrossel. Usa Claude (modelo barato) se houver chave; senão, modo demo local (custo zero).
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
// Preço por 1 milhão de tokens (US$) — ajuste no .env conforme a tabela atual da Anthropic
const PRECO_IN = Number(process.env.PRECO_IN_MTOK || 1);
const PRECO_OUT = Number(process.env.PRECO_OUT_MTOK || 5);

// Contexto da marca do cliente (vem do onboarding) para a IA escrever do jeito dele
function contextoMarca(m) {
  if (!m) return '';
  const l = [m.nome && `Marca: ${m.nome}`, m.descricao && `Sobre o negócio: ${m.descricao}`, m.publico && `Público: ${m.publico}`,
    m.estilo_escrita && `Exemplo do jeito que a marca escreve (imite o estilo, não copie): "${String(m.estilo_escrita).slice(0, 600)}"`].filter(Boolean);
  return l.length ? '\n' + l.join('\n') : '';
}

function prompt({ tema, nicho, tom, qtd, marca }) {
  return `Você é um copywriter de Instagram brasileiro especialista em carrosséis que viralizam.
Crie um carrossel com EXATAMENTE ${qtd} slides sobre: "${tema}".
Nicho: ${nicho || 'geral'}. Tom: ${tom || 'direto'}.${contextoMarca(marca)}
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

// Roteiro falado para o avatar (Reels de 20–60 s)
async function gerarRoteiroAvatar({ tema, nicho, tom, segundos = 30, marca }) {
  if (!tema || !String(tema).trim()) throw Object.assign(new Error('Informe o tema'), { status: 400 });
  const palavras = Math.round(Math.min(60, Math.max(15, Number(segundos) || 30)) * 2.6);
  if (!process.env.ANTHROPIC_API_KEY) {
    return { roteiro: `${tema.charAt(0).toUpperCase() + tema.slice(1)}: presta atenção nesses 3 erros. Primeiro: demorar pra responder. 70% das pessoas desistem se a resposta passa de 1 hora. Segundo: não mostrar preço. Terceiro: não pedir a venda. Corrige esses 3 e me conta o resultado nos comentários.`, custo_usd: 0, fonte: 'demo' };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, messages: [{ role: 'user', content:
`Escreva o roteiro FALADO de um Reels sobre "${tema}" (nicho: ${nicho || 'geral'}, tom: ${tom || 'direto'}), com cerca de ${palavras} palavras.${contextoMarca(marca)}
Primeira frase = gancho forte. Frases curtas, linguagem falada do Brasil, 1 dado numérico se fizer sentido, termina com CTA.
Responda SOMENTE com o texto que será falado, sem títulos, marcações ou emojis.` }] })
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return { roteiro: d.content.map(c => c.text || '').join('').trim(), custo_usd: (d.usage.input_tokens * PRECO_IN + d.usage.output_tokens * PRECO_OUT) / 1e6, fonte: MODEL };
}

module.exports = { gerarCarrossel, gerarRoteiroAvatar };
