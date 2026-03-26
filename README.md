# 🚀 SUNAT Billing Alert Bot (NestJS)

<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="100" alt="Nest Logo" />
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg" width="100" alt="Telegram Logo" />
</p>

Este es un microservicio desarrollado con **NestJS** diseñado para monitorear automáticamente la tabla de envíos de facturación electrónica y notificar errores críticos directamente a un grupo de **Telegram**.

## 🛠️ Funcionalidades

- **Monitoreo Automático:** Escanea la base de datos en horarios específicos (10:00 AM y 06:00 PM).
- **Detección de Errores Críticos:** Filtra comprobantes con estados `40030` (Conexión) y `40031` (Sistema).
- **Inteligencia de Reintentos:** Identifica documentos bloqueados mediante la columna `attempt_count`.
- **Diagnóstico Detallado:** Extrae el mensaje de error real del JSON de respuesta de la SUNAT, ignorando el StackTrace.
- **Formato Profesional:** Reportes limpios en Markdown con IDs de Venta (`sale_id`) y Notas (`note_id`).

## 📋 Requisitos Previos

- **Node.js** (v18 o superior)
- **PostgreSQL** (AWS RDS u otro)
- **Bot de Telegram** (Creado vía @BotFather)

## ⚙️ Configuración del Entorno (.env)

Crea un archivo `.env` en la raíz con las siguientes variables:

```env
# Configuración del Servidor
API_PORT=2303
TZ=America/Lima

# Base de Datos (PostgreSQL)
DB_HOST=tu_host_aws_rds
DB_PORT=5432
DB_NAME=tu_bd
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_SSL=true

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_GROUP_ID=-100XXXXXXXXXX