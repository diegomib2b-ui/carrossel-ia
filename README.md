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
- `public/index.html`: app + painel de teste

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
