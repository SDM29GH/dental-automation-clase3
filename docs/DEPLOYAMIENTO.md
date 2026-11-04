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

La raíz sirve la página estática del proyecto (`public/index.html`).

> Nota: `/panel` y `/health` son endpoints del servidor Express (backend con
> PostgreSQL, WhatsApp y Calendar); en el sitio estático de Netlify no existen.
> El panel completo se ejecuta en local (`http://localhost:3000/panel`) o en el
> host donde corra el motor.

---

## 5. Corrección del 404 en la raíz (causa raíz)

**Síntoma:** `https://dental-automation-clase3.netlify.app/` devolvía la página
404 de Netlify (`Page not found`) aunque el deploy aparecía como *Published*.

**Diagnóstico (evidencia):**

1. El explorador de archivos de Netlify mostraba **129 archivos**: todo el
   JavaScript compilado de `dist/` (`src/`, `tests/`, `scripts/`) más
   `netlify.toml`, y **ningún `index.html`**.
2. En vivo: `/src/index.js` respondía 200 (contenido de `dist`), mientras
   `/public/index.html` y `/netlify.toml` respondían 404.
3. El archivo **`netlify.toml` tenía `publish = "dist"`** en `[build]`,
   `[context.production]` y `[context.deploy-preview]`.

**Causa:** Netlify **sí lee `netlify.toml`** (se evidenció al procesar su regla
de headers para `/health`) y **el archivo manda sobre el valor de la interfaz**.
Aunque en *Project configuration → Build settings* se guardó
`Publish directory: public`, la publicación real seguía siendo `dist`, que sólo
contiene el backend compilado sin `index.html`, produce un sitio vacío en la
raíz → 404 permanente.

**Corrección:** `netlify.toml` ahora fija `publish = "public"` en `[build]` y en
todos los contextos, en sincronía con el valor de la interfaz. `public/` contiene
`index.html`, `styles.css` y `app.js` del panel.

> Lección: al diagnosticar un deploy, verificar **qué se publicó de verdad**
> (explorador de archivos del deploy + URLs vivas), no sólo el valor de la
> configuración en la UI. Si interfaz y `netlify.toml` discrepan, gana el
> archivo versionado.

---

## 6. Estado de la puesta en producción

- **Sitio publicado:** <https://dental-automation-clase3.netlify.app/>
- **Repositorio:** `SDM29GH/dental-automation-clase3` (rama `main`).
- **Rama de producción:** `main`, con auto-publicación activada.
- La ejecución del deploy desde la CLI requiere autenticación de la cuenta
  (`netlify login` / token de despliegue); desde la interfaz se hizo con la
  sesión del equipo.
