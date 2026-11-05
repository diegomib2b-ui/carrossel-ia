# Carrossel IA — Fase 1 (MVP estilo Qorvo)

Carrossel com IA + edição de vídeo (corta silêncios e põe legendas no estilo Reels), com créditos e um painel de teste.

## Rodar
```bash
npm install
cp .env.example .env   # opcional: coloque as chaves
node --env-file=.env server.js
# abra http://localhost:3400
```
Precisa ter Chrome/Chromium (CHROME_PATH) e FFmpeg instalados.

## Modos
| Recurso | Sem chave | Com chave |
|---|---|---|
| Texto do carrossel | modo demo (custo zero) | Claude Haiku (`ANTHROPIC_API_KEY`) |
| Legenda do vídeo | usa o roteiro colado (ex.: do Yapline) | Whisper (`OPENAI_API_KEY`) |

## Estrutura
- `server.js`: rotas da API
- `src/ai.js`: roteiro do carrossel (Claude ou demo)
- `src/templates.js`: 3 visuais de slide em 1080x1350
- `src/render.js`: converte HTML em PNG (Puppeteer)
- `src/video.js`: corte de silêncio, transcrição e legenda ASS queimada no vídeo (FFmpeg)
- `src/store.js`: créditos e histórico em JSON (pronto para migrar ao Supabase)
- `public/index.html`: app + painel de teste

## API
- `GET /api/me`: créditos e integrações
- `POST /api/carrossel`: gera um carrossel {tema, nicho, tom, qtd, template, cor, handle} (1 crédito)
- `POST /api/carrossel/:id/rerender`: edita textos/visual (grátis)
- `GET /api/carrossel/:id/zip`: baixa os PNGs + legenda.txt
- `POST /api/video` (multipart): video, roteiro, cortarSilencio, legendas, cor (3 créditos, roda em segundo plano)
- `GET /api/geracoes/:id`: status da geração
- `POST /api/creditos/reset`: reseta os créditos (teste)

O custo de API de cada geração é registrado no log `[custo]` e aparece no Histórico.

## Próximas fases
2. Postar no Instagram (Graph API, precisa da aprovação de app da Meta)
3. Avatar de IA (API terceira ou modelo open-source em GPU)
4. Respostas automáticas no Direct
