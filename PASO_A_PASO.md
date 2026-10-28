# Paso a paso — DentalCare Retention Engine

Guía para dejar funcionando el sistema completo en la computadora del consultorio:
base de datos, panel de la asistente, WhatsApp y Google Calendar.

> **Qué vas a tener al terminar**
> - Un panel web en `http://localhost:3000/panel` con la agenda del día, pendientes, tratamientos en riesgo y conversaciones.
> - Recordatorios automáticos por WhatsApp a 3 días, 24 h, 2 h y el mismo día.
> - Seguimiento de tratamientos multisesión (endodoncia, ortodoncia, prótesis…).
> - Confirmación, reprogramación y cancelación por lenguaje natural desde WhatsApp.
> - Todo respaldado en PostgreSQL; Google Calendar sigue siendo la agenda oficial.

**Tiempo estimado:** 40–60 minutos sin credenciales externas; +30 minutos para WhatsApp y Google Calendar.

**Sistema probado en:** Windows 10/11 + PowerShell, Node 24, Docker Desktop. Los comandos de PowerShell están marcados; cuando algo cambia en macOS/Linux se indica.

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Abrir el proyecto e instalar dependencias](#2-abrir-el-proyecto-e-instalar-dependencias)
3. [Crear el archivo `.env`](#3-crear-el-archivo-env)
4. [Preparar PostgreSQL](#4-preparar-postgresql)
5. [Primer arranque y panel](#5-primer-arranque-y-panel)
6. [Conectar WhatsApp (Evolution API)](#6-conectar-whatsapp-evolution-api)
7. [Conectar Google Calendar](#7-conectar-google-calendar)
8. [Activar la IA (opcional)](#8-activar-la-ia-opcional)
9. [Prueba de punta a punta](#9-prueba-de-punta-a-punta)
10. [Operación diaria](#10-operación-diaria)
11. [Pruebas y compilación](#11-pruebas-y-compilación)
12. [Pasar a producción](#12-pasar-a-producción)
13. [Problemas frecuentes](#13-problemas-frecuentes)
14. [Checklist antes de producción](#14-checklist-antes-de-producción)
15. [Referencia de comandos](#15-referencia-de-comandos)

---

## 1. Requisitos

| Programa | Versión | Para qué |
|----------|---------|----------|
| Node.js | 20 o superior | ejecutar el sistema |
| Docker Desktop | reciente | PostgreSQL y Evolution API |
| Navegador | Chrome/Edge/Firefox | panel y autorización de Google |
| Teléfono con WhatsApp | — | vincular la instancia de Evolution |

Comprueba que están instalados. Abre **PowerShell** y ejecuta:

```powershell
node -v
npm -v
docker --version
docker compose version
```

Debes ver algo como `v24.x`, `10.x`, `Docker version 29.x` y `Docker Compose version v2.x`.

Si falta Node:

```powershell
winget install OpenJS.NodeJS.LTS
```

Si falta Docker, instala **Docker Desktop** desde <https://www.docker.com/products/docker-desktop/> y ábrelo antes de continuar (el ícono de la ballena debe estar en la barra de tareas).

> **Nota:** no necesitas Git ni una cuenta de GitHub. El proyecto ya está en esta carpeta.

---

## 2. Abrir el proyecto e instalar dependencias

Todos los comandos se ejecutan **dentro de la carpeta `dental-automation`**. En esta máquina es:

```powershell
cd "C:\Users\usuario\OneDrive\Documentos\Proyecto predeterminado\dental-automation"
```

Instala las dependencias:

```powershell
npm install
```

Tarda unos minutos la primera vez. Al terminar, comprueba que el código compila:

```powershell
npx tsc --noEmit
```

Si no imprime nada, está bien.

**Qué hay en la carpeta:**

```
dental-automation/
├── src/                 código del bot, recordatorios, panel y calendario
├── public/              panel (HTML/CSS/JS, sin build)
├── prisma/              esquema y migraciones de la base
├── scripts/             semilla, OAuth de Google, demo, instalación
├── tests/               110 pruebas automáticas
├── docs/                arquitectura y flujos
├── docker-compose.yml   PostgreSQL + Evolution API + app
├── .env.example         plantilla de configuración
└── README.md            resumen técnico
```

---

## 3. Crear el archivo `.env`

Copia la plantilla:

```powershell
Copy-Item .env.example .env
```

Abre `.env` con el Bloc de notas:

```powershell
notepad .env
```

### 3.1 Variables obligatorias

| Variable | Ejemplo | Qué es |
|----------|---------|--------|
| `DATABASE_URL` | `postgresql://dental_user:dental_pass@localhost:5432/dental_care?schema=public` | conexión a PostgreSQL |
| `EVOLUTION_API_URL` | `http://localhost:8080` | servidor de WhatsApp |
| `EVOLUTION_API_KEY` | `c4d1...` | clave del servidor de WhatsApp |
| `EVOLUTION_INSTANCE` | `consultorio-laura` | nombre de la instancia (debe coincidir con Evolution) |
| `GOOGLE_CLIENT_ID` | `123-abc.apps.googleusercontent.com` | credencial de Google |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` | credencial de Google |

> Puedes dejar por ahora los valores de ejemplo de Google (`tu-client-id...`):
> el sistema arranca y funciona con la base local. Los credenciales reales se
> configuran en la [sección 7](#7-conectar-google-calendar).

### 3.2 Variables recomendadas

| Variable | Valor | Por qué |
|----------|-------|---------|
| `TIMEZONE` | `America/Mexico_City` | todos los horarios y la ventana de envío |
| `WHATSAPP_PAIS` | `52` | lada que se antepone al enviar (México) |
| `CALENDAR_IDS` | `primary` o el correo del consultorio | calendario(s) a sincronizar |
| `PANEL_USER` | `asistente` | usuario del panel |
| `PANEL_PASSWORD` | una clave de 12+ caracteres | sin ella el panel sólo abre en localhost |
| `LLM_API_KEY` | vacío o `sk-...` | IA opcional para mensajes ambiguos |

### 3.3 Generar claves seguras

En PowerShell:

```powershell
# Clave para Evolution API
-join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

# Contraseña del panel (sólo letras y números, mínimo 8 caracteres)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
```

Copia el resultado **sin comillas** en `EVOLUTION_API_KEY` y `PANEL_PASSWORD`.
La contraseña del panel debe tener **al menos 8 caracteres** (el sistema la valida al arrancar).

> **Importante:** el contenedor de Evolution y la aplicación leen `EVOLUTION_API_KEY` del mismo `.env`, así que se mantienen sincronizadas. Si cambias la clave después de levantar Evolution, recréalo: `docker compose up -d --force-recreate evolution-api`.

### 3.4 Reglas del archivo `.env`

- Sin espacios alrededor del `=` (`PORT=3000`, no `PORT = 3000`).
- Las comillas son opcionales, pero ayudan si la clave tiene caracteres raros.
- Nunca compartas ni subas este archivo: contiene acceso a WhatsApp y a la agenda.
- Si cambias una variable, **reinicia** el servidor (`Ctrl+C` y `npm run dev`).

> En este punto el archivo puede tener credenciales de ejemplo de Google. El sistema arranca igual: si no hay `GOOGLE_REFRESH_TOKEN`, avisa y sigue funcionando con la base local.

---

## 4. Preparar PostgreSQL

### 4.1 Levantar la base

Asegúrate de que Docker Desktop está abierto y ejecuta:

```powershell
docker compose up -d postgres
```

Comprueba que está sana:

```powershell
docker ps --filter name=dental-postgres
```

Debe aparecer `dental-postgres` con estado `Up ... (healthy)`.

### 4.2 Aplicar el esquema

```powershell
npm run db:migrate
```

Esto aplica la migración `20261028223413_init` y genera el cliente de Prisma. La primera vez puede tardar un poco.

Si pregunta por el nombre de una migración, es que modificaste el esquema: escribe `init` y pulsa Enter.

### 4.3 Cargar datos de demostración (opcional, recomendado)

```powershell
npm run db:seed
```

Crea:

- los protocolos de tratamiento (endodoncia, ortodoncia, prótesis, etc.);
- la paciente Ana Ruiz;
- tres pacientes de demostración (Luis, Mariana y Carlos) para que el panel no arranque vacío.

> Los pacientes de demostración llevan la nota `Paciente de demostración (seed)`. **Bórralos antes de producción** (ver [sección 14](#14-checklist-antes-de-producción)).

### 4.4 Ver la base (opcional)

```powershell
npm run db:studio
```

Abre <http://localhost:5555> con una vista de todas las tablas. Útil para comprobar datos o borrar los de demo con la interfaz.

### 4.5 Si ya tienes PostgreSQL propio

No levantes el contenedor. Cambia `DATABASE_URL` en `.env` por tu conexión, crea la base `dental_care` y ejecuta igual `npm run db:migrate`.

Si el puerto `5432` está ocupado por otro PostgreSQL, cambia el mapeo en `docker-compose.yml`:

```yaml
ports:
  - "5433:5432"
```

y actualiza `DATABASE_URL` a `...@localhost:5433/...`.

---

## 5. Primer arranque y panel

### 5.1 Arrancar en desarrollo

```powershell
npm run dev
```

Salida esperada (resumida):

```
🦷 DentalCare Retention Engine
   Entorno: development · Zona: America/Mexico_City
✅ Base de datos conectada
⚠️  Google Calendar sin configurar (falta GOOGLE_REFRESH_TOKEN).
✅ N recordatorio(s) programados para las próximas citas
🚀 HTTP en http://localhost:3000
   Panel:   http://localhost:3000/panel
   Webhook: POST http://localhost:3000/webhook/whatsapp
   Salud:   GET  http://localhost:3000/health
   ⚠️  Panel sin contraseña: sólo accesible desde localhost (define PANEL_PASSWORD).
🕒 Hora del consultorio: ...
[scheduler] Activo (zona America/Mexico_City): recordatorios cada 5 min, agenda 07:30, sincronización 08:00, sin confirmar 09:00, seguimiento 18:00
```

Deja esta ventana abierta: es el servidor. Para detenerlo, `Ctrl+C`.

### 5.2 Abrir el panel

<http://localhost:3000/panel>

Si definiste `PANEL_PASSWORD`, el navegador pedirá usuario (`asistente`) y contraseña.

Recorre las pestañas:

| Pestaña | Qué probar |
|---------|------------|
| **Hoy** | Confirmar una cita, moverla, cancelarla, marcarla completada. |
| **Pendientes** | Citas de las próximas 48 h sin confirmar y tratamientos pasados de intervalo. |
| **Tratamientos** | El caso de Carlos (completado hace días) debe aparecer con severidad. |
| **Pacientes** | Buscar, activar el consentimiento y **agregar/corregir el teléfono**. |
| **Conversaciones** | Historial y respuesta manual (necesita WhatsApp conectado para enviar). |

> **El teléfono es imprescindible.** Los pacientes creados desde Google Calendar
> llegan **sin teléfono**. En `Pacientes` pulsa **Agregar teléfono**, escribe el
> número con WhatsApp y activa el interruptor **WhatsApp** (consentimiento).
> Sin esas dos cosas no se envía nada.

### 5.3 Comprobar la salud del sistema

<http://localhost:3000/health>

```json
{
  "ok": false,
  "baseDeDatos": "ok",
  "whatsapp": "ECONNREFUSED",
  "googleCalendar": "sin configurar",
  "llm": "solo reglas",
  "panel": "sólo localhost"
}
```

Es normal que `ok` sea `false` y `whatsapp` falle: Evolution todavía no está levantado. El panel funciona igual; sólo los envíos fallarán con un aviso claro.

### 5.4 Ver una conversación sin WhatsApp ni Google (opcional)

```powershell
npm run demo
```

Ejercita el mismo cerebro del bot con datos en memoria: confirmar, reprogramar en lenguaje natural, cancelar y preguntar precios. No toca la base ni envía mensajes.

---

## 6. Conectar WhatsApp (Evolution API)

> **Antes de empezar:** Evolution API usa la API no oficial de WhatsApp
> (Baileys). Funciona muy bien para un consultorio pequeño, pero WhatsApp puede
> suspender números que hacen automatizaciones masivas. Con volumen bajo,
> consentimiento y mensajes útiles el riesgo es bajo, no nulo. Si necesitas
> cumplimiento estricto, la alternativa es la API oficial de WhatsApp Business
> (Meta/Twilio), que requiere otro adaptador.

### 6.1 Levantar Evolution

```powershell
docker compose up -d evolution-api
```

Comprueba que arrancó:

```powershell
docker ps --filter name=evolution-api
docker compose logs --tail 50 evolution-api
```

Debe aparecer `evolution-api` en estado `Up`.

### 6.2 Abrir el administrador

<http://localhost:8080/manager>

Pide la **API Key**: es el valor de `EVOLUTION_API_KEY` en tu `.env` (el mismo que ve la aplicación).

### 6.3 Crear la instancia y escanear el QR

1. En el administrador, pulsa **Create instance** (o *New Instance*).
2. Nombre: **`consultorio-laura`** — debe ser idéntico a `EVOLUTION_INSTANCE`.
3. Integración: **WHATSAPP-BAILEYS**.
4. Guarda y abre la instancia; aparecerá un **QR**.
5. En el teléfono del consultorio (el número **desde el que** se enviarán los recordatorios): **WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo**.
6. Escanea el QR.

El QR caduca en menos de un minuto. Si se vence, pulsa **Refresh / Connect** para generar otro.

Cuando termine, el estado de la instancia debe ser **`open`**.

> El teléfono puede seguir usando WhatsApp normalmente: esto lo vincula como un
> dispositivo más, no lo reemplaza. No cierres sesión desde el teléfono ni
> desvincules el dispositivo.

### 6.4 Comprobar la conexión desde el sistema

```powershell
Invoke-RestMethod http://localhost:3000/health | ConvertTo-Json
```

Ahora `"whatsapp": "open"` y `"ok": true` (si la base está bien). En el panel desaparece la franja de “WhatsApp sin conexión”.

### 6.5 Configurar el webhook

El webhook es cómo WhatsApp le avisa al sistema que un paciente escribió.

**Caso A — la app corre en tu computadora (`npm run dev`), Evolution en Docker:**

URL:

```
http://host.docker.internal:3000/webhook/whatsapp
```

Evento: **`MESSAGES_UPSERT`** (sólo ese).

En el administrador: instancia → **Webhook** → activar → pegar la URL → marcar el evento → guardar.

**Caso B — todo corre con `docker compose up -d` (app incluida):**

URL:

```
http://app:3000/webhook/whatsapp
```

**Caso C — Evolution instalado fuera de Docker, en la misma máquina:**

```
http://localhost:3000/webhook/whatsapp
```

> **Linux:** `host.docker.internal` no existe por defecto. Añade al servicio
> `evolution-api` en `docker-compose.yml`:
>
> ```yaml
> extra_hosts:
>   - "host.docker.internal:host-gateway"
> ```
>
> y vuelve a levantar el contenedor. En Docker Desktop (Windows/macOS) ya funciona.

**Alternativa por API** (si prefieres no usar la interfaz):

```powershell
$clave = "TU_EVOLUTION_API_KEY"
$cuerpo = @{
  webhook = @{
    enabled = $true
    url = "http://host.docker.internal:3000/webhook/whatsapp"
    webhookByEvents = $false
    events = @("MESSAGES_UPSERT")
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/webhook/set/consultorio-laura" `
  -Headers @{ apikey = $clave } `
  -ContentType "application/json" `
  -Body $cuerpo
```

> **Secreto del webhook:** `EVOLUTION_WEBHOOK_SECRET` es opcional. Si lo defines,
> el sistema exige la cabecera `x-webhook-secret`; tendrás que configurarla en
> Evolution (sólo si tu versión permite cabeceras personalizadas). Para uso local
> déjalo vacío y no expongas el puerto a internet.

### 6.6 Probar de verdad

1. Desde **otro** teléfono (no el del consultorio), envía `hola` al número vinculado.
2. En el panel → **Conversaciones** debe aparecer el mensaje.
3. En la ventana del servidor verás actividad del webhook.
4. Si el número no está registrado como paciente, el bot no responde: es correcto
   (primero hay que registrarlo y dar consentimiento).

### 6.7 Enviar un recordatorio real

1. Panel → **Pacientes** → busca a un paciente de prueba.
2. **Agregar teléfono** con **tu** número (el que tiene WhatsApp) y guarda.
3. Activa el interruptor **WhatsApp** (consentimiento).
4. Ve a **Hoy** y pulsa **Recordar** en una cita futura.
5. El mensaje debe llegar en segundos.

Si falla, el panel muestra una frase entendible (“La instancia de WhatsApp no está conectada…”) y el detalle técnico queda en la consola.

### 6.8 Cómo se guardan los teléfonos

- El sistema guarda **los últimos 10 dígitos** (así llegan los mensajes entrantes).
- Al enviar, antepone la lada de `WHATSAPP_PAIS` (`52` para México).
- Da igual si escribes `55 1234 5678`, `+52 1 55 1234 5678` o `5215512345678`: el panel lo normaliza.
- Está pensado para números mexicanos. Para otro país, cambia `WHATSAPP_PAIS`.

---

## 7. Conectar Google Calendar

Sin este paso el sistema funciona con la base local, pero no lee ni escribe la agenda real.

### 7.1 Crear el proyecto en Google Cloud

1. Entra a <https://console.cloud.google.com/> con la cuenta del consultorio.
2. Arriba, **Seleccionar proyecto → Nuevo proyecto**. Nombre: `Consultorio Laura`.
3. Con el proyecto seleccionado: **APIs y servicios → Biblioteca**.
4. Busca **Google Calendar API** → **Habilitar**.

### 7.2 Configurar la pantalla de consentimiento

1. **APIs y servicios → Pantalla de consentimiento de OAuth**.
2. Tipo de usuario:
   - **Interno**, si la cuenta es de Google Workspace del consultorio (lo más simple).
   - **Externo**, si es un Gmail normal.
3. Completa nombre de la app (`Consultorio Dra. Laura`), correo de soporte y correo del desarrollador.
4. En **Permisos**, añade el permiso `.../auth/calendar` (Calendar API).
5. Si es **Externo**, agrega la cuenta del consultorio en **Usuarios de prueba**.
6. **Publica la app**: en *Estado de publicación*, pulsa **Publicar app** (pasar de *Testing* a *In production*).

> **Por qué publicar:** mientras la app está en *Testing*, Google caduca el
> `refresh_token` **cada 7 días** y habría que repetir `npm run oauth` cada
> semana. Publicada, el token dura hasta que se revoque.
>
> Al ser un permiso sensible, Google mostrará “esta app no está verificada”.
> Es normal en una app privada: **Configuración avanzada → Ir a Consultorio
> Dra. Laura (no seguro)**. Para un solo consultorio no necesitas el proceso de
> verificación público.

### 7.3 Crear las credenciales

1. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**.
2. Tipo: **Aplicación de escritorio**.
3. Nombre: `Consultorio Laura - escritorio`.
4. Copia **ID de cliente** y **Secreto de cliente** en `.env`:

```env
GOOGLE_CLIENT_ID="123456789-abc.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-..."
```

No necesitas registrar la URL de redirección: para una app de escritorio, Google acepta cualquier puerto local (`http://127.0.0.1:53682`) sin darlo de alta.

### 7.4 Obtener el refresh token

Con el servidor detenido o en otra ventana (no importa), ejecuta:

```powershell
npm run oauth
```

Qué ocurre:

1. Se abre el navegador con la pantalla de permisos de Google.
2. Elige la cuenta del consultorio y autoriza el acceso al calendario.
3. Google redirige a `http://127.0.0.1:53682/oauth2callback`; verás “Listo ✅”.
4. La terminal guarda `GOOGLE_REFRESH_TOKEN` en `.env` automáticamente.

Reinicia el servidor (`Ctrl+C` y `npm run dev`) para que tome el token nuevo.

Si el navegador no se abre, copia la URL que imprime la terminal. Si el puerto
`53682` está ocupado, cierra el programa que lo usa y reintenta.

**En un servidor sin navegador:** ejecuta `npm run oauth` en tu computadora (con
el mismo `GOOGLE_CLIENT_ID/SECRET`), copia el valor de `GOOGLE_REFRESH_TOKEN` y
pégalo en el `.env` del servidor. También puedes usar
`$env:OAUTH_NO_BROWSER="1"` y un túnel SSH del puerto 53682.

### 7.5 Probar la sincronización

```powershell
npm run sync:calendar
```

Salida esperada:

```
Sincronizando primary…
✅ Sincronización terminada
   Eventos leídos:     N
   Citas nuevas:       N
   Citas actualizadas: N
   Citas omitidas:     N
```

Por defecto lee **desde ahora hasta 90 días** hacia adelante. Para un rango concreto:

```powershell
$env:SYNC_DESDE="2026-11-01"; $env:SYNC_HASTA="2026-12-01"; npm run sync:calendar
```

### 7.6 La convención del título (lo más importante)

Sólo se importan eventos cuyo título tenga el formato:

```
Nombre del paciente - motivo
```

Ejemplos válidos:

- `Ana Ruiz - endodoncia`
- `Luis Hernández - limpieza`
- `Mariana López - revisión ortodoncia`

Los demás se **ignoran a propósito** (mejor no inventar pacientes que llenar la base de basura).

- El motivo se usa para asignar el tipo de tratamiento y el protocolo de seguimiento.
- El nombre debe ser el del paciente, no el del acompañante.
- Puedes mover/cancelar la cita desde el panel: se actualiza el mismo evento en Google Calendar.

> **Sincronización diaria:** el sistema vuelve a leer el calendario a las **08:00**
> (hora del consultorio). Si agregas una cita a las 10:00, no aparecerá en el
> panel hasta el día siguiente… o hasta que ejecutes `npm run sync:calendar` o
> reinicies el servidor.

### 7.7 Varios calendarios

`CALENDAR_IDS` acepta una lista separada por comas:

```env
CALENDAR_IDS="primary,consultorio@clinica.mx"
```

La cuenta autorizada debe tener acceso a todos. Para calendarios compartidos, usa el ID que aparece en **Configuración del calendario → Integrar calendario**.

### 7.8 Qué hace la sincronización

- Crea o actualiza pacientes y citas en PostgreSQL (la agenda de Google manda).
- Asigna tratamiento según el motivo (`endodoncia`, `ortodoncia`, etc.).
- Recalcula los recordatorios de las citas futuras.
- No borra citas canceladas en Google: las marca y deja de recordarlas.

---

## 8. Activar la IA (opcional)

Sin IA el bot ya entiende lo esencial: “sí”, “no”, “no puedo”, “cámbiame al
jueves a las 5”, “cancelar”, precios, horarios y dirección. Las reglas en
español tienen prioridad y son predecibles.

Con IA, los mensajes ambiguos (“ando viendo si alcanzo, creo que sí pero
depende”) pasan a un modelo. Configura en `.env`:

**OpenAI u otro compatible:**

```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
```

**Ollama local (los mensajes no salen de la computadora):**

```env
LLM_PROVIDER=openai
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.2:3b
LLM_API_KEY=ollama
```

Reinicia el servidor. En `/health` debe decir `"llm": "gpt-4o-mini"` (o el modelo elegido) en lugar de `"solo reglas"`.

> **Privacidad:** con un proveedor externo, el texto del paciente sale de tu
> infraestructura. Si eso te preocupa, usa Ollama o deja la IA desactivada.
> El bot nunca diagnostica ni negocia tratamientos: eso se escala a la asistente.

---

## 9. Prueba de punta a punta

Haz esta lista en orden. Marca cada casilla cuando funcione.

### A. Agenda y sincronización

- [ ] Crea en Google Calendar un evento **mañana a las 10:00** titulado `Tu Nombre - limpieza`.
- [ ] Ejecuta `npm run sync:calendar`.
- [ ] En el panel → **Hoy** o **Pendientes** aparece la cita.
- [ ] En **Pacientes** aparece el paciente, **sin teléfono**.

### B. Teléfono y consentimiento

- [ ] En **Pacientes**, pulsa **Agregar teléfono** y escribe tu número.
- [ ] Activa el interruptor **WhatsApp**.
- [ ] El panel confirma que se programaron los recordatorios.

### C. Recordatorio manual

- [ ] En **Hoy**, pulsa **Recordar**.
- [ ] El mensaje llega a tu WhatsApp con el nombre y la hora correctos.
- [ ] En **Conversaciones** aparece como mensaje saliente.

### D. Confirmación por WhatsApp

- [ ] Responde `Sí, asistiré`.
- [ ] En unos segundos, la cita pasa a **CONFIRMADA** en el panel.
- [ ] Llega una respuesta de confirmación al WhatsApp.

### E. Reprogramación en lenguaje natural

- [ ] Responde `No puedo, cámbiame al jueves a las 5`.
- [ ] El bot propone o confirma la nueva fecha.
- [ ] La cita se mueve en el panel **y** en Google Calendar (mismo evento).
- [ ] Los recordatorios se recalculan para la nueva fecha.

### F. Cancelación

- [ ] Responde `Cancela mi cita`.
- [ ] La cita queda como **CANCELADA_POR_PACIENTE** y no se envían más recordatorios.

### G. Seguimiento multisesión

- [ ] Marca una cita como **Completada** desde el panel.
- [ ] En **Tratamientos** aparece el tratamiento con los días transcurridos.
- [ ] Pulsa **Enviar seguimiento** y comprueba el mensaje.
- [ ] (Automático) el scheduler revisa tratamientos todos los días a las **18:00**.

### H. Operación del panel

- [ ] Mover una cita avisa al paciente y refleja el cambio en Calendar.
- [ ] Cancelar una cita no envía recordatorios posteriores.
- [ ] El panel no se refresca mientras escribes una respuesta.

---

## 10. Operación diaria

### 10.1 Horario automático

| Hora | Qué hace |
|------|----------|
| Cada 5 min | Envía los recordatorios vencidos (3 días, 24 h, 2 h, mismo día). |
| 07:30 | Resumen del día a la asistente (si hay alertas configuradas). |
| 08:00 | Sincroniza Google Calendar y recalcula recordatorios. |
| 09:00 | Avisa de citas de mañana sin confirmar. |
| 18:00 | Seguimiento de tratamientos multisesión. |

**Ventana de envío: 08:00–21:00.** Si un recordatorio vence de madrugada, se
pospone a las 08:00. Nunca se escribe a un paciente a las 3 de la mañana.

### 10.2 La mañana de la asistente

1. Abre el panel en la tablet.
2. Revisa la franja superior: si dice **WhatsApp sin conexión**, escanea el QR.
3. Pestaña **Hoy**: confirma las citas que llegaron por teléfono.
4. Pestaña **Pendientes**: resuelve lo que el bot no pudo.
5. Pestaña **Tratamientos**: envía seguimiento a quien ya pasó su intervalo.
6. Pestaña **Conversaciones**: responde lo que quedó a medias.

### 10.3 Reglas que el sistema respeta siempre

- Sin **consentimiento** (`consentWhatsapp`) no se envía nada.
- Sin **teléfono** no se envía nada.
- No se recuerda una cita cancelada, completada o pasada.
- No se mueve una cita completada o cancelada.
- El seguimiento sólo aplica a citas **completadas**.
- Un botón de WhatsApp gana sobre cualquier interpretación del modelo.
- Todo lo dudoso se deriva a la asistente.

### 10.4 Detener y reiniciar

```powershell
# Detener la app
Ctrl+C

# Detener contenedores (conserva datos)
docker compose stop

# Volver a arrancar
docker compose start
npm run dev
```

> `docker compose down` elimina los contenedores pero **conserva** los volúmenes
> (datos). `docker compose down -v` **borra la base de datos**: úsalo sólo para
> empezar de cero.

---

## 11. Pruebas y compilación

```powershell
npm test            # 110 pruebas, no necesitan Docker ni credenciales
npm run typecheck   # TypeScript estricto
npm run build       # compila a dist/
npm run demo        # conversación de ejemplo sin infraestructura
```

Si `npm test` falla en tu máquina, revisa que Node sea 20+ y que no haya un
`.env` inválido: las pruebas usan su propio entorno y no tocan tu base.

Para producción:

```powershell
npm run build
npm start           # ejecuta dist/, sirve el panel desde public/
```

> `npm start` debe ejecutarse desde la raíz del proyecto: el panel se sirve desde
> `public/` relativo al directorio de trabajo.

---

## 12. Pasar a producción

### 12.1 Opción A — Todo en Docker (recomendado)

```powershell
docker compose up -d --build
```

- El contenedor `app` aplica las migraciones solo y arranca.
- El panel queda en `http://localhost:3000/panel`.
- Evolution y PostgreSQL quedan en la red interna de Docker.
- El webhook debe apuntar a `http://app:3000/webhook/whatsapp`.

**Obligatorio en este modo:** define `PANEL_PASSWORD`. Sin contraseña, el panel
sólo acepta peticiones desde dentro del contenedor (es decir, no podrás abrirlo
desde el navegador).

### 12.2 Opción B — App nativa, servicios en Docker

Es el modo de desarrollo, pero con:

- `npm run build`;
- un gestor de procesos (PM2, NSSM o Tarea Programada de Windows) que ejecute `npm start` al arrancar;
- `PANEL_PASSWORD` definido;
- el webhook apuntando a `http://host.docker.internal:3000/webhook/whatsapp`.

### 12.3 HTTPS y acceso remoto

Si la asistente abrirá el panel desde fuera del consultorio, **no publiques el
puerto 3000 en claro**: la autenticación Basic viaja en Base64 y sin TLS es
equivalente a enviar la contraseña.

Opciones, de más segura a menos:

1. **VPN / Tailscale** (recomendado): el panel sigue siendo “local” para la red privada.
2. **Proxy inverso con HTTPS** (Caddy es el más simple):

   ```caddyfile
   panel.consultorio.mx {
     reverse_proxy localhost:3000
   }
   ```

   Caddy obtiene el certificado automáticamente.

3. Túnel de Cloudflare con acceso restringido por correo.

Además:

- No expongas `5432` (PostgreSQL) ni `8080` (Evolution) a internet.
- Si usas un proxy, limita `/panel` y `/api/panel` por IP o por VPN.
- Mantén el servidor y las imágenes actualizados.

### 12.4 Respaldo de la base

Copia de seguridad:

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
docker exec dental-postgres pg_dump -U dental_user -d dental_care -Fc -f /tmp/dental.dump
docker cp dental-postgres:/tmp/dental.dump ".\backups\dental-$(Get-Date -Format yyyyMMdd-HHmm).dump"
```

Restauración (detén la app antes para que no haya conexiones abiertas):

```powershell
docker cp ".\backups\dental-20261028-0900.dump" dental-postgres:/tmp/restore.dump
docker exec dental-postgres pg_restore -U dental_user -d dental_care --clean --if-exists /tmp/restore.dump
```

Programa la copia diaria con el Programador de tareas de Windows y guarda los archivos **fuera** de la carpeta del proyecto (por ejemplo, en un disco externo o nube).

### 12.5 Actualizar el sistema

```powershell
# Detener
docker compose down

# Actualizar dependencias (si cambió package.json)
npm install

# Recompilar y levantar
docker compose up -d --build
```

Si actualizas sólo el código nativo: `npm run build` y reinicia el proceso.

### 12.6 Borrar los datos de demostración

Con Prisma Studio (`npm run db:studio`) o por SQL:

```powershell
docker exec dental-postgres psql -U dental_user -d dental_care -c "DELETE FROM pacientes WHERE nota LIKE '%demostraci%';"
```

Elimina en cascada sus citas, sesiones y recordatorios. Los mensajes sueltos de
esos teléfonos pueden quedar; no afectan la operación.

---

## 13. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `Configuración inválida...` al arrancar | Falta una variable obligatoria en `.env` | Revisa el mensaje: nombra la variable exacta. |
| `No se pudo conectar a PostgreSQL` | Docker apagado o base caída | Abre Docker Desktop; `docker compose up -d postgres`; `docker ps`. |
| `Port 5432 is already allocated` | Otro PostgreSQL usa el puerto | Cambia el mapeo a `5433:5432` y `DATABASE_URL`. |
| `/health` con `"ok": false` y WhatsApp `ECONNREFUSED` | Evolution no está levantado | `docker compose up -d evolution-api`. |
| Panel con “WhatsApp sin conexión” pero Evolution arriba | API key o nombre de instancia distintos | Compara `EVOLUTION_API_KEY` y `EVOLUTION_INSTANCE` con el administrador. |
| El QR no aparece o caduca | Sesión previa o límite de QR | En el administrador, **Logout/Delete** la instancia y créala de nuevo; el QR dura ~30 s. |
| WhatsApp dice “no está en WhatsApp” al enviar | Número sin WhatsApp, sin lada o de otro país | Usa un número mexicano real; revisa `WHATSAPP_PAIS=52`; el panel guarda los últimos 10 dígitos. |
| Los mensajes entrantes no llegan al panel | Webhook mal configurado o inalcanzable | URL correcta (`host.docker.internal` / `app`), evento `MESSAGES_UPSERT`, revisa logs. |
| `npm run oauth` falla con `invalid_grant` | Token revocado o app en *Testing* caducada | Vuelve a ejecutar `npm run oauth`; publica la app en Google Cloud. |
| El token de Google dura sólo 7 días | App en estado *Testing* | **Publicar app** en la pantalla de consentimiento. |
| Google muestra “app no verificada” | App privada sin verificación | **Configuración avanzada → Ir a la app**. |
| `No se pudo abrir http://127.0.0.1:53682` | Puerto ocupado | Cierra el programa que lo usa y reintenta `npm run oauth`. |
| Las citas de Calendar no aparecen | Título sin el formato o calendario no compartido | Usa `Nombre - motivo`; revisa `CALENDAR_IDS`; ejecuta `npm run sync:calendar`. |
| El panel pide contraseña y no la sabes | `PANEL_PASSWORD` definido | Usa `PANEL_USER` (por defecto `asistente`) y la clave del `.env`; o bórrala para uso local. |
| Error 401 desde otra computadora | Panel sin contraseña | Define `PANEL_PASSWORD`; sin ella sólo acepta localhost. |
| No se envían recordatorios | Sin consentimiento, sin teléfono o cita ya pasada | Revisa la ficha del paciente y el estado de la cita. |
| Todo se envía a deshoras | `TIMEZONE` incorrecta | Pon `America/Mexico_City` y reinicia. |
| `npm start` no encuentra el panel | Se ejecutó desde otra carpeta | Ejecútalo desde la raíz del proyecto. |
| Cambié `.env` y no surte efecto | El proceso sigue con la configuración anterior | `Ctrl+C` y `npm run dev`; en Docker, `docker compose up -d --force-recreate app`. |
| Quiero empezar de cero | Datos de prueba | `docker compose down -v`, luego `up -d postgres`, `npm run db:migrate`, `npm run db:seed`. **Borra todo.** |

### Ver logs útiles

```powershell
# App en desarrollo: la consola donde corre npm run dev

# Evolution
docker compose logs -f evolution-api

# PostgreSQL
docker compose logs -f postgres

# Estado de los contenedores
docker compose ps
```

---

## 14. Checklist antes de producción

- [ ] `PANEL_PASSWORD` largo y único; `PANEL_USER` definido.
- [ ] Panel servido por **HTTPS** o accesible sólo por VPN.
- [ ] `EVOLUTION_API_KEY` propio (no el de ejemplo) y instancia en estado `open`.
- [ ] Webhook apuntando a la URL correcta y evento `MESSAGES_UPSERT`.
- [ ] `GOOGLE_REFRESH_TOKEN` guardado; app de Google **publicada** (no *Testing*).
- [ ] `TIMEZONE=America/Mexico_City` y `WHATSAPP_PAIS=52`.
- [ ] `CALENDAR_IDS` con los calendarios reales.
- [ ] Pacientes de demostración eliminados.
- [ ] Teléfonos y consentimiento cargados para los pacientes reales.
- [ ] Prueba real con tu propio WhatsApp (recordatorio, “sí”, reprogramación).
- [ ] Copia de seguridad automática de PostgreSQL configurada y **probada**.
- [ ] Puertos `5432` y `8080` cerrados al exterior.
- [ ] Aviso de privacidad / consentimiento de WhatsApp conforme a la ley aplicable.
- [ ] Decidir si se usa IA externa o sólo reglas (y avisarlo a los pacientes).
- [ ] Documentar quién es la persona que revisa el panel cada mañana.

---

## 15. Referencia de comandos

| Comando | Para qué |
|---------|----------|
| `npm install` | instalar dependencias |
| `npm run dev` | servidor en desarrollo con recarga |
| `npm run build` | compilar a `dist/` |
| `npm start` | ejecutar la versión compilada |
| `npm test` | 110 pruebas automáticas |
| `npm run typecheck` | comprobar TypeScript |
| `npm run demo` | conversación de ejemplo sin infraestructura |
| `npm run db:migrate` | aplicar migraciones (desarrollo) |
| `npm run db:seed` | cargar tratamientos y datos de demostración |
| `npm run db:studio` | abrir Prisma Studio en `:5555` |
| `npm run oauth` | obtener el `refresh_token` de Google |
| `npm run sync:calendar` | sincronizar Google Calendar a mano |
| `docker compose up -d postgres` | levantar la base |
| `docker compose up -d evolution-api` | levantar WhatsApp |
| `docker compose up -d --build` | levantar todo (incluida la app) |
| `docker compose ps` | ver estado de contenedores |
| `docker compose logs -f evolution-api` | ver logs de WhatsApp |
| `docker compose stop` | detener sin borrar datos |
| `docker compose down` | detener y eliminar contenedores (conserva volúmenes) |

---

## Apéndice — Cómo funciona por dentro (para entender lo que estás operando)

```
Paciente
   │ WhatsApp
   ▼
Evolution API ──webhook──► Express /webhook/whatsapp
                               │
                               ├─► NLU: botón → reglas español → LLM (opcional)
                               │
                               ├─► PostgreSQL: citas, mensajes, sesiones
                               │
                               └─► Google Calendar: mover / cancelar / crear

node-cron (cada 5 min) ──► recordatorios pendientes ──► Evolution
node-cron (18:00)      ──► seguimiento de tratamientos ──► Evolution
Panel (/panel)         ──► mismas acciones, con la asistente al mando
```

### Tablas principales

| Tabla | Qué guarda |
|-------|------------|
| `pacientes` | nombre, teléfono (últimos 10 dígitos) y consentimiento |
| `citas` | fecha, estado, vínculo con el evento de Google |
| `recordatorios_envios` | cola persistente: qué enviar y cuándo |
| `sesiones` | sesiones completadas de un tratamiento |
| `mensajes` | historial de conversaciones (entrantes y salientes) |
| `tratamientos` | protocolos: sesiones esperadas e intervalo |

### Dónde tocar si algo cambia

| Quiero cambiar… | Archivo |
|-----------------|---------|
| los textos de los mensajes | `src/services/mensajes.ts` |
| los intervalos de seguimiento | `src/services/protocolos.ts` |
| los horarios de los cron | `src/scheduler/index.ts` |
| la ventana 08:00–21:00 | `src/scheduler/recordatorios.service.ts` |
| el diseño del panel | `public/styles.css` |
| la lógica de la pantalla | `public/app.js` |
| las rutas del panel | `src/routes/panel.routes.ts` |
| el esquema de datos | `prisma/schema.prisma` |

### Documentos de apoyo

- `README.md` — resumen del producto y decisiones.
- `docs/ARCHITECTURE.md` — arquitectura, módulos y modos de falla.
- `docs/FLUJOS_CONVERSACIONALES.md` — qué dice el bot en cada situación.
- `docs/CALIDAD_CI.md` — estrategia de pruebas y CI.
