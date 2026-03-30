import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import axios from 'axios';
import FormData from 'form-data';

import { BillingSend } from './billing-send.entity';

@Injectable()
export class AlarmaService implements OnModuleInit {
  private readonly logger = new Logger(AlarmaService.name);
  private readonly BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  private readonly GROUP_ID = process.env.TELEGRAM_GROUP_ID;
  private lastUpdateId = 0;

  constructor(
    @InjectRepository(BillingSend)
    private readonly billingRepo: Repository<BillingSend>,
    private readonly entityManager: EntityManager,
  ) {}

 async onModuleInit() {
    this.logger.log('Bot iniciado. Comandos: /id, /anulados-FECHA o /anulados-INICIO/FIN');
    
    setInterval(async () => {
      try {
        const response = await axios.get(`https://api.telegram.org/bot${this.BOT_TOKEN}/getUpdates?offset=${this.lastUpdateId + 1}`);
        const updates = response.data.result;

        for (const update of updates) {
          this.lastUpdateId = update.update_id;
          const text = update.message?.text;
          const chatId = update.message?.chat.id;

          if (!text) continue;

          if (text === '/id') {
            await this.enviarMensaje(chatId, `ID de este chat: ${chatId}`);
          }

          // Detección de /anulados-
          if (text.startsWith('/anulados-')) {
            const input = text.split('/anulados-')[1]; // Extrae lo que viene después del guion

            if (input.includes('/')) {
              // CASO RANGO: /anulados-2026-03-20/2026-03-22
              const [inicio, fin] = input.split('/');
              await this.reportarAnulados(chatId, inicio, fin);
            } else {
              // CASO FECHA ÚNICA: /anulados-2026-03-22
              await this.reportarAnulados(chatId, input, input);
            }
          }
        }
      } catch (e) {}
    }, 5000);
  }
  private async reportarAnulados(chatId: number, fechaInicio: string, fechaFin: string) {
    try {
      const regexFecha = /^\d{4}-\d{2}-\d{2}$/;
      if (!regexFecha.test(fechaInicio) || !regexFecha.test(fechaFin)) {
        return await this.enviarMensaje(chatId, "Formato incorrecto. Usa:\n/anulados-YYYY-MM-DD");
      }

      const query = `
        SELECT 
            s.serie,
            s.number,
            s.total_amount,
            l.name as sede,
            s.issue_date,
            CASE  
                WHEN s.serie LIKE '%B%' THEN 'BOLETA'
                WHEN s.serie LIKE '%F%' THEN 'FACTURA'
            END AS tipo_documento
        FROM sale s
        INNER JOIN local l ON l.id_local = s.id_local
        WHERE s.issue_date >= '${fechaInicio} 00:00:00'
          AND s.issue_date <= '${fechaFin} 23:59:59'
          AND s.state = '40002'
          AND (s.serie LIKE '%B%' OR s.serie LIKE '%F%')
        ORDER BY s.issue_date DESC;
      `;

      const anulados = await this.entityManager.query(query);

      if (anulados.length === 0) {
        return await this.enviarMensaje(chatId, `No hay anulados para este rango.`);
      }

      // --- LÓGICA DE ENVÍO SEGÚN CANTIDAD ---
      
      if (anulados.length > 15) {
        // CASO: MÁS DE 15 COMPROBANTES
        let mensajeAviso = `REPORTE DE ANULADOS\n`;
        mensajeAviso += `--------------------------\n\n`;
        mensajeAviso += `Se han encontrado ${anulados.length} comprobantes anulados.\n\n`;
        mensajeAviso += `Debido a la cantidad, se adjunta el reporte completo en formato Excel para una mejor lectura.`;

        await this.enviarMensaje(chatId, mensajeAviso);
        await this.enviarDocumentoCSV(chatId, anulados, fechaInicio, fechaFin);

      } else {
        // CASO: 15 O MENOS COMPROBANTES (Se muestra el detalle en texto)
        let mensaje = `REPORTE DE ANULADOS\n`;
        mensaje += `--------------------------\n\n`;

        for (const res of anulados) {
          mensaje += `${res.tipo_documento}: ${res.serie}-${res.number}\n`;
          mensaje += `Sede: ${res.sede} | S/ ${res.total_amount}\n`;
          mensaje += `Fecha: ${new Date(res.issue_date).toLocaleDateString('es-PE')}\n`;
          mensaje += `--------------------------\n`;
        }

        mensaje += `\nTotal encontrados: ${anulados.length}`;
        await this.enviarMensaje(chatId, mensaje);
      }

    } catch (error) {
      this.logger.error(`Error en reporte de anulados: ${error.message}`);
      await this.enviarMensaje(chatId, "Hubo un error al procesar el reporte.");
    }
  }

