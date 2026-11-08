// Login com Supabase Auth, feito pelo backend (o navegador só guarda o token).
// Sem Supabase configurado, todo mundo entra como o usuário "demo" (modo de teste).
const store = require('./store');

const ativo = store.modo === 'supabase';
let anon = null;
function cliente() {
  if (!anon) {
    const { createClient } = require('@supabase/supabase-js');
    anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return anon;
}
const sessao = s => ({ access_token: s.access_token, refresh_token: s.refresh_token, expira_em: s.expires_at });
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Cadastro: cria o usuário já confirmado (MVP sem e-mail de confirmação) e faz login
async function cadastrar({ nome, email, senha }) {
  if (!ativo) return { access_token: 'demo', refresh_token: 'demo' };
  if (!email || !senha || senha.length < 8) throw erro('Informe e-mail e uma senha com pelo menos 8 caracteres');
  const { error } = await store.sb.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
  if (error) throw erro(/already|registered|exists/i.test(error.message) ? 'Esse e-mail já tem conta. Entre com sua senha.' : error.message);
  return entrar({ email, senha });
}
async function entrar({ email, senha }) {
  if (!ativo) return { access_token: 'demo', refresh_token: 'demo' };
  const { data, error } = await cliente().auth.signInWithPassword({ email, password: senha });
  if (error) throw erro('E-mail ou senha incorretos', 401);
  return sessao(data.session);
}
async function renovar(refresh_token) {
  if (!ativo) return { access_token: 'demo', refresh_token: 'demo' };
  const { data, error } = await cliente().auth.refreshSession({ refresh_token });
  if (error || !data.session) throw erro('Sessão expirada', 401);
  return sessao(data.session);
}

// Cache curto do token → usuário (evita consultar o Supabase a cada clique)
const cache = new Map();
async function usuarioDoToken(token) {
  const c = cache.get(token);
  if (c && c.ate > Date.now()) return c.user;
  const { data, error } = await store.sb.auth.getUser(token);
  if (error || !data.user) return null;
  cache.set(token, { user: data.user, ate: Date.now() + 60_000 });
  if (cache.size > 5000) cache.clear();
  return data.user;
}

// Middleware: coloca req.uid e req.email; responde 401 se não estiver logado
async function exigirLogin(req, res, next) {
  if (!ativo) { req.uid = 'demo'; req.email = 'demo@deepcut.local'; return next(); }
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = token && await usuarioDoToken(token).catch(() => null);
  if (!user) return res.status(401).json({ erro: 'Faça login de novo' });
  req.uid = user.id; req.email = user.email; next();
}

module.exports = { ativo, cadastrar, entrar, renovar, exigirLogin };
