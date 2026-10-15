# Publicar 4EVERTOOLS gratis

La web y el conversor viven en dos servicios gratis, sin tarjeta:

| Parte | Dónde | Qué hace |
|---|---|---|
| **La web** | **Vercel** | Themes, radio, BPM + Key, 4EVER LAB, colectivo. Todo esto corre en el navegador. |
| **El conversor (API)** | **Render** | FFmpeg en un contenedor Docker (`render.yaml`). Convierte archivos y links directos. |
| **El conversor de YouTube** | **Un PC en casa** | `conversor-casa.bat`. YouTube bloquea a los servidores en la nube, pero no a una conexión de casa. |

Las dos partes se conectan con dos datos: `VITE_API_URL` en Vercel y `ALLOWED_ORIGINS` en Render.

> **Límites del plan gratis de Render** (revisa la página de precios de Render, porque cambian):
> - **Se duerme a los 15 minutos sin uso.** La primera visita después de eso lo despierta en más o menos un minuto. Mientras tanto la web muestra *WAKING UP THE CONVERTER* y todo lo demás funciona normal.
> - **512 MB de RAM y una CPU pequeña.** Por eso viene configurado así:
>   - archivos de hasta **100 MB**;
>   - **una conversión a la vez**.
> - **Unos 5 GB de descargas al mes** entre todos. Cada MP3 pesa unos 8 MB y cada WAV unos 50 MB.
> - **YouTube** bloquea a los servidores en la nube ("confirma que no eres un bot"). Por eso los links de YouTube se convierten en un PC de casa (sección 6).
>
> Cuando tengan presupuesto, `DEPLOY-VPS.md` explica cómo pasar todo a un servidor propio sin estos límites.

---

## 1. Subir el código a GitHub

1. Crea en GitHub un repositorio vacío llamado **`4ever-tool`**, sin README.
2. En la carpeta del proyecto, ejecuta:

```
git init
git add .
git commit -m "4EVERTOOLS 1.0.0"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/4ever-tool.git
git push -u origin main
```

`.gitignore` ya deja fuera `node_modules`, `dist`, tu `.env`, el entorno de Python y los logs.

## 2. El conversor en Render

1. Entra a **render.com** con tu cuenta de GitHub.
2. Ve a **New → Blueprint** y elige el repo `4ever-tool`. Render lee `render.yaml` y propone el servicio **4ever-tool-api** (plan Free, región Virginia).
3. Te va a pedir `ALLOWED_ORIGINS`. Por ahora escribe `https://4ever-tool.vercel.app`; lo corriges en el paso 4 si Vercel te da otra dirección.
4. Pulsa **Apply**. La primera construcción tarda varios minutos.
5. Cuando diga **Live**, copia la dirección del servicio. Ejemplo: `https://4ever-tool-api.onrender.com`.
6. Ábrela con `/api/health` al final. Debe mostrar `"ffmpeg": true` y una versión de `ytdlp`.

## 3. La web en Vercel

1. Entra a **vercel.com** con tu cuenta de GitHub.
2. Ve a **Add New → Project** e importa el repo `4ever-tool`. Vercel detecta Vite solo, gracias a `vercel.json`.
3. Abre **Environment Variables** y agrega dos:
   - `VITE_API_URL` = la dirección de Render, **sin** `/` al final. Ejemplo: `https://4ever-tool-api.onrender.com`.
   - `VITE_SITE_URL` = la dirección de la web. Ejemplo: `https://4ever-tool.vercel.app`. Sirve para la imagen que aparece al compartir el link.
4. Pulsa **Deploy**.

## 4. Conectar las dos partes

1. Copia la dirección final que te dio Vercel.
2. En Render, ve a **4ever-tool-api → Environment** y revisa `ALLOWED_ORIGINS`. Tiene que ser exactamente esa dirección, con `https://` y sin `/` al final. Si usas más de una dirección, sepáralas con comas.
3. Guarda. Render reinicia el conversor.
4. Si la dirección de Vercel no era la que pusiste en el paso 2, cambia también `VITE_SITE_URL` en Vercel y vuelve a publicar con **Deployments → Redeploy**.

## 5. Probar