  private async enviarDocumentoCSV(chatId: number, datos: any[], inicio: string, fin: string) {
    try {
      // Crear contenido del CSV (encabezados y filas)
      const encabezado = "Tipo;Serie;Numero;Sede;Monto;Fecha\n";
      const filas = datos.map(r => 
        `${r.tipo_documento};${r.serie};${r.number};${r.sede};${r.total_amount};${new Date(r.issue_date).toLocaleDateString('es-PE')}`
      ).join("\n");

      const csvContent = encabezado + filas;
      const fileName = `anulados_${inicio}_${fin}.csv`;

      // Preparar el FormData para enviar a Telegram
      const form = new FormData();
      form.append('chat_id', chatId.toString());
      form.append('document', Buffer.from(csvContent, 'utf-8'), {
        filename: fileName,
        contentType: 'text/csv',
      });

      await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendDocument`, form, {
        headers: form.getHeaders(),
      });
    } catch (error) {
      this.logger.error(`Error enviando CSV: ${error.message}`);
    }
  }
  // Helper para enviar mensajes
  private async enviarMensaje(chatId: number, text: string) {
    await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
  }

  // Ejecución a las 10:13 AM y 10:13 PM (22:13)
  @Cron('0 10 12,21 * * *', { timeZone: 'America/Lima' })
  async ejecutarAlarma() {
    await this.procesarEscaneo();
  }

  private async procesarEscaneo() {
    try {
      // El query ahora incluye: s.issue_date <= NOW() - INTERVAL '1 hour'
      // Esto garantiza que si el bot corre a las 10:13, solo vea lo de las 9:13 hacia atrás.
      const query = `
        SELECT 
            s.issue_date,
            s.serie,
            s.number,
            CASE s.id_sale_document_type
                WHEN 1 THEN 'FACTURA'
                WHEN 2 THEN 'BOLETA'
            END AS tipo_comprobante,
            s.client_snapshot->>'firstName' as f_name,
            s.client_snapshot->>'lastName' as l_name,
            s.total_amount,
            l.name as sede,
            bs.status,
            CASE
                WHEN bs.id_billing_send IS NULL THEN 'NO REGISTRADO'
                WHEN bs.status = 40030 THEN 'ERROR DE NEGOCIO'
                WHEN bs.status = 40031 THEN 'ERROR DEL SISTEMA/API'
                ELSE 'PENDIENTE'
            END AS billing_mensaje,
            bs.response_msg as respuesta
        FROM sale s
        JOIN local l ON s.id_local = l.id_local
        LEFT JOIN LATERAL (
            SELECT
                b.id_billing_send,
                b.status,
                b.response ->> 'Mensaje' as response_msg,
                b.created_at
            FROM billing_send b
            WHERE b.sale_id = s.id_sale
              AND b.state_audit = 1200001
            ORDER BY b.created_at DESC
            LIMIT 1
        ) bs ON true
        WHERE s.state_audit = 1200001
          AND s.id_sale_document_type IN (1, 2)
          AND s.origin IN (1960002)
          AND (bs.status IN (40030, 40031) OR bs.status IS NULL)
          -- FILTRO DE 1 HORA DE ANTIGÜEDAD:
          AND s.issue_date <= NOW() - INTERVAL '1 hour'
        ORDER BY s.issue_date DESC, s.created_at DESC;
      `;

      const resultados = await this.entityManager.query(query);

      if (resultados.length === 0) {
        this.logger.log('Sin comprobantes críticos. Enviando reporte de éxito.');
        
        const mensajeExito = `REPORTE DE FACTURACION\n` +
                             `--------------------------\n\n` +
                             `Estado del sistema:\n` +
                             `Sincronización al día\n\n` +
                             `Detalle:\n` +
                             `Todos los comprobantes han sido enviados correctamente a la SUNAT.\n\n` +
                             `Fecha de verificacion:\n` +
                             `${new Date().toLocaleString('es-PE')}`;

        await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
          chat_id: this.GROUP_ID,
          text: mensajeExito,
        });
        return;
      }

      let mensaje = `🔔 *NOTIFICACIÓN PRIORITARIA* 🔔\n`;
      mensaje += `REPORTE DE FACTURACION PENDIENTE\n`;
      mensaje += `--------------------------\n\n`;

      for (const res of resultados) {
        const cliente = `${res.f_name || ''} ${res.l_name || ''}`.trim() || 'CLIENTE VARIOS';
        const errorFinal = res.respuesta || res.billing_mensaje;

        mensaje += `Tipo de comprobante:\n${res.tipo_comprobante}\n\n`;
        mensaje += `Numero:\n${res.serie}-${res.number}\n\n`;
        mensaje += `Sede:\n${res.sede}\n\n`;
        mensaje += `Cliente:\n${cliente}\n\n`;
        mensaje += `Monto total:\nS/ ${res.total_amount}\n\n`;
        mensaje += `Fecha de emision:\n${new Date(res.issue_date).toLocaleDateString('es-PE')}\n\n`;
        mensaje += `Estado/Error:\n${errorFinal}\n`;
        mensaje += `--------------------------\n`;
      }

      mensaje += `\nCantidad de comprobantes faltantes:\n${resultados.length}`;

      await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
        chat_id: this.GROUP_ID,
        text: mensaje,
        disable_notification: false,
      });

      this.logger.log('Reporte enviado correctamente.');
    } catch (error) {
      this.logger.error(`Error en AlarmaService: ${error.message}`);
    }
  }
}