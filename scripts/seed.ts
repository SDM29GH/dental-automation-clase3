/**
 * Datos iniciales: tratamientos y un paciente de ejemplo.
 *
 *   npm run db:seed
 *
 * Es idempotente: se puede ejecutar varias veces.
 */
import "dotenv/config";
import prisma from "../src/utils/prisma.js";
import { config } from "../src/config/index.js";
import { listarProtocolos } from "../src/services/protocolos.js";
import { aUtcDesdeZona, formatear, partesEnZona } from "../src/utils/time.js";

const TELEFONO_DEMO = "5512345678";

async function main(): Promise<void> {
  console.log("🌱 Sembrando tratamientos…");

  for (const protocolo of listarProtocolos()) {
    await prisma.tratamiento.upsert({
      where: { nombre: protocolo.etiqueta },
      create: {
        nombre: protocolo.etiqueta,
        tipo: protocolo.tipo,
        diasEntreSesiones: protocolo.diasEntreSesiones,
        recordatorioProactivo: true,
      },
      update: {
        tipo: protocolo.tipo,
        diasEntreSesiones: protocolo.diasEntreSesiones,
      },
    });
    console.log(`   · ${protocolo.etiqueta} (cada ${protocolo.diasEntreSesiones} días)`);
  }

  console.log("🌱 Paciente de ejemplo…");
  const paciente = await prisma.paciente.upsert({
    where: { telefono: TELEFONO_DEMO },
    create: {
      nombre: "Ana Ruiz",
      telefono: TELEFONO_DEMO,
      consentWhatsapp: true,
      nota: "Paciente de ejemplo para pruebas locales",
    },
    update: {},
  });

  console.log(`   · ${paciente.nombre} (${paciente.telefono})`);

  // Cita de ejemplo para probar el webhook en local (sólo si no hay una futura).
  const proxima = await prisma.cita.findFirst({
    where: { pacienteId: paciente.id, fecha: { gt: new Date() } },
  });

  if (!proxima) {
    const tratamiento = await prisma.tratamiento.findFirst({
      where: { tipo: "ENDODONCIA" },
    });

    // 10:00 en la zona del consultorio, sin depender de la zona del servidor.
    const { anio, mes, dia } = partesEnZona(new Date());
    const manana = aUtcDesdeZona(anio, mes, dia + 1, 10, 0, config.TIMEZONE);

    const cita = await prisma.cita.create({
      data: {
        pacienteId: paciente.id,
        titulo: "Endodoncia, segunda sesión",
        fecha: manana,
        tipo: "ENDODONCIA",
        tratamientoId: tratamiento?.id ?? null,
        estado: "AGENDADA",
      },
    });
    console.log(`   · Cita de ejemplo ${cita.id} → ${formatear(cita.fecha, "fechaHora")}`);
  } else {
    console.log(`   · Ya existe una cita futura (${proxima.id}), no se crea otra`);
  }

  // ---------------------------------------------------------------------
  // Datos de demostración para que el panel no arranque vacío.
  // Todos llevan la nota "demo" y se pueden borrar sin afectar al sistema.
  // ---------------------------------------------------------------------
  console.log("🌱 Agenda de demostración…");
  const { anio, mes, dia } = partesEnZona(new Date());

  async function pacienteDemo(nombre: string, telefono: string) {
    return prisma.paciente.upsert({
      where: { telefono },
      create: { nombre, telefono, consentWhatsapp: true, nota: "Paciente de demostración (seed)" },
      update: {},
    });
  }

  async function citaDemo(datos: {
    pacienteId: string;
    titulo: string;
    tipo: string;
    fecha: Date;
    estado: "AGENDADA" | "CONFIRMADA" | "COMPLETADA";
    tratamiento?: string;
  }) {
    const existente = await prisma.cita.findFirst({
      where: { pacienteId: datos.pacienteId, fecha: datos.fecha },
    });
    if (existente) return existente;

    const tratamiento = datos.tratamiento
      ? await prisma.tratamiento.findFirst({ where: { tipo: datos.tratamiento } })
      : null;

    return prisma.cita.create({
      data: {
        pacienteId: datos.pacienteId,
        titulo: datos.titulo,
        fecha: datos.fecha,
        tipo: datos.tipo,
        estado: datos.estado,
        tratamientoId: tratamiento?.id ?? null,
        metadata: { demo: true },
      },
    });
  }

  const luis = await pacienteDemo("Luis Hernández", "5523456789");
  await citaDemo({
    pacienteId: luis.id,
    titulo: "Limpieza dental",
    tipo: "LIMPIEZA",
    fecha: aUtcDesdeZona(anio, mes, dia, 11, 30, config.TIMEZONE),
    estado: "CONFIRMADA",
  });

  const mariana = await pacienteDemo("Mariana López", "5534567890");
  await citaDemo({
    pacienteId: mariana.id,
    titulo: "Ajuste de ortodoncia",
    tipo: "ORTODONCIA",
    fecha: aUtcDesdeZona(anio, mes, dia, 17, 30, config.TIMEZONE),
    estado: "AGENDADA",
    tratamiento: "ORTODONCIA",
  });

  // Paciente que abandonó su endodoncia: alimenta la pestaña de tratamientos.
  const carlos = await pacienteDemo("Carlos Méndez", "5545678901");
  const citaCarlos = await citaDemo({
    pacienteId: carlos.id,
    titulo: "Endodoncia, primera sesión",
    tipo: "ENDODONCIA",
    fecha: aUtcDesdeZona(anio, mes, dia - 14, 10, 0, config.TIMEZONE),
    estado: "COMPLETADA",
    tratamiento: "ENDODONCIA",
  });

  const sesionCarlos = await prisma.sesion.findFirst({ where: { citaId: citaCarlos.id } });
  if (!sesionCarlos) {
    await prisma.sesion.create({
      data: {
        citaId: citaCarlos.id,
        pacienteId: carlos.id,
        fecha: citaCarlos.fecha,
        completada: true,
        notas: "Sesión de demostración",
      },
    });
  }

  console.log("   · Luis, Mariana y Carlos (agenda de hoy y tratamiento en riesgo)");
  console.log("   · Borra estos pacientes con nota 'demostración' antes de producción");

  console.log("✅ Seed completado");
}

main()
  .catch((error) => {
    console.error("❌ Seed falló:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
