#!/usr/bin/env bash
# =====================================================================
# Instalacion rapida - DentalCare Retention Engine
# Uso:  bash scripts/install.sh
# =====================================================================

set -e

echo "DentalCare Retention Engine - instalacion"
echo "========================================="

# ---------------------------------------------------------------- Node
if ! command -v node > /dev/null 2>&1; then
  echo "ERROR: Node.js no esta instalado. Instala Node.js 20 o superior."
  exit 1
fi

VERSION_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$VERSION_NODE" -lt 20 ]; then
  echo "ERROR: se requiere Node.js 20+. Version actual: $(node -v)"
  exit 1
fi
echo "OK  Node.js $(node -v)"

# ---------------------------------------------------------------- .env
if [ ! -f .env ]; then
  echo "->  Creando .env a partir de .env.example"
  cp .env.example .env
  echo "    Edita .env con credenciales reales antes de continuar."
fi

# --------------------------------------------------------- dependencias
echo "->  Instalando dependencias (npm ci)"
npm ci

# ------------------------------------------------------------ infra
if command -v docker > /dev/null 2>&1; then
  echo "->  Levantando PostgreSQL y Evolution API"
  docker compose up -d postgres evolution-api
else
  echo "AVISO: Docker no disponible. Necesitas un PostgreSQL 16 accesible"
  echo "       segun DATABASE_URL antes de continuar."
  read -r -p "       Pulsa Enter cuando este listo..."
fi

# ------------------------------------------------------------- Prisma
echo "->  Generando cliente Prisma"
npx prisma generate

echo "->  Aplicando migraciones"
npx prisma migrate deploy

echo "->  Sembrando datos iniciales"
npm run db:seed

echo ""
echo "Instalacion completada."
echo ""
echo "Siguientes pasos:"
echo "  1. Completa .env: Google OAuth, Evolution API y (opcional) LLM."
echo "  2. npm run oauth            # obtiene GOOGLE_REFRESH_TOKEN"
echo "  3. Configura el webhook de Evolution:"
echo "     POST http://<host>:3000/webhook/whatsapp  (evento MESSAGES_UPSERT)"
echo "  4. npm run sync:calendar    # trae la agenda real"
echo "  5. npm run dev             # arranca el servidor"
echo ""
echo "Documentacion: README.md, docs/ARCHITECTURE.md"
