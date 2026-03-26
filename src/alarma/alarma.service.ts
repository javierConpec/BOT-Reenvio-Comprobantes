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

  // --- DETECTAR ID DEL GRUPO AL ESCRIBIR /id ---
  async onModuleInit() {
    this.logger.log('Bot de alarmas iniciado. Escuchando comando /id...');
    
    // Ejecutamos un bucle infinito (polling) para detectar el comando /id
    // Esto es útil si no usas Webhooks
    setInterval(async () => {
      try {
        const response = await axios.get(
          `https://api.telegram.org/bot${this.BOT_TOKEN}/getUpdates?offset=${this.lastUpdateId + 1}`
        );
        const updates = response.data.result;

        for (const update of updates) {
          this.lastUpdateId = update.update_id;
          const message = update.message;

          if (message && message.text === '/id') {
            const chatId = message.chat.id;
            const chatTitle = message.chat.title || 'Chat Privado';
            
            await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
              chat_id: chatId,
              text: `🆔 *ID de este chat:* \`${chatId}\`\n📍 *Nombre:* ${chatTitle}`,
              parse_mode: 'Markdown',
            });
            
            this.logger.warn(`ID entregado en el grupo: ${chatId}`);
          }
        }
      } catch (error) {
        // Silencioso para no ensuciar la consola
      }
    }, 5000); // Revisa cada 5 segundos
  }

  // --- REPORTE PROGRAMADO: 10:00 AM y 09:00 PM (21:00) ---
  @Cron('0 0 10,21 * * *', {
    timeZone: 'America/Lima',
  })
  async ejecutarAlarmaProgramada() {
    this.logger.log('Iniciando reporte programado de facturación (10AM/9PM)...');
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
        this.logger.log('Todo al día. No se encontraron pendientes.');
        return;
      }

      let mensaje = `🚨 *MONITOR DE FACTURACIÓN CRÍTICA* 🚨\n`;
      mensaje += `⚠️ *REVISIÓN REQUERIDA - SEDE CENTRAL*\n\n`;
      
      for (const [index, f] of pendientes.entries()) {
        let iconoStatus = f.status === 40031 ? '❌' : '⏳';
        let alertaVisual = '';
        
        if (f.attempt_count >= 5) {
          iconoStatus = '🔥';
          alertaVisual = ' *[BLOQUEADO]*';
        }

        const tipoError = f.status === 40031 ? 'SISTEMA' : 'CONEXIÓN';
        const nombreEstacion = await this.obtenerNombreLocal(f.sale_id, f.note_id);

        let errorMsg = 'Sin detalle de error';
        if (f.response) {
            try {
                const resData = (typeof f.response === 'string') ? JSON.parse(f.response) : f.response;
                errorMsg = resData.Mensaje || resData.mensaje || resData.message || resData.description || JSON.stringify(resData);
            } catch { errorMsg = String(f.response); }
        }
        const errorLimpio = errorMsg.replace(/[`*]/g, '').trim();

        mensaje += `${index + 1}. ${iconoStatus} *${f.document_full_number}*${alertaVisual}\n`;
        mensaje += `   • ⛽ *Sede:* \`${nombreEstacion}\`\n`;
        mensaje += `   • 🔑 *IDs:* \`Sale: ${f.sale_id || '-'}\` | \`Note: ${f.note_id || '-'}\`\n`;
        mensaje += `   • 🔄 *Intentos:* \`${f.attempt_count}\` | *Tipo:* ${tipoError}\n`;
        mensaje += `   • ⚠️ *Error:* \`${errorLimpio}\`\n\n`;
      }

      mensaje += `📊 *Resumen:* ${pendientes.length} documentos con problemas.\n`;
      mensaje += `📅 _Fecha: ${new Date().toLocaleString('es-PE')}_`;

      await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
        chat_id: this.GROUP_ID,
        text: mensaje,
        parse_mode: 'Markdown',
        disable_notification: false, 
      });

      this.logger.log('Reporte de producción enviado con éxito.');
    } catch (error) {
      this.logger.error(`Error crítico en AlarmaService: ${error.message}`);
    }
  }

  private async obtenerNombreLocal(saleId: string | number, noteId: string | number): Promise<string> {
    try {
      if (saleId) {
        const res = await this.entityManager.query(
          `SELECT l.name FROM sale s JOIN local l ON s.id_local = l.id_local WHERE s.id_sale = $1`,
          [saleId]
        );
        return res[0]?.name || 'Local no identificado';
      } 
      
      if (noteId) {
        const res = await this.entityManager.query(
          `SELECT l.name FROM credit_note c JOIN local l ON c.id_local = l.id_local WHERE c.id = $1`,
          [noteId]
        );
        return res[0]?.name || 'Local no identificado';
      }

      return 'N/A (Sin ID)';
    } catch (e) {
      return 'Error DB Local';
    }
  }
}