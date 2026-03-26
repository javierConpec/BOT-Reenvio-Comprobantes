import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import axios from 'axios';
import { BillingSend } from './billing-send.entity';

@Injectable()
export class AlarmaService {
  private readonly logger = new Logger(AlarmaService.name);
  
  private readonly BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  private readonly GROUP_ID = process.env.TELEGRAM_GROUP_ID;

  constructor(
    @InjectRepository(BillingSend)
    private readonly billingRepo: Repository<BillingSend>,
    private readonly entityManager: EntityManager,
  ) {}

  // CONFIGURACIÓN FINAL: 10:00 AM y 08:00 PM (20:00)
  @Cron('0 0 10,20 * * *', {
    timeZone: 'America/Lima',
  })
  async ejecutarAlarmaProgramada() {
    this.logger.log('Ejecutando reporte programado (10 AM / 8 PM)...');
    await this.procesarEscaneo();
  }

  private async procesarEscaneo() {
    try {
      const pendientes = await this.billingRepo.find({
        where: { status: In([40031, 40030]) },
        order: { attempt_count: 'DESC', created_at: 'DESC' }, 
        take: 10 
      });

      if (pendientes.length === 0) {
        this.logger.log('Sin facturas pendientes para el reporte.');
        return;
      }

      let mensaje = `🚨 *MONITOR DE FACTURACIÓN* 🚨\n\n`;
      
      for (const [index, f] of pendientes.entries()) {
        let iconoStatus = f.status === 40031 ? '❌' : '⏳';
        let nivelUrgencia = f.attempt_count >= 5 ? ' *[URGENTE]*' : '';
        if (f.attempt_count >= 5) iconoStatus = '🔥';

        const tipoError = f.status === 40031 ? 'SISTEMA' : 'CONEXIÓN';
        
        // Búsqueda del local por Venta o Nota de Crédito
        const nombreEstacion = await this.obtenerNombreLocal(f.sale_id, f.note_id);

        let errorMsg = 'Sin detalle';
        if (f.response) {
            try {
                const resData = (typeof f.response === 'string') ? JSON.parse(f.response) : f.response;
                errorMsg = resData.Mensaje || resData.mensaje || resData.message || resData.description || JSON.stringify(resData);
            } catch { errorMsg = String(f.response); }
        }

        const errorLimpio = errorMsg.replace(/[`*]/g, '').trim();

        mensaje += `${index + 1}. ${iconoStatus} *${f.document_full_number}*${nivelUrgencia}\n`;
        mensaje += `   • *Estación:* ⛽ \`${nombreEstacion}\`\n`;
        mensaje += `   • *IDs:* \`Sale: ${f.sale_id || '-'}\` | \`Note: ${f.note_id || '-'}\`\n`;
        mensaje += `   • *Intentos:* \`${f.attempt_count}\` | *Origen:* ${tipoError}\n`;
        mensaje += `   • *Error:* \`${errorLimpio}\`\n\n`;
      }

      mensaje += `📊 *Resumen:* ${pendientes.length} pendientes encontrados.\n`;
      mensaje += `📅 _Generado: ${new Date().toLocaleString('es-PE')}_`;

      await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
        chat_id: this.GROUP_ID,
        text: mensaje,
        parse_mode: 'Markdown',
      });

      this.logger.log('Reporte programado enviado con éxito.');
    } catch (error) {
      this.logger.error(`Error en el envío: ${error.message}`);
    }
  }

  private async obtenerNombreLocal(saleId: string | number, noteId: string | number): Promise<string> {
    try {
      if (saleId) {
        const res = await this.entityManager.query(
          `SELECT l.name FROM sale s JOIN local l ON s.id_local = l.id_local WHERE s.id_sale = $1`,
          [saleId]
        );
        return res[0]?.name || 'Local no encontrado';
      } 
      
      if (noteId) {
        const res = await this.entityManager.query(
          `SELECT l.name FROM credit_note c JOIN local l ON c.id_local = l.id_local WHERE c.id = $1`,
          [noteId]
        );
        return res[0]?.name || 'Local no encontrado';
      }

      return 'N/A';
    } catch (e) {
      return 'Error de consulta';
    }
  }
}