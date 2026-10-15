# Publicar 4EVERTOOLS en un servidor propio (VPS)

Para cuando tengan presupuesto para un servidor. Sin los límites del plan gratis: archivos de hasta 250 MB, varias conversiones a la vez y el conversor siempre despierto. La opción gratis (Vercel + Render) está en `DEPLOY.md`.

---

## 0. Decisiones

### ¿Dónde se publica?

| | **A. Servidor propio (VPS) — recomendado** | **B. Plataforma administrada** |
|---|---|---|
| Qué es | Un servidor Linux arrendado donde corre todo con Docker | Una plataforma que ejecuta contenedores Docker por ti |
| HTTPS | Automático (Caddy, incluido) | Lo da la plataforma |
| Trabajo | Seguir esta guía una vez (~1 hora) | Configurar 2 servicios en su panel |
| Control | Total | Depende de la plataforma |

> Un hosting "solo estático" **no alcanza**. El conversor necesita un servidor con FFmpeg, yt-dlp y Deno, y eso corre como contenedor Docker.

**Tamaño mínimo sugerido del servidor:**
- 2 CPU y 2–4 GB de RAM;
- 40 GB de disco, porque los archivos subidos pesan hasta 250 MB y se borran a la hora;
- Ubuntu 24.04 LTS.

### YouTube: abierto (ya decidido)

El colectivo decidió que YouTube quede **abierto para todos**, y así viene en `env.production.example` (`YTDLP_ACCESS_KEY` vacío). Los límites contra el abuso siguen activos. Si algún día quieren cerrarlo, pongan una clave de 12 caracteres o más en `YTDLP_ACCESS_KEY` y reinicien.

> **Aviso honesto:** YouTube a veces bloquea las descargas que vienen de servidores en la nube y pide "confirma que no eres un bot". Puede pasar con cualquier hosting. Prueben YouTube apenas publiquen. Si falla, el resto de la web sigue funcionando, y pueden apagar solo YouTube con `YTDLP_ENABLED=false`.

---

## A. Servidor propio (VPS), paso a paso

### A1. Crear el servidor y el dominio (lo hacen ustedes)

1. Arrienden un VPS con **Ubuntu 24.04** en el proveedor que prefieran y anoten su **IP pública**.
2. En el panel de su dominio, creen dos registros DNS:
   - `A` · nombre `@` · valor = IP del servidor
   - `A` · nombre `www` · valor = IP del servidor
3. Esperen a que el dominio apunte a la IP. Suele tardar minutos y a veces horas.

### A2. Preparar el servidor

Conéctense desde la terminal de Windows (PowerShell):

```
ssh root@IP-DEL-SERVIDOR
```

1. Instalen Docker siguiendo la guía oficial para Ubuntu: https://docs.docker.com/engine/install/ubuntu/
2. Abran solo los puertos necesarios:

```
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
apt install -y unzip python3
```

### A3. Subir el proyecto

1. En tu PC, doble clic en **`empaquetar-para-servidor.bat`**. Arma `4evertools-release.zip` sin `node_modules` y sin tu `.env`.
2. Súbelo desde PowerShell, en la carpeta del proyecto:

```
scp 4evertools-release.zip root@IP-DEL-SERVIDOR:/opt/
```

3. En el servidor:

```
mkdir -p /opt/4evertools && cd /opt/4evertools
unzip -o ../4evertools-release.zip
```

### A4. Configurar

```
cp env.production.example .env
nano .env
```

Cambien:
- `DOMAIN`: su dominio, sin `https://`. Ejemplo: `4evertools.cl`.
- `ALLOWED_ORIGINS`: `https://` + su dominio.
- `YTDLP_ACCESS_KEY`: déjenlo vacío (YouTube abierto).

Guarden con `Ctrl+O`, `Enter` y `Ctrl+X`. Después revisen:

```
python3 backend/scripts/preflight.py .env
```

Debe terminar en **"0 errores — listo para publicar"**.

### A5. Encender

```
docker compose -f docker-compose.prod.yml --profile https up -d --build
```

La primera vez tarda varios minutos porque construye todo. Caddy pide el certificado HTTPS solo.

### A6. Comprobar

```
docker compose -f docker-compose.prod.yml ps
curl https://SU-DOMINIO/api/health
```

Después, en el navegador:
1. Abran `https://SU-DOMINIO`.
2. Conviertan un archivo propio.
3. Prueben un link de YouTube.
4. Escuchen la radio.
5. Revisen que se vea bien en el celular.
6. Peguen el link en WhatsApp o Discord: debe aparecer la imagen de vista previa.

### Mantenimiento

| Para… | Comando (en `/opt/4evertools`) |
|---|---|
| Ver qué pasa | `docker compose -f docker-compose.prod.yml logs -f --tail 100` |
| Publicar una versión nueva | Subir el zip nuevo, `unzip -o`, y `docker compose -f docker-compose.prod.yml --profile https up -d --build` |
| Actualizar yt-dlp (si YouTube empieza a fallar) | `docker compose -f docker-compose.prod.yml build --no-cache api && docker compose -f docker-compose.prod.yml --profile https up -d` |
| Apagar | `docker compose -f docker-compose.prod.yml --profile https down` |

No hay base de datos ni cuentas, así que no hay nada que respaldar, salvo su `.env`. Guárdenlo en un lugar seguro.

---

## B. Plataforma administrada

Creen **dos servicios** desde esta misma carpeta:

1. **api**: se construye con `backend/Dockerfile` y escucha en el puerto 8000.
   - Variables: las de `env.production.example` (con su dominio). Agreguen además `STORAGE_DIR=/app/storage`.
   - Chequeo de salud: `GET /api/ready`.
2. **web**: se construye con `Dockerfile.frontend` y escucha en el puerto 80.
   - Variable de build: `VITE_SITE_URL=https://SU-DOMINIO`.
   - Variable `API_UPSTREAM`: la dirección interna del servicio api que les da la plataforma. Ejemplo: `http://api.internal:8000`.
   - Variable `TRUSTED_PROXY_CIDR`: el rango de IP del proxy de la plataforma, si lo publican. Sirve para que el límite de abuso vea la IP real de cada visitante.

El dominio y el HTTPS se configuran en el panel de la plataforma, apuntando al servicio **web**.

---

## Qué protege a la web en producción

- **HTTPS** obligatorio, con renovación automática del certificado.
- **Cabeceras de seguridad** y una política de contenido (CSP) que solo permite este sitio, el reproductor de SoundCloud y Google Fonts.
- **Límites contra el abuso:**
  - 12 conversiones nuevas por minuto por IP en la entrada, y 60 pedidos por minuto en la API;
  - 2 conversiones a la vez por persona;
  - máximo 40 en cola en todo el servidor.
- **Disco protegido:** si quedan menos de 1 GB libres, el servidor rechaza conversiones nuevas en vez de llenarse. Los archivos se borran a la hora.
- **Links peligrosos bloqueados:** el servidor no descarga direcciones internas. Ahora también revisa a quién se conectó de verdad, contra el truco de "DNS rebinding".
- **Documentación de la API oculta** en producción.
- **Sin rastreo:** no hay cookies de seguimiento ni analítica. Los términos y la privacidad están en `/legal.html`.
