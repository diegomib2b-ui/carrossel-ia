// Assinaturas com Mercado Pago (preapproval = cobrança mensal recorrente no cartão).
// Sem MP_ACCESS_TOKEN roda em modo demo: o painel de teste "simula" o pagamento.
const crypto = require('crypto');
const store = require('./store');

const TOKEN = () => process.env.MP_ACCESS_TOKEN;
const ativo = () => !!TOKEN();
const API = 'https://api.mercadopago.com';

async function mp(caminho, opt = {}) {
  const r = await fetch(API + caminho, { ...opt, headers: { Authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json', ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// 1) Cria a assinatura e devolve o link de pagamento do Mercado Pago
async function criarAssinatura({ uid, email, plano }) {
  const base = process.env.APP_URL || 'http://localhost:3400';
  if (!ativo()) {
    const id = 'demo-' + crypto.randomBytes(4).toString('hex');
    await store.salvarAssinatura({ usuario_id: uid, plano: plano.id, provedor: 'demo', provedor_id: id, status: 'pendente' });
    return { id, link: `${base}/app#planos`, demo: true };
  }
  const r = await mp('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: `deep cut ${plano.nome} · ${plano.creditos_mes} créditos/mês`,
      external_reference: `${uid}:${plano.id}`,
      payer_email: email,
      back_url: `${base}/app#planos`,
      status: 'pending',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: plano.preco_centavos / 100, currency_id: 'BRL' }
    })
  });
  await store.salvarAssinatura({ usuario_id: uid, plano: plano.id, provedor: 'mercadopago', provedor_id: r.id, status: 'pendente' });
  return { id: r.id, link: r.init_point };
}

// 2) Ativa o plano e renova os créditos do mês (completa até o total do plano)
async function ativarPlano({ uid, planoId, referencia }) {
  const plano = (await store.planos()).find(p => p.id === planoId);
  if (!plano) throw new Error('Plano não encontrado');
  const p = await store.perfil(uid);
  const delta = Math.max(0, plano.creditos_mes - p.creditos);
  if (delta) await store.mover(uid, delta, `plano ${plano.nome}`, referencia);
  await store.atualizarPerfil(uid, { plano: plano.id, plano_status: 'ativo' });
}

// Confere a assinatura do webhook (cabeçalho x-signature do Mercado Pago)
function assinaturaValida(req) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) return true;
  const sig = String(req.headers['x-signature'] || '');
  const ts = (sig.match(/ts=([^,]+)/) || [])[1], v1 = (sig.match(/v1=([^,]+)/) || [])[1];
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
  const manifesto = `id:${dataId};request-id:${req.headers['x-request-id'] || ''};ts:${ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  return !!v1 && v1.length === esperado.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(esperado));
}

// 3) Webhook: o Mercado Pago avisa quando a assinatura é autorizada, cobrada ou cancelada
async function processarWebhook(req) {
  if (!ativo()) return { ignorado: 'modo demo' };
  if (!assinaturaValida(req)) throw Object.assign(new Error('Assinatura do webhook inválida'), { status: 401 });
  const tipo = req.body?.type || req.query.type, id = req.body?.data?.id || req.query['data.id'];
  if (!id) return { ignorado: 'sem id' };

  if (tipo === 'subscription_preapproval') {
    const pre = await mp(`/preapproval/${id}`);
    const [uid, planoId] = String(pre.external_reference || '').split(':');
    const status = { authorized: 'ativo', paused: 'pausado', cancelled: 'cancelado', pending: 'pendente' }[pre.status] || pre.status;
    await store.salvarAssinatura({ usuario_id: uid, plano: planoId, provedor: 'mercadopago', provedor_id: pre.id, status, proxima_cobranca: pre.next_payment_date || null });
    if (status === 'cancelado') await store.atualizarPerfil(uid, { plano_status: 'cancelado' });
    return { tipo, status };
  }
  if (tipo === 'subscription_authorized_payment') {
    const pag = await mp(`/authorized_payments/${id}`);
    const aprovado = pag.payment?.status === 'approved' || pag.status === 'processed';
    if (!aprovado) return { tipo, aprovado };
    const pre = await mp(`/preapproval/${pag.preapproval_id}`);
    const [uid, planoId] = String(pre.external_reference || '').split(':');
    await ativarPlano({ uid, planoId, referencia: `mp-pagamento-${id}` }); // referência única: webhook repetido não credita 2x
    return { tipo, aprovado, uid, planoId };
  }
  return { ignorado: tipo };
}

module.exports = { ativo, criarAssinatura, ativarPlano, processarWebhook };
