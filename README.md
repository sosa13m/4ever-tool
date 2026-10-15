# 4EVERTOOLS

Herramientas de audio del colectivo chileno **4EVER**. Son gratis, no piden cuenta y no tienen anuncios.

Convierte audio, mide BPM y tonalidad, edita samples y escucha al colectivo, todo desde el navegador.

---

## Cómo se usa

### Entrar

Al abrir la web, elige **ENTER WITH SOUND** o **ENTER MUTED**. Puedes encender o apagar los sonidos de la interfaz cuando quieras con el parlante de arriba.

En la entrada y en el inicio aparece un **dato underground**: una curiosidad sobre artistas de la escena, como Reptilian Club Boyz, Hi-C, 1c34, Novagang, Shed Theory, Swaggerboyz, VRITNI o 4EVER. Con **OTRO DATO ↻** ves otra.

### URL CONVERTER: convertir audio

1. Elige **PASTE LINK** o **UPLOAD FILE**.
   - **PASTE LINK:** pega un link de YouTube o un link directo a un archivo de audio o video (`.mp3`, `.mp4`…).
   - **UPLOAD FILE:** sube un archivo tuyo. La web te muestra el peso antes de subirlo.
2. Elige el formato:
   - **MP3:** calidad en kbps, hasta 320.
   - **WAV:** 16 o 24 bits.
3. Pulsa **COOK AUDIO** y espera la barra de progreso.
4. Pulsa **DOWNLOAD FILE**.

- Los archivos se borran del servidor a la hora.
- En **RECENT FILES** quedan tus últimas conversiones mientras sigan disponibles. Esa lista se guarda solo en tu navegador.
- Las etiquetas del archivo original (artista, título) se conservan.
- Si cambias de pestaña mientras se convierte, la conversión sigue y la web la retoma al volver.

> Si aparece **WAKING UP THE CONVERTER**, el servidor estaba dormido. Tarda cerca de un minuto en despertar; mientras tanto, todo lo demás funciona.

### BPM + KEY: tempo y tonalidad

1. Arrastra una canción o un loop a la zona **DROP THE TRACK**.
2. Si quieres, elige el **BPM RANGE** del género para ayudar a decidir entre half-time y double-time. Por ejemplo, trap o house.
3. Verás:
   - **BPM** exacto y otros tempos posibles (**OTHER PULSES**);
   - **KEY** con su código Camelot;
   - **MIXES WITH**: las tonalidades que mezclan bien con esa;
   - **TUNING**: aparece si el tema no está afinado en 440 Hz.

El análisis ocurre en tu navegador: **el audio nunca sale de tu equipo**.

### 4EVER LAB: editar un sample

1. Arrastra un sample, loop o tema. Sirve MP3, WAV, FLAC, M4A u OGG.
2. Elige qué parte usar con **START / END** sobre la onda, o con **SELECT ALL**.
3. Aplica lo que quieras:
   - **REVERSE**: dar vuelta el audio;
   - **SPEED**: cambiar la velocidad, con **KEEP PITCH** (mantiene el tono) o **TAPE** (como una cinta: el tono sube o baja con la velocidad);
   - **TARGET BPM**: llevarlo a un BPM exacto;
   - **PITCH**: subir o bajar hasta ±12 semitonos.
4. Pulsa **RENDER** para escuchar el resultado. La web te dice qué BPM y tonalidad tendrá.
5. Pulsa **DOWNLOAD WAV** (16 o 24 bits), o **MAKE AN MP3** para pasarlo al conversor.

Todo se procesa en tu navegador. No se sube nada.

### RADIO 4EVER

La barra de abajo toca temas de 7 integrantes del colectivo, sacados de SoundCloud, en un shuffle global.
- Tienes play, pausa y siguiente.
- Hay un botón para un tema al azar de todo el colectivo y otro para uno del artista que está sonando.
- El volumen de la radio es aparte del de la interfaz.
- Mientras alguien suena, aparece su foto: tócala para abrir su mundo.

### COLLECTIVE: los 10 integrantes

Cada integrante tiene su tarjeta, con su avatar o foto y su sigilo.
- Con **PLAY** suena en la radio.
- Con **OPEN WORLD** entras a su mundo, que tiene colores, símbolo y link de SoundCloud propios.
- Cada mundo tiene un link para compartir, del tipo `…/#crew/cinho`.

**Señales ocultas:** escribe el nombre de un integrante en cualquier parte de la web, fuera de los campos de texto, y encuentras su señal. En el panel del colectivo se ve cuántas llevas.

### THEMES: cambiar el mundo

La web tiene 9 mundos visuales. Cada uno tiene su diseño y su propio pack de sonidos:

| Theme | Estilo |
|---|---|
| SÓTANO 4EVER | Disquería en un sótano, con flyers y un cajón de vinilos |
| LINEA 4 EVER | Estación de metro con graffiti y un tablero de salidas |
| RULE4EVER | Web antigua, de los 2000 |
| 4EVERPALOOZA | Festival, con láseres y el lineup del colectivo |
| LIBRETA NEGRA | Sketchbook con pintura blanca |
| 4EVERCHOX | Portal de cómics |
| SQUAREGODPANTS | Fondo del mar en caricatura |
| 4EVERWOODS | Etiqueta roja de hoja curada |
| 4EVERTALE | RPG de 16 bits en negro y morado |

Para cambiar de mundo:
- Abre **THEMES** para elegir uno y escuchar su **SOUND PACK**. Con **RANDOM ON ENTRY** te toca uno distinto cada vez que entras.
- O usa el botón de shuffle de arriba para cambiar al azar.

**Secreto:** escribe `#4ever` fuera de los campos de texto y se desbloquea **4EVER VISTA**.

---

## Privacidad

- No hay cuentas, cookies de seguimiento ni analítica.
- BPM + KEY y 4EVER LAB funcionan solo en tu navegador.
- El conversor borra los archivos a la hora.

Los términos y la privacidad están en `/legal.html`.

## Para el colectivo

- `DEPLOY.md`: cómo publicar la web gratis (Vercel + Render).
- `COLLECTIVE.md`: cómo agregar fotos, textos y links de cada integrante.

Hecho con React, Vite y FastAPI (FFmpeg + yt-dlp).
