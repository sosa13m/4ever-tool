# Cómo completar los mundos del colectivo

Cada integrante tiene su propio "mundo" en la web: se abre desde **COLLECTIVE → OPEN WORLD**, tocando su foto en la radio cuando suena, o con su link `#crew/<id>`. Ya funciona con lo que hay hoy (nombre, SoundCloud, colores, símbolo y sigilo). Lo que falta lo pones tú, de a poco y sin apuro: lo que esté vacío simplemente no se muestra.

## 1. Fotos (sin tocar código)

Copia la foto en `src/assets/collective/` con el **id** del integrante como nombre:

| Integrante | Archivo | Link para compartir |
|---|---|---|
| moneynlust | `moneynlust.webp` | `#crew/moneynlust` |
| cinho | `cinho.webp` | `#crew/cinho` |
| rani | `rani.webp` | `#crew/rani` |
| agus (mella) | `agus.webp` | `#crew/agus` |
| aletsandrr (1000blunts) | `aletsandrr.webp` | `#crew/aletsandrr` |
| dj chupalito | `dj-chupalito.webp` | `#crew/dj-chupalito` |
| maxoxo | `maxoxo.webp` | `#crew/maxoxo` |
| hueviti | `hueviti.webp` | `#crew/hueviti` |
| anderratedasf | `anderratedasf.webp` | `#crew/anderratedasf` |
| mundane (2012) | `mundane.webp` | `#crew/mundane` |

- Sirve `.webp`, `.jpg`, `.png` o `.avif`. Cuadrada, mínimo 600×600. `.webp` pesa menos.
- Reinicia `iniciar.bat` (o `npm run dev`) y aparece sola.
- Sin foto se usa el avatar de SoundCloud; si no carga, el **sigilo** (el dibujo generado con sus colores).

## 2. Textos, colores y links

Todo está en `src/data/collective.ts`, una línea por integrante. Ejemplo de cómo quedaría una completa:

```ts
{ id: 'rani', name: 'rani', profileUrl: 'https://soundcloud.com/umjammer_rani', radio: true,
  accent: '#66ffbf', accent2: '#3a86ff', symbol: '☾',
  tagline: 'frase corta que lo describe',
  bio: 'Dos o tres frases: desde cuándo produce, qué hace, de dónde es.',
  cameo: 'un sticker corto',
  links: { instagram: 'https://instagram.com/...' },
  signals: ['rani'] },
```

| Campo | Qué es | Si lo dejas vacío |
|---|---|---|
| `tagline` | Una frase debajo del nombre (también aparece en su tarjeta) | Se muestra su alias o su usuario de SoundCloud |
| `bio` | Dos o tres frases | No aparece |
| `cameo` | Sticker corto en su mundo | No aparece |
| `role` | "producer", "dj", "dev"… | Dice "4EVER MEMBER" |
| `accent`, `accent2` | Los dos colores de su mundo (hex) | — (ya tienen uno cada uno; cámbialos si quieren otro) |
| `symbol` | Un carácter: letra, ✦, ☾, ⚡… | — (ya tienen uno provisorio) |
| `links` | instagram, youtube, tiktok, spotify, bandcamp, website | No aparecen botones extra |
| `signals` | Palabras que, escritas en cualquier parte de la web, encuentran su señal secreta | — |

Después de editar, corre `npm run test:collective` (o `verificar.bat`): revisa que los colores se lean bien, que los links sean válidos y que ninguna señal se repita.

> Los colores y símbolos que puse son **provisorios**, elegidos para que cada mundo se distinga. Pregúntale a cada uno cuál quiere.

## 3. Señales ocultas

Cada integrante esconde una señal. Se encuentra **escribiendo su nombre o alias** en cualquier parte de la web (con teclado) o **tocando 5 veces su retrato** dentro de su mundo (en el celular). El colectivo muestra cuántas lleva encontradas cada visitante: `SIGNALS 3/10`.
