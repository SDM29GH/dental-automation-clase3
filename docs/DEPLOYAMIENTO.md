# docs/DEPLOYAMIENTO.md — DentalCare Retention Engine

> **Parte 3 de la entrega — Lanzamiento a producción.**
> Documento de despliegue y URL del proyecto en línea.

---

## 1. Decisión de plataforma

| Campo | Valor |
|---|---|
| **Plataforma elegida** | **Netlify** (recomendación del entregable y del proyecto) |
| **Tipo de artefacto** | Build de producción del proyecto (`npm run build`) + publicación del bundle |
| **URL de producción** | `https://dentalcare-retention-engine.netlify.app` |
| **Sitio (site name)** | `dentalcare-retention-engine` |

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
   - **Publish directory:** `dist`
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
netlify link --site dentalcare-retention-engine
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

**Producción:** <https://dentalcare-retention-engine.netlify.app>

**Panel de la asistente:** <https://dentalcare-retention-engine.netlify.app/panel>

**Salud del servicio:** `GET https://dentalcare-retention-engine.netlify.app/health`

---

## 5. Estado de la puesta en producción en este entorno

> Registro técnico del entregable: la ejecución del deploy desde este entorno
> requiere autenticación de la cuenta de Netlify (`netlify login` / token de
> despliegue). La configuración de producción (`netlify.toml`, procedimiento,
> variables y URL) queda definida en este repositorio para completar el paso con
> la cuenta del consultorio.
