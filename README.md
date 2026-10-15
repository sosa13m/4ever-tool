# 4EVERTOOLS

Herramientas de audio del colectivo chileno 4EVER, gratis y sin cuentas. Versión **1.0.0**.

## Qué tiene

- **Conversor:** YouTube, un link directo o un archivo propio → MP3 320 o WAV de 16/24 bits. Conserva las etiquetas, avisa el tamaño antes de subir y muestra el progreso. Los archivos se borran a la hora, y el historial RECENT FILES queda en tu navegador.
- **BPM + Key:** tempo, tonalidad y Camelot, calculados en el navegador. El audio nunca sale de tu equipo.
- **4EVER LAB:** recortar, invertir, cambiar velocidad (keep pitch o tape), llevar a un BPM objetivo y cambiar el tono ±12 semitonos. Exporta WAV de 16/24 bits.
- **Radio 4EVER:** 7 catálogos de SoundCloud del colectivo en un shuffle global.
- **Collective:** un mundo por integrante (`#crew/<id>`), con sigilo, cameo en la radio y señales ocultas.
- **Themes:**
  - 9 mundos visuales: SÓTANO 4EVER, LINEA 4 EVER, RULE4EVER, 4EVERPALOOZA, LIBRETA NEGRA, 4EVERCHOX, SQUAREGODPANTS, 4EVERWOODS y 4EVERTALE.
  - Un mundo secreto, 4EVER VISTA: escribe `#4ever` fuera de los campos de texto.
  - En vez de describir el theme, la web muestra datos curiosos del underground.
- **Sonidos:** cada theme suena con su propio pack sintetizado. Tus WAV pueden reemplazar cualquier sonido.

## Publicar en internet

**Gratis:** la web va en **Vercel** y el conversor en **Render**. Ninguno de los dos pide tarjeta. Sigue **`DEPLOY.md`**:

1. Sube el repo `4ever-tool` a GitHub.
2. En Render, crea un Blueprint (lee `render.yaml`).
3. En Vercel, importa el repo y pon `VITE_API_URL`.
4. Conecta las dos partes con `ALLOWED_ORIGINS`.

El plan gratis tiene límites:
- el conversor se duerme sin uso y tarda cerca de un minuto en despertar;
- acepta archivos de hasta 100 MB;
- hace una conversión a la vez.

**Servidor propio:** cuando haya presupuesto, `DEPLOY-VPS.md` deja todo en un solo servidor con Docker y HTTPS automático, sin esos límites.

## Usar en tu PC (Windows)

- **`iniciar.bat`**: instala lo que falte la primera vez, abre la API y la web, y luego el navegador. Para apagar, cierra las ventanas "4EVER API" y "4EVER WEB".
- **`actualizar-yt-dlp.bat`**: úsalo si YouTube deja de convertir.
- **`verificar.bat`**: corre la revisión completa y guarda el resultado en `verificacion-log.txt`. La revisión incluye:
  - build;
  - autopruebas de BPM, radio, tonalidad, conversor, colectivo, LAB, sonidos y datos underground;
  - tests del backend;
  - revisión del `.env` de producción;
  - una prueba real con la API y YouTube.

Requisitos:
- Node 22.18 o más nuevo.
- Python 3.11 o más nuevo.
- FFmpeg.
- Para yt-dlp, Node o Deno.

```bat
winget install Gyan.FFmpeg
winget install DenoLand.Deno   :: opcional
```

### A mano

Backend:

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
python -m unittest discover -s tests -v
```

En http://localhost:8000/api/health revisa tres cosas: `ffmpeg` debe ser `true`, `ytdlp` debe mostrar una versión y `js_runtime` no debe ser `null`.

Frontend:

```bat
npm install
npm run dev
```

Autopruebas: `npm run test:bpm`, `test:key`, `test:radio`, `test:converter`, `test:collective`, `test:lab`, `test:sfx` y `test:lore`.

## Personalizar

| Qué | Dónde |
|---|---|
| Fotos, textos y links del colectivo | `COLLECTIVE.md` (explica todo paso a paso). Sin foto se ve su avatar de SoundCloud: se actualiza solo al construir la web, o a mano con `npm run avatars` |
| Sonidos propios | WAV en `public/audio/sfx/` con los nombres de `public/audio/sfx/README.txt`. El que falte usa el sintetizador |
| Datos underground | `src/data/lore.ts`: un dato corto por entrada, con su fuente |
| Themes | `src/data/themes.ts` (nombres, textos, colores) y `src/worlds/` (cada mundo) |
| Logos | `LOGO-MAP.md` |

## Carpetas

```
src/            web (React + Vite + TypeScript)
  worlds/       el mundo visual de cada theme
  data/         themes, colectivo, datos underground, logos heritage
  lib/          motores: BPM, tonalidad, radio, conversor, LAB, sonidos
backend/        API (FastAPI + FFmpeg + yt-dlp) y sus tests
deploy/         CSP, proxy y Caddy (HTTPS) para producción
public/         íconos, imagen para compartir, términos y privacidad
scripts/        autopruebas
```