En la web publicada:
1. Espera a que desaparezca *WAKING UP THE CONVERTER*, si aparece.
2. Convierte un archivo tuyo y descárgalo.
3. Prueba un link de YouTube.
4. Mira BPM + Key, 4EVER LAB, la radio y los themes.
5. Revisa que se vea bien en el celular.
6. Pega el link en WhatsApp o Discord: debe salir la imagen de vista previa.

Si el conversor no responde, revisa `ALLOWED_ORIGINS` en Render y `VITE_API_URL` en Vercel: son los dos errores más comunes.

## 6. El conversor de YouTube en casa

YouTube no deja descargar desde Render, pero sí desde una conexión de casa. Por eso un PC de casa convierte los links de YouTube:
- `conversor-casa.bat` levanta el conversor en ese PC (solo acepta links de YouTube).
- Lo publica en internet con un túnel gratis de Cloudflare. No hay que abrir puertos del router.
- Cada minuto le avisa a Render la dirección del túnel. La web le pregunta a Render y manda ahí los links de YouTube.
- Si el PC está apagado, la web lo dice: *THE YOUTUBE CONVERTER IS OFF RIGHT NOW*. Los archivos y los links directos siguen funcionando en Render.
- Mientras está prendido, el aviso de cada minuto también mantiene despierto a Render.

### Preparar el PC (una sola vez)

1. Necesitas Python y FFmpeg. Si ya usaste `iniciar.bat`, los tienes.
2. Instala cloudflared. En una terminal:
   ```
   winget install --id Cloudflare.cloudflared
   ```
3. Abre `conversor-casa.bat`. La primera vez crea `casa.env` con una clave nueva, la muestra y se detiene.
4. En Render, ve a **4ever-tool-api → Environment → Add Environment Variable**:
   - Key: `HOME_RELAY_KEY`
   - Value: la clave que mostró el `.bat`. También está en `casa.env`.
5. Pulsa **Save** y espera a que Render reinicie.
6. Abre `conversor-casa.bat` otra vez. Cuando diga *Render ya sabe donde estoy*, prueba un link de YouTube en la web.

`casa.env` no se sube a GitHub (está en `.gitignore`). No compartas la clave.

### Dejarlo siempre prendido

- Mientras la ventana está abierta, el script le pide a Windows que no se suspenda. La pantalla sí se puede apagar.
- No cierres la tapa si es un notebook, y déjalo enchufado.
- Para que parta solo al prender el PC:
  1. Pulsa **Win + R** y escribe `shell:startup`.
  2. En esa carpeta, crea un acceso directo a `conversor-casa.bat`.
- Si se corta internet o se cae el túnel, el script abre uno nuevo solo. La web se entera en uno o dos minutos.
- Cada vez que lo abres, actualiza yt-dlp. Si YouTube deja de convertir, ciérralo y ábrelo de nuevo.

## Publicar cambios

Haz `git push` a `main`.
- Vercel vuelve a publicar la web sola.
- Render vuelve a construir el conversor solo si cambiaste algo dentro de `backend/`.

## Si YouTube deja de convertir

1. Revisa que la ventana de `conversor-casa.bat` siga abierta y sin avisos.
2. Si está abierta, ciérrala y ábrela de nuevo: así se actualiza yt-dlp.
3. Si dice que Render rechazó la clave, revisa que `HOME_RELAY_KEY` sea igual en Render y en `casa.env`.

## Qué protege a la web

- **HTTPS** en las dos partes, automático.
- **Cabeceras de seguridad y política de contenido (CSP)** en `vercel.json`. Solo permiten este sitio, el conversor en Render, el túnel de Cloudflare del PC de casa, el reproductor de SoundCloud y Google Fonts.
- **El conversor** solo acepta pedidos desde tu web (`ALLOWED_ORIGINS`). Render solo acepta direcciones de túnel `https://….trycloudflare.com`, y solo con la clave `HOME_RELAY_KEY`; nadie más puede desviar los links de YouTube. También tiene límites por persona y por servidor, se niega a descargar direcciones internas, oculta su documentación y borra los archivos a la hora.
- **Sin rastreo**: no hay cookies de seguimiento ni analítica. Los términos y la privacidad están en `/legal.html`.
