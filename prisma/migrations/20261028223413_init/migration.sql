-- CreateEnum
CREATE TYPE "CitaEstado" AS ENUM ('AGENDADA', 'CONFIRMADA', 'NO_SHOW', 'CANCELADA_POR_PACIENTE', 'CANCELADA_POR_CLINICA', 'COMPLETADA', 'REAGENDADA');

-- CreateEnum
CREATE TYPE "EnvioEstado" AS ENUM ('PENDIENTE', 'ENVIADO', 'LEIDO', 'FALLIDO', 'RESPONDIDO', 'OMITIDO');

-- CreateEnum
CREATE TYPE "MensajeEstado" AS ENUM ('ENVIADO', 'LEIDO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "DireccionMensaje" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "pacientes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "consentWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tratamientos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "totalSesiones" INTEGER,
    "diasEntreSesiones" INTEGER,
    "recordatorioProactivo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tratamientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "calendarioEventId" TEXT,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL,
    "tratamientoId" TEXT,
    "metadata" JSONB,
    "estado" "CitaEstado" NOT NULL DEFAULT 'AGENDADA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordatorios_envios" (
    "id" TEXT NOT NULL,
    "citaId" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "disparador" TEXT NOT NULL,
    "contenido" TEXT NOT NULL DEFAULT '',
    "enviadoA" TEXT,
    "estado" "EnvioEstado" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "programadoPara" TIMESTAMP(3),
    "enviadoEn" TIMESTAMP(3),
    "creadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recordatorios_envios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" TEXT NOT NULL,
    "citaId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes" (
    "id" TEXT NOT NULL,
    "citaId" TEXT,
    "direccion" "DireccionMensaje" NOT NULL,
    "telefono" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "estado" "MensajeEstado" NOT NULL DEFAULT 'ENVIADO',
    "proveedorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_telefono_key" ON "pacientes"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "tratamientos_nombre_key" ON "tratamientos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "citas_calendarioEventId_key" ON "citas"("calendarioEventId");

-- CreateIndex
CREATE INDEX "citas_fecha_estado_idx" ON "citas"("fecha", "estado");

-- CreateIndex
CREATE INDEX "citas_pacienteId_fecha_idx" ON "citas"("pacienteId", "fecha");

-- CreateIndex
CREATE INDEX "recordatorios_envios_citaId_estado_idx" ON "recordatorios_envios"("citaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "recordatorios_envios_citaId_disparador_key" ON "recordatorios_envios"("citaId", "disparador");

-- CreateIndex
CREATE INDEX "sesiones_citaId_idx" ON "sesiones"("citaId");

-- CreateIndex
CREATE INDEX "sesiones_pacienteId_fecha_idx" ON "sesiones"("pacienteId", "fecha");

-- CreateIndex
CREATE INDEX "mensajes_telefono_createdAt_idx" ON "mensajes"("telefono", "createdAt");

-- CreateIndex
CREATE INDEX "mensajes_citaId_idx" ON "mensajes"("citaId");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_tratamientoId_fkey" FOREIGN KEY ("tratamientoId") REFERENCES "tratamientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordatorios_envios" ADD CONSTRAINT "recordatorios_envios_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
