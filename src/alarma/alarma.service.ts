import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import axios from 'axios';
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
    this.logger.log('Bot iniciado. Escuchando /id...');
    setInterval(async () => {
      try {
        const response = await axios.get(`https://api.telegram.org/bot${this.BOT_TOKEN}/getUpdates?offset=${this.lastUpdateId + 1}`);
        const updates = response.data.result;
        for (const update of updates) {
          this.lastUpdateId = update.update_id;
          if (update.message?.text === '/id') {
            await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
              chat_id: update.message.chat.id,
              text: `ID: ${update.message.chat.id}`,
            });
          }
        }
      } catch (e) {}
    }, 5000);
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