# docs/DEPLOYAMIENTO.md — DentalCare Retention Engine

> **Parte 3 de la entrega — Lanzamiento a producción.**
> Documento de despliegue y URL del proyecto en línea.

---

## 1. Decisión de plataforma

| Campo | Valor |
|---|---|
| **Plataforma elegida** | **Netlify** (recomendación del entregable y del proyecto) |
| **Tipo de artefacto** | Build de producción del proyecto (`npm run build`) + publicación del bundle |
| **URL de producción** | `https://dental-automation-clase3.netlify.app/` |
| **Sitio (site name)** | `dental-automation-clase3` |

> Nota de arquitectura: el motor completo (Express + PostgreSQL + Evolution API +
> Google Calendar) está diseñado para ejecutarse como proceso largo. Netlify se usa
> aquí como plataforma de publicación de la página del proyecto; la capa de base de
> datos y servicios externos se provee por variables de entorno (host externo).

---

## 2. Procedimiento de despliegue

### 2.1 Desde la interfaz de Netlify (recomendado)

1. Iniciar sesión en <https://app.netlify.com> con la cuenta del consultorio.
2. **Add new site → Import an existing project**.
3. Conectar el repositorio: `SDM29GH/dental-automation-clase3`.
4. Configuración de build:
   - **Build command:** `npm run build`
   - **Publish directory:** `public`
   - **Node version:** `22`
5. Variables de entorno (añadir en *Site settings → Environment variables*):
   - `NODE_ENV=production`
   - `PORT=3000`
   - `TIMEZONE=America/Mexico_City`
   - `WHATSAPP_PAIS=52`
   - `DATABASE_URL=<host de PostgreSQL de producción>`
   - `EVOLUTION_API_URL=<host Evolution API>`
   - `EVOLUTION_INSTANCE=consultorio-laura`
   - `EVOLUTION_API_KEY=<clave>`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `CALENDAR_IDS`
   - `PANEL_USER`, `PANEL_PASSWORD`
6. Deploy: **Trigger deploy → Deploy site**.

### 2.2 Desde la línea de comandos (CLI)

```bash
npm install -g netlify
netlify login
netlify link --site dental-automation-clase3
netlify deploy --prod
```

### 2.3 Verificación post-despliegue

- `GET /health` del entorno de producción debe responder.
- El panel queda en `/panel` del mismo host.

---

## 3. Checklist pre-producción (complementario a la de `PASO_A_PASO.md`)

- [ ] `PANEL_PASSWORD` definido y panel protegido.
- [ ] Base de datos de producción conectada (PostgreSQL).
- [ ] Número de WhatsApp y credenciales Evolution configurados.
- [ ] Google Calendar OAuth publicado (no *Testing*).
- [ ] Consentimientos de WhatsApp cargados.
- [ ] Sin pacientes de demostración.
- [ ] Copia de seguridad de PostgreSQL.

---

## 4. URL resultante

**Producción:** <https://dental-automation-clase3.netlify.app/>

**Panel de la asistente:** <https://dental-automation-clase3.netlify.app/panel>

**Salud del servicio:** `GET https://dental-automation-clase3.netlify.app/health`

---

## 5. Corrección aplicada al directorio de publicación

**Síntoma:** `https://dental-automation-clase3.netlify.app/` devolvía la página
404 de Netlify (`Page not found`) aunque el deploy aparecía como *Published*.

**Causa:** el proyecto en Netlify tenía configurado en la interfaz
(*Project configuration → Build settings*) **`Publish directory: dist`**.
`dist/` sólo contiene el JavaScript compilado por `tsc`, sin `index.html`, así que
Netlify publicaba un sitio vacío en la raíz.

**Corrección:**

1. En la interfaz de Netlify: **Project configuration → Build settings →
   Configure** → **Publish directory: `public`** (contiene `index.html`,
   `styles.css` y `app.js` del panel) → **Save**.
2. Netlify **reutiliza los archivos subidos cuando el commit no cambia**
   (mensaje *"All files already uploaded by a previous deploy with the same
   commits"*), por lo que cambiar la configuración no basta: hay que generar un
   **commit nuevo** (o usar *Trigger deploy → Deploy project without cache*) para
   que reconstruya con el directorio correcto.

> `netlify.toml` fija `publish = "public"` como referencia versionada; el sitio
> en Netlify estaba creado sin usar el archivo de configuración
> (`configuration_file_path: null`), por eso el ajuste se hizo también en la
> interfaz.

---

## 6. Estado de la puesta en producción

- **Sitio publicado:** <https://dental-automation-clase3.netlify.app/>
- **Repositorio:** `SDM29GH/dental-automation-clase3` (rama `main`).
- **Rama de producción:** `main`, con auto-publicación activada.
- La ejecución del deploy desde la CLI requiere autenticación de la cuenta
  (`netlify login` / token de despliegue); desde la interfaz se hizo con la
  sesión del equipo.
