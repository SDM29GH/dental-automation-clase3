/**
 * Panel del consultorio — JavaScript sin dependencias ni build.
 *
 * Regla de diseño: la asistente tiene que resolver en un clic lo que antes
 * hacía abriendo WhatsApp Web y Google Calendar. Todo lo que se muestra viene
 * de /api/panel; no hay datos inventados en el cliente.
 */
"use strict";

const ETIQUETAS_ESTADO = {
  AGENDADA: "Sin confirmar",
  CONFIRMADA: "Confirmada",
  COMPLETADA: "Completada",
  NO_SHOW: "No asistió",
  CANCELADA_POR_PACIENTE: "Canceló el paciente",
  CANCELADA_POR_CLINICA: "Cancelada",
  REAGENDADA: "Movida",
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const estado = {
  tab: "hoy",
  zona: "America/Mexico_City",
  resumen: null,
  citas: [],
  pendientes: null,
  tratamientos: [],
  pacientes: [],
  busqueda: "",
  conversaciones: [],
  telefonoActivo: null,
  hilo: null,
  cargando: false,
  citaMover: null,
  pacienteTelefono: null,
  whatsapp: null,
  whatsappConsultadoEn: 0,
};

const $ = (selector) => document.querySelector(selector);
const vista = $("#vista");
const dialogo = $("#dialogo-mover");
const dialogoTelefono = $("#dialogo-telefono");
const toastEl = $("#toast");

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (caracter) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[caracter]);
}

