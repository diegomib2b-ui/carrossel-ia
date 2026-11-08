# deep cut

Conteúdo sem enrolação: carrossel com IA, Reels com avatar e edição que corta as pausas.

- Site: `http://localhost:3400/`
- App: `http://localhost:3400/app` · Login: `/entrar` · Onboarding: `/boas-vindas`
- Marca: `public/marca/` (ícone, foto de perfil 1080, logo animado)

## Identidade
Preto `#0A0A0C` · Grafite `#141417` · Lima `#C6FF3D` (ação) · Vermelho `#FF3D5A` (o que foi cortado) · Osso `#F4F4F2`. Inter Black nos títulos, JetBrains Mono nos dados.


Carrossel com IA + edição de vídeo (corta silêncios e põe legendas no estilo Reels), com créditos e um painel de teste.

## Rodar
```bash
npm install
cp .env.example .env   # opcional: coloque as chaves
node --env-file=.env server.js
# site em http://localhost:3400 · app em http://localhost:3400/app
```
Precisa ter Chrome/Chromium (CHROME_PATH) e FFmpeg instalados.

## Modos
| Recurso | Sem chave | Com chave |
|---|---|---|
| Texto do carrossel | modo demo (custo zero) | Claude Haiku (`ANTHROPIC_API_KEY`) |
| Legenda do vídeo | usa o roteiro colado (ex.: do Yapline) | Whisper (`OPENAI_API_KEY`) |
| Voz do avatar | áudio mudo com tempo estimado | ElevenLabs, voz clonada (`ELEVENLABS_API_KEY`) |
| Avatar falando | zoom suave na foto | fal.ai lip-sync, Kling Avatar v2 Standard (`FAL_KEY`) |

## Estrutura
- `server.js`: rotas da API
- `src/ai.js`: roteiro do carrossel (Claude ou demo)
- `src/templates.js`: 3 visuais de slide em 1080x1350
- `src/render.js`: converte HTML em PNG (Puppeteer)
- `src/video.js`: corte de silêncio, transcrição e legenda ASS queimada no vídeo (FFmpeg)
- `src/avatar.js`: avatar com IA (clonar voz, áudio com tempo por palavra, lip-sync, legenda nos estilos Clássico/Gancho/Dados)
- `src/store.js`: créditos e histórico em JSON (pronto para migrar ao Supabase)
- `public/index.html`: site (landing com animações)
- `public/app.html`: app + painel de teste

## API
- `GET /api/me`: créditos e integrações
- `POST /api/carrossel`: gera um carrossel {tema, nicho, tom, qtd, template, cor, handle} (1 crédito)
- `POST /api/carrossel/:id/rerender`: edita textos/visual (grátis)
- `GET /api/carrossel/:id/zip`: baixa os PNGs + legenda.txt
- `POST /api/video` (multipart): video, roteiro, cortarSilencio, legendas, cor (3 créditos, roda em segundo plano)
- `GET /api/geracoes/:id`: status da geração
- `GET/POST /api/avatares`: lista/cria avatar (foto + voz). 1º grátis, depois 10 créditos
- `POST /api/avatar/roteiro`: roteiro falado pela IA {tema}
- `POST /api/avatar/audio`: prévia do áudio {avatarId, roteiro} (grátis, máx. 900 caracteres ≈ 60 s)
- `POST /api/avatar/video`: vídeo {audioId, estilo, cor}. 1 crédito a cada 5 s, roda em segundo plano
- `POST /api/creditos/reset`: reseta os créditos (teste)

O custo de API de cada geração é registrado no log `[custo]` e aparece no Histórico.

## Próximas fases
2. Postar no Instagram (Graph API, precisa da aprovação de app da Meta)
4. Respostas automáticas no Direct

## Base do SaaS (Fase 3)
- **Dados:** Supabase `deep-cut` (sa-east-1): `perfis`, `marcas`, `geracoes`, `avatares`, `audios`, `planos`, `assinaturas`, `creditos_extrato`. RLS ligado: o navegador nunca escreve direto; tudo passa pelo backend.
- **Créditos:** função `mover_creditos` debita/credita numa única operação (saldo nunca fica negativo, pagamento repetido não credita 2x).
- **Login:** Supabase Auth pelo backend (`/api/auth/*`), token guardado no navegador e renovado sozinho.
- **Marca:** onboarding em 3 passos (negócio, visual, jeito de escrever). A IA usa a marca em todo carrossel e roteiro.
- **Planos:** Start R$97/150 cr · Pro R$147/300 · Ultra R$247/500 (editáveis na tabela `planos`). Assinatura mensal no cartão via Mercado Pago (preapproval) + webhook `/api/webhooks/mercadopago`.
- **Preço em créditos:** carrossel 2 · edição 5 · avatar 45/min (mín. 10) · avatar extra 30 · roteiro grátis.
- **Sem chaves:** roda local com usuário demo; o Painel de teste simula o pagamento.

## Deploy (Railway)
- Build pelo `Dockerfile` (Node 22 + FFmpeg + Chromium + fontes Inter/JetBrains Mono). Checagem de saúde em `/saude`.
- Criar um **Volume** montado em `/app/data` (guarda vídeos, slides e avatares entre deploys). Uma instância só enquanto os arquivos estiverem no volume.
- Variáveis: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `FAL_KEY`, `APP_URL` (link público), e depois `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET`.
- Webhook do Mercado Pago: `{APP_URL}/api/webhooks/mercadopago`.