function partes(iso) {
  const trozos = new Intl.DateTimeFormat("en-CA", {
    timeZone: estado.zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const valor = (tipo) => trozos.find((t) => t.type === tipo)?.value ?? "00";
  return {
    fecha: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour") === "24" ? "00" : valor("hour")}:${valor("minute")}`,
  };
}

function partesFecha(iso) {
  const trozos = new Intl.DateTimeFormat("en-CA", {
    timeZone: estado.zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const valor = (tipo) => Number(trozos.find((t) => t.type === tipo)?.value ?? 0);
  const anio = valor("year");
  const mes = valor("month");
  const dia = valor("day");
  return { anio, mes, dia, diaSemana: new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() };
}

function fechaLarga(iso) {
  const p = partesFecha(iso);
  return `${DIAS[p.diaSemana]}, ${p.dia} de ${MESES[p.mes - 1]}`;
}

function horaCorta(iso) {
  return partes(iso).hora;
}

function fechaCorta(iso) {
  const p = partesFecha(iso);
  return `${DIAS[p.diaSemana]} ${p.dia} ${MESES[p.mes - 1].slice(0, 3)} · ${partes(iso).hora}`;
}

function hace(iso) {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

function telefonoBonito(telefono) {
  if (!telefono) return "sin teléfono";
  const limpio = telefono.replace(/\D/g, "");
  if (limpio.length === 10) return `${limpio.slice(0, 2)} ${limpio.slice(2, 6)} ${limpio.slice(6)}`;
  return `+${limpio}`;
}

function enlaceWhatsapp(telefono) {
  const limpio = String(telefono ?? "").replace(/\D/g, "");
  if (!limpio) return null;
  const completo = limpio.length === 10 ? `52${limpio}` : limpio;
  return `https://wa.me/${completo}`;
}

function esFutura(iso) {
  return new Date(iso).getTime() > Date.now();
}

function boton(accion, id, texto, clases = "", extra = "") {
  return `<button type="button" class="btn ${clases}" data-accion="${accion}" data-id="${esc(id)}" ${extra}>${esc(texto)}</button>`;
}

let temporizadorToast = null;
function avisar(mensaje, tipo = "exito") {
  toastEl.textContent = mensaje;
  toastEl.className = `toast ${tipo}`;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => {
    toastEl.className = "toast oculto";
  }, 4200);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`/api/panel${ruta}`, {
    method: opciones.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });

  if (respuesta.status === 401) {
    throw new Error("Sesión no autorizada. Recarga la página e inicia sesión.");
  }

  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || cuerpo.ok === false) {
    throw new Error(cuerpo.error ?? `Error ${respuesta.status}`);
  }
  return cuerpo.datos;
}

function marcarConexion(conectado) {
  const caja = $("#conexion");
  caja.classList.toggle("ok", conectado);
  caja.classList.toggle("error", !conectado);
  caja.title = "Conexión con el servidor del panel (el estado de WhatsApp se avisa aparte)";
  $("#conexion-texto").textContent = conectado ? "Panel en línea" : "Panel sin conexión";
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

async function cargar(silencioso = false) {
  if (estado.cargando) return;
  estado.cargando = true;
  if (!silencioso) vista.innerHTML = `<div class="cargando">Cargando agenda…</div>`;

  try {
    estado.resumen = await api("/resumen");
    estado.zona = estado.resumen.zona;
    actualizarCabecera();
    await cargarPestana();
    marcarConexion(true);
    verificarWhatsapp();
  } catch (error) {
    marcarConexion(false);
    if (!silencioso) {
      vista.innerHTML = `<div class="vacio"><strong>No se pudo cargar el panel</strong>${esc(error.message)}</div>`;
    }
  } finally {
    estado.cargando = false;
  }
}

async function cargarPestana() {
  switch (estado.tab) {
    case "hoy":
      estado.citas = await api("/citas?rango=hoy");
      renderHoy();
      break;

    case "pendientes":
      estado.pendientes = await api("/pendientes");
      renderPendientes();
      break;

    case "tratamientos":
      estado.tratamientos = await api("/tratamientos");
      renderTratamientos();
      break;

    case "pacientes":
      estado.pacientes = await api(`/pacientes${estado.busqueda ? `?q=${encodeURIComponent(estado.busqueda)}` : ""}`);
      renderPacientes();
      break;

    case "conversaciones":
      estado.conversaciones = await api("/conversaciones");
      if (estado.telefonoActivo) {
        try {
          estado.hilo = await api(`/conversaciones/${encodeURIComponent(estado.telefonoActivo)}`);
        } catch {
          estado.telefonoActivo = null;
          estado.hilo = null;
        }
      }
      renderConversaciones();
      break;
  }
  actualizarContadores();
}

function actualizarCabecera() {
  const ahora = new Date().toISOString();
  $("#fecha").textContent = `${fechaLarga(ahora)} · ${horaCorta(ahora)}`;
  $("#zona").textContent = estado.zona;
}

function actualizarContadores() {
  const resumen = estado.resumen;
  if (!resumen) return;

  // Aproximación honesta mientras no se abrió la pestaña: lo que el resumen ya
  // sabe que requiere atención. En la pestaña Pendientes el número es exacto.
  const pendientes = estado.pendientes
    ? estado.pendientes.citas.length +
      estado.pendientes.tratamientos.length +
      estado.pendientes.conversaciones.length
    : resumen.hoy.porConfirmar + resumen.enRiesgo + resumen.sinResponder;
  const conversaciones = resumen.sinResponder;

  const poner = (id, valor, mostrar) => {
    const elemento = $(id);
    elemento.textContent = valor > 99 ? "99+" : String(valor);
    elemento.classList.toggle("oculto", !mostrar);
  };

  poner("#c-pendientes", pendientes, pendientes > 0);
  poner("#c-tratamientos", resumen.enRiesgo, resumen.enRiesgo > 0);
  poner("#c-conversaciones", conversaciones, conversaciones > 0);

  const aviso = $("#aviso");
  const partesAviso = [];
  if (resumen.hoy.porConfirmar > 0) {
    partesAviso.push(`${resumen.hoy.porConfirmar} cita(s) de hoy sin confirmar`);
  }
  if (resumen.enRiesgo > 0) {
    partesAviso.push(`${resumen.enRiesgo} tratamiento(s) en riesgo de abandono`);
  }
  if (resumen.sinResponder > 0) {
    partesAviso.push(`${resumen.sinResponder} conversación(es) sin responder`);
  }

  const whatsappCaido = estado.whatsapp && !estado.whatsapp.conectado;
  if (whatsappCaido) {
    partesAviso.push("WhatsApp sin conexión: los mensajes no saldrán hasta reconectar Evolution");
  }

  if (partesAviso.length === 0) {
    aviso.classList.add("oculto");
    aviso.innerHTML = "";
  } else {
    aviso.classList.remove("oculto");
    aviso.innerHTML = `${esc(partesAviso.join(" · "))} ${
      pendientes > 0 ? `<button type="button" data-ir="pendientes">Revisar</button>` : ""
    }`;
  }
}

/**
 * Estado real de WhatsApp. Se consulta cada 5 minutos (no en cada refresco):
 * el health check habla con Evolution y no queremos castigar al servidor.
 */
async function verificarWhatsapp() {
  if (Date.now() - estado.whatsappConsultadoEn < 5 * 60_000) return;
  estado.whatsappConsultadoEn = Date.now();

  try {
    const respuesta = await fetch("/health");
    const datos = await respuesta.json();
    const detalle = String(datos.whatsapp ?? "desconocido");
    estado.whatsapp = {
      conectado: ["open", "connected", "simulado"].includes(detalle),
      detalle,
    };
  } catch {
    // Si ni el health responde, el panel ya muestra "Sin conexión".
    return;
  }

  if (estado.resumen) actualizarContadores();
}

// ---------------------------------------------------------------------------
// Fragmentos
// ---------------------------------------------------------------------------

function pillEstado(estadoCita) {
  const clave = estadoCita.toLowerCase();
  const clase = clave.startsWith("cancelada") ? "cancelada" : clave;
  return `<span class="pill ${clase}">${esc(ETIQUETAS_ESTADO[estadoCita] ?? estadoCita)}</span>`;
}

function accionesCita(cita) {
  const botones = [];
  const futura = esFutura(cita.fecha);
  const activa = ["AGENDADA", "CONFIRMADA", "REAGENDADA"].includes(cita.estado);

  if (futura && activa && cita.estado === "AGENDADA") {
    botones.push(boton("confirmar", cita.id, "Confirmar", "btn-primario btn-mini"));
  }
  if (futura && activa && cita.puedeRecordar) {
    botones.push(boton("recordar", cita.id, "Recordar", "btn-mini"));
  }
  if (futura && activa) {
    botones.push(boton("mover", cita.id, "Mover", "btn-mini"));
    botones.push(boton("cancelar", cita.id, "Cancelar", "btn-mini btn-peligro"));
  }
  if (!futura && activa) {
    botones.push(boton("completar", cita.id, "Completada", "btn-primario btn-mini"));
    botones.push(boton("no_show", cita.id, "No asistió", "btn-mini btn-peligro"));
  }
  return botones.join("");
}

function filaCita(cita) {
  const paciente = cita.paciente;
  return `
    <article class="cita">
      <div class="cita-hora">${esc(cita.hora)}</div>
      <div class="cita-info">
        <div class="cita-nombre">
          ${esc(paciente.nombre)}
          ${pillEstado(cita.estado)}
          ${paciente.consentWhatsapp ? "" : `<span class="pill" title="Sin autorización de WhatsApp">sin WhatsApp</span>`}
        </div>
        <div class="cita-meta">
          ${esc(cita.titulo)} · ${esc(telefonoBonito(paciente.telefono))}
          ${cita.recordatorio ? ` · recordatorio ${esc(cita.recordatorio.disparador.replace("D_MINUS_", "-").toLowerCase())}` : ""}
        </div>
      </div>
      <div class="cita-acciones">${accionesCita(cita)}</div>
    </article>`;
}

function vacio(titulo, detalle) {
  return `<div class="vacio"><strong>${esc(titulo)}</strong>${esc(detalle)}</div>`;
}

function tarjeta(valor, etiqueta, clase = "") {
  return `<div class="tarjeta ${clase}"><b>${valor}</b><span>${esc(etiqueta)}</span></div>`;
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

function renderHoy() {
  const resumen = estado.resumen;
  const citas = estado.citas;

  vista.innerHTML = `
    <div class="tarjetas">
      ${tarjeta(resumen.hoy.total, "Citas hoy")}
      ${tarjeta(resumen.hoy.porConfirmar, "Por confirmar", resumen.hoy.porConfirmar ? "alerta" : "")}
      ${tarjeta(resumen.hoy.confirmadas, "Confirmadas", "ok")}
      ${tarjeta(resumen.manana.total, "Mañana")}
      ${tarjeta(resumen.enRiesgo, "Tratamientos en riesgo", resumen.enRiesgo ? "peligro" : "")}
    </div>

    <section class="seccion">
      <h2 class="seccion-titulo">Agenda de hoy <span>${citas.length} cita(s)</span></h2>
      ${citas.length
        ? `<div class="lista">${citas.map(filaCita).join("")}</div>`
        : vacio("Sin citas para hoy", "Las citas de Google Calendar aparecen aquí en la próxima sincronización.")}
    </section>`;
}

function renderPendientes() {
  const pendientes = estado.pendientes;
  if (!pendientes) return;

  const citas = pendientes.citas.map(filaCita).join("");
  const tratamientos = pendientes.tratamientos.map(fichaTratamiento).join("");
  const conversaciones = pendientes.conversaciones.map((c) => `
    <article class="cita">
      <div class="cita-hora">${esc(horaCorta(c.fecha))}</div>
      <div class="cita-info">
        <div class="cita-nombre">${esc(c.nombre ?? telefonoBonito(c.telefono))} <span class="pill no_show">sin responder</span></div>
        <div class="cita-meta">${esc(c.ultimoMensaje)} · ${esc(hace(c.fecha))}</div>
      </div>
      <div class="cita-acciones">
        <button type="button" class="btn btn-primario btn-mini" data-accion="abrir_hilo" data-id="${esc(c.telefono)}">Responder</button>
      </div>
    </article>`).join("");

  vista.innerHTML = `
    <section class="seccion">
      <h2 class="seccion-titulo">Citas sin confirmar <span>próximas 48 horas</span></h2>
      ${citas ? `<div class="lista">${citas}</div>` : vacio("Todo confirmado", "No hay citas próximas pendientes de confirmación.")}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Tratamientos que necesitan seguimiento <span>${pendientes.tratamientos.length}</span></h2>
      ${tratamientos ? `<div class="rejilla">${tratamientos}</div>` : vacio("Tratamientos al día", "Ningún paciente ha pasado el intervalo de su tratamiento.")}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Conversaciones sin responder <span>${pendientes.conversaciones.length}</span></h2>
      ${conversaciones ? `<div class="lista">${conversaciones}</div>` : vacio("Sin mensajes pendientes", "Todas las conversaciones tienen respuesta.")}
    </section>`;
}

function fichaTratamiento(t) {
  return `
    <article class="ficha">
      <div class="ficha-cabeza">
        <div>
          <strong>${esc(t.paciente)}</strong>
          <div class="ficha-dato">${esc(t.etiqueta)}</div>
        </div>
        <span class="pill sev-${esc(t.severidad)}">${esc(t.severidad)}</span>
      </div>

      <div class="ficha-dato">
        Última sesión: <b>hace ${t.dias} día(s)</b> · esperado cada ${t.esperado}
        ${t.retraso > 0 ? `· <b>${t.retraso} de retraso</b>` : ""}
      </div>

      <div class="barra-riesgo ${t.severidad === "critico" ? "critico" : ""}">
        <i style="width:${Math.min(100, Math.round((t.dias / Math.max(t.esperado, 1)) * 100))}%"></i>
      </div>

      <div class="ficha-acciones">
        ${boton("seguimiento", t.citaId, "Enviar seguimiento", "btn-primario btn-mini")}
        ${t.telefono ? `<a class="btn btn-mini" href="tel:${esc(t.telefono)}">Llamar</a>` : ""}
        ${t.telefono && enlaceWhatsapp(t.telefono) ? `<a class="btn btn-mini" href="${enlaceWhatsapp(t.telefono)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      </div>
    </article>`;
}

function renderTratamientos() {
  const lista = estado.tratamientos;

  vista.innerHTML = `
    <section class="seccion">
      <h2 class="seccion-titulo">Tratamientos multisesión <span>${lista.length} en seguimiento</span></h2>
      <p class="ficha-dato" style="margin:-4px 0 14px">
        Un tratamiento aparece aquí cuando el paciente pasó el intervalo esperado entre sesiones
        y no tiene la siguiente cita agendada.
      </p>
      ${lista.length
        ? `<div class="rejilla">${lista.map(fichaTratamiento).join("")}</div>`
        : vacio("Nada en riesgo", "Todos los tratamientos tienen su siguiente sesión agendada o están dentro del intervalo.")}
    </section>`;
}

function renderPacientes() {
  vista.innerHTML = `
    <section class="seccion">
      <h2 class="seccion-titulo">Pacientes <span>${estado.pacientes.length}</span></h2>

      <form class="buscador" id="form-buscar" role="search">
        <input id="buscar" type="search" name="q" placeholder="Buscar por nombre o teléfono…"
          value="${esc(estado.busqueda)}" autocomplete="off">
        <button class="btn" type="submit">Buscar</button>
      </form>

      <div class="lista-pacientes" id="lista-pacientes">
        ${listaPacientesHtml()}
      </div>
    </section>`;
}

function listaPacientesHtml() {
  if (estado.pacientes.length === 0) {
    return vacio("Sin resultados", "Prueba con otro nombre o revisa que el paciente exista en Google Calendar.");
  }

  return `<div class="tabla-pacientes">
    ${estado.pacientes.map((p) => `
      <article class="fila-paciente">
        <div>
          <div class="nombre">${esc(p.nombre)}</div>
          <div class="dato">${esc(telefonoBonito(p.telefono))}</div>
        </div>
        <div>
          <div class="dato">${p.proxima ? `Próxima: ${esc(fechaCorta(p.proxima))}` : "Sin cita próxima"}</div>
          <div class="dato">${p.ultima ? `Última visita: ${esc(fechaCorta(p.ultima))}` : "Sin visitas registradas"}</div>
        </div>
        <label class="interruptor" title="Autorización para mensajes de WhatsApp">
          <input type="checkbox" data-accion="consentimiento" data-id="${esc(p.id)}"
            ${p.consentWhatsapp ? "checked" : ""}>
          <span class="pista"></span>
          WhatsApp
        </label>
        ${p.telefono
          ? `<div class="fila-acciones">
               <button class="btn btn-mini" type="button" data-accion="editar_telefono"
                 data-id="${esc(p.id)}" data-telefono="${esc(p.telefono)}">Editar teléfono</button>
               <button class="btn btn-mini" type="button" data-accion="abrir_hilo"
                 data-id="${esc(p.telefono)}">Ver chat</button>
             </div>`
          : `<div class="fila-acciones">
               <button class="btn btn-mini" type="button" data-accion="editar_telefono"
                 data-id="${esc(p.id)}" data-telefono="">Agregar teléfono</button>
             </div>`}
      </article>`).join("")}
  </div>`;
}

function renderConversaciones() {
  const lista = estado.conversaciones;
  const activo = estado.hilo;

  const hilos = lista.length
    ? lista.map((c) => `
      <button type="button" class="hilo ${c.telefono === estado.telefonoActivo ? "activo" : ""}"
        data-accion="abrir_hilo" data-id="${esc(c.telefono)}">
        <div class="hilo-cabeza">
          <span>${c.sinResponder ? `<i class="nuevo" aria-hidden="true"></i>` : ""}${esc(c.nombre ?? telefonoBonito(c.telefono))}</span>
          <time>${esc(hace(c.fecha))}</time>
        </div>
        <div class="hilo-texto">${c.direccion === "OUT" ? "Clínica: " : ""}${esc(c.ultimoMensaje)}</div>
      </button>`).join("")
    : vacio("Sin conversaciones", "Cuando un paciente escriba o reciba un recordatorio, aparecerá aquí.");

  vista.innerHTML = `
    <section class="seccion">
      <h2 class="seccion-titulo">Conversaciones <span>${lista.length}</span></h2>
      <div class="conversaciones">
        <div class="lista-hilos">${hilos}</div>
        ${activo ? panelHilo(activo) : `
          <div class="panel-hilo">
            <div class="vacio" style="border:0;margin:auto;background:transparent">
              <strong>Elige una conversación</strong>
              Aquí verás el historial completo y podrás responder como consultorio.
            </div>
          </div>`}
      </div>
    </section>`;

  const caja = $(".hilo-mensajes");
  if (caja) caja.scrollTop = caja.scrollHeight;
}

function panelHilo(hilo) {
  const telefono = estado.telefonoActivo;
  const mensajes = hilo.mensajes.map((m) => `
    <div class="msg ${m.direccion === "IN" ? "in" : "out"}">
      ${esc(m.contenido)}
      <time>${esc(hace(m.fecha))}</time>
    </div>`).join("");

  return `
    <div class="panel-hilo">
      <header>
        <div>
          <strong>${esc(hilo.paciente ?? telefonoBonito(telefono))}</strong>
          <small>${esc(telefonoBonito(telefono))}</small>
        </div>
        <a class="btn btn-mini" href="${enlaceWhatsapp(telefono) ?? "#"}" target="_blank" rel="noopener">Abrir en WhatsApp</a>
      </header>
      <div class="hilo-mensajes">${mensajes || `<div class="vacio">Sin mensajes todavía.</div>`}</div>
      ${hilo.paciente
        ? `<form class="respuesta" id="form-respuesta">
             <textarea name="texto" rows="1" placeholder="Escribe una respuesta…" required maxlength="1000"></textarea>
             <button class="btn btn-primario" type="submit">Enviar</button>
           </form>`
        : `<div class="respuesta">
             <p class="ayuda" style="margin:0">
               Este número no está registrado como paciente, así que no hay consentimiento
               para escribirle. Regístralo primero en el sistema.
             </p>
           </div>`}
    </div>`;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function abrirHilo(telefono) {
  estado.tab = "conversaciones";
  estado.telefonoActivo = telefono;
  estado.hilo = null;
  marcarPestana();
  vista.innerHTML = `<div class="cargando">Abriendo conversación…</div>`;
  await cargarPestana();
}

function marcarPestana() {
  document.querySelectorAll(".pestana").forEach((boton) => {
    boton.classList.toggle("activa", boton.dataset.tab === estado.tab);
  });
}

function abrirModalMover(citaId) {
  const cita = [...estado.citas, ...(estado.pendientes?.citas ?? [])].find((c) => c.id === citaId);
  if (!cita) return;

  estado.citaMover = citaId;
  const local = partes(cita.fecha);
  const formulario = $("#form-mover");
  formulario.fecha.value = local.fecha;
  formulario.hora.value = local.hora;
  formulario.fecha.min = partes(new Date().toISOString()).fecha;
  $("#mover-paciente").textContent = `${cita.paciente.nombre} · ${cita.titulo} (actual: ${cita.fechaTexto})`;
  dialogo.showModal();
}

function abrirModalTelefono(pacienteId) {
  const paciente = estado.pacientes.find((p) => p.id === pacienteId);
  if (!paciente) return;

  estado.pacienteTelefono = pacienteId;
  const formulario = $("#form-telefono");
  formulario.telefono.value = paciente.telefono ?? "";
  $("#telefono-paciente").textContent = paciente.nombre;
  dialogoTelefono.showModal();
  formulario.telefono.select();
}

async function ejecutarAccion(accion, elemento) {
  const id = elemento.dataset.id;

  switch (accion) {
    case "confirmar":
      await api(`/citas/${id}/estado`, { method: "POST", body: { estado: "CONFIRMADA" } });
      avisar("Cita confirmada.");
      break;

    case "recordar": {
      if (!window.confirm("¿Enviar el recordatorio por WhatsApp ahora mismo?")) return;
      await api(`/citas/${id}/recordatorio`, { method: "POST" });
      avisar("Recordatorio enviado por WhatsApp.");
      break;
    }

    case "mover":
      abrirModalMover(id);
      return;

    case "editar_telefono":
      abrirModalTelefono(id);
      return;

    case "cancelar": {
      if (!window.confirm("¿Cancelar esta cita? Se avisará en el panel y se liberará el espacio.")) return;
      await api(`/citas/${id}/estado`, {
        method: "POST",
        body: { estado: "CANCELADA_POR_CLINICA" },
      });
      avisar("Cita cancelada.");
      break;
    }

    case "completar": {
      if (!window.confirm("¿Marcar la cita como completada? Se registra la sesión para el seguimiento.")) return;
      await api(`/citas/${id}/estado`, { method: "POST", body: { estado: "COMPLETADA" } });
      avisar("Sesión registrada. El seguimiento del tratamiento queda activo.");
      break;
    }

    case "no_show": {
      if (!window.confirm("¿Registrar que el paciente no asistió?")) return;
      await api(`/citas/${id}/estado`, { method: "POST", body: { estado: "NO_SHOW" } });
      avisar("No-show registrado.");
      break;
    }

    case "seguimiento": {
      if (!window.confirm("¿Enviar el mensaje de seguimiento por WhatsApp?")) return;
      const datos = await api(`/citas/${id}/seguimiento`, { method: "POST" });
      avisar(`Seguimiento enviado (${datos.dias} días desde la última sesión).`);
      break;
    }

    case "abrir_hilo":
      await abrirHilo(id);
      return;
  }

  await cargar(true);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

document.querySelectorAll(".pestana").forEach((boton) => {
  boton.addEventListener("click", async () => {
    estado.tab = boton.dataset.tab;
    if (estado.tab !== "conversaciones") estado.telefonoActivo = null;
    marcarPestana();
    vista.innerHTML = `<div class="cargando">Cargando…</div>`;
    await cargarPestana();
  });
});

$("#btn-refrescar").addEventListener("click", () => cargar());

document.addEventListener("click", async (evento) => {
  const ir = evento.target.closest("[data-ir]");
  if (ir) {
    document.querySelector(`.pestana[data-tab="${ir.dataset.ir}"]`)?.click();
    return;
  }

  if (evento.target.closest("[data-cerrar]")) {
    evento.target.closest("dialog")?.close();
    return;
  }

  const elemento = evento.target.closest("[data-accion]");
  if (!elemento) return;
  if (elemento.matches("input[type=checkbox]")) return;

  elemento.disabled = true;
  try {
    await ejecutarAccion(elemento.dataset.accion, elemento);
  } catch (error) {
    avisar(error.message, "error");
  } finally {
    if (elemento.isConnected) elemento.disabled = false;
  }
});

document.addEventListener("change", async (evento) => {
  const casilla = evento.target.closest('input[data-accion="consentimiento"]');
  if (!casilla) return;

  const valor = casilla.checked;
  try {
    await api(`/pacientes/${casilla.dataset.id}/consentimiento`, {
      method: "POST",
      body: { consentWhatsapp: valor },
    });
    avisar(valor ? "Consentimiento activado: se programaron sus recordatorios." : "Consentimiento desactivado.");
    await cargar(true);
  } catch (error) {
    casilla.checked = !valor;
    avisar(error.message, "error");
  }
});

// Búsqueda de pacientes sin perder el foco del campo.
async function buscarPacientes() {
  try {
    estado.pacientes = await api(`/pacientes${estado.busqueda ? `?q=${encodeURIComponent(estado.busqueda)}` : ""}`);
    const contenedor = $("#lista-pacientes");
    if (contenedor) contenedor.innerHTML = listaPacientesHtml();
  } catch (error) {
    avisar(error.message, "error");
  }
}

let temporizadorBusqueda = null;
document.addEventListener("input", (evento) => {
  if (evento.target.id !== "buscar") return;
  estado.busqueda = evento.target.value;
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(buscarPacientes, 350);
});

document.addEventListener("submit", async (evento) => {
  if (evento.target.id === "form-buscar") {
    evento.preventDefault();
    clearTimeout(temporizadorBusqueda);
    await buscarPacientes();
    return;
  }

  if (evento.target.id === "form-respuesta") {
    evento.preventDefault();
    const formulario = evento.target;
    const botonEnviar = formulario.querySelector("button[type=submit]");
    const texto = formulario.texto.value.trim();
    if (!texto) return;

    botonEnviar.disabled = true;
    try {
      await api(`/conversaciones/${encodeURIComponent(estado.telefonoActivo)}/mensaje`, {
        method: "POST",
        body: { texto },
      });
      formulario.reset();
      avisar("Mensaje enviado.");
      estado.conversaciones = await api("/conversaciones");
      estado.hilo = await api(`/conversaciones/${encodeURIComponent(estado.telefonoActivo)}`);
      renderConversaciones();
      document.querySelector("#form-respuesta textarea")?.focus();
    } catch (error) {
      avisar(error.message, "error");
    } finally {
      botonEnviar.disabled = false;
    }
  }
});

$("#form-mover").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const formulario = evento.target;
  const id = estado.citaMover;
  const botonEnviar = formulario.querySelector("button[type=submit]");

  botonEnviar.disabled = true;
  try {
    const datos = await api(`/citas/${id}/reprogramar`, {
      method: "POST",
      body: { fecha: formulario.fecha.value, hora: formulario.hora.value },
    });
    dialogo.close();
    avisar(
      datos.avisoPaciente
        ? "Cita movida y paciente avisado por WhatsApp."
        : "Cita movida, pero no se pudo avisar al paciente. Escríbele manualmente.",
      datos.avisoPaciente ? "exito" : "error"
    );
  } catch (error) {
    avisar(error.message, "error");
  } finally {
    botonEnviar.disabled = false;
  }
});

$("#form-telefono").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const formulario = evento.target;
  const botonEnviar = formulario.querySelector("button[type=submit]");
  const texto = formulario.telefono.value.trim();

  botonEnviar.disabled = true;
  try {
    await api(`/pacientes/${estado.pacienteTelefono}/telefono`, {
      method: "POST",
      body: { telefono: texto || null },
    });
    dialogoTelefono.close();
    avisar(texto ? "Teléfono guardado." : "Teléfono eliminado.");
    await cargar(true);
  } catch (error) {
    avisar(error.message, "error");
  } finally {
    botonEnviar.disabled = false;
  }
});

// Atajos y refresco automático.
document.addEventListener("keydown", (evento) => {
  if (evento.key === "r" && !evento.ctrlKey && !evento.metaKey && !evento.altKey) {
    const activo = document.activeElement;
    if (activo && ["INPUT", "TEXTAREA"].includes(activo.tagName)) return;
    cargar();
  }
});

setInterval(() => {
  if (puedeRefrescar()) cargar(true);
}, 30_000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && puedeRefrescar()) cargar(true);
});

/** No refrescar mientras la asistente escribe: perdería el texto a medias. */
function puedeRefrescar() {
  if (document.hidden || document.querySelector("dialog[open]")) return false;
  const activo = document.activeElement;
  if (activo && ["INPUT", "TEXTAREA"].includes(activo.tagName)) return false;
  return true;
}

// Arranque
marcarPestana();
cargar();
