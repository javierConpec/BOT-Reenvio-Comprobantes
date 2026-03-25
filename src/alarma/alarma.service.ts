import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
  ) {}

  // CONFIGURACIÓN DEL HORARIO: 10:00 y 18:00 (6 PM)
  // El formato es: 'segundo minuto hora día_mes mes día_semana'
  @Cron('0 0 10,18 * * *', {
    timeZone: 'America/Lima', // Asegura que use la hora de Perú sin importar dónde esté el server
  })
  async ejecutarAlarmaProgramada() {
    this.logger.log('Iniciando escaneo automático de facturas...');
    await this.procesarEscaneo();
  }

  // Si prefieres que sea cada 8 horas exactas, usa esta en su lugar:
  // @Cron('0 0 */8 * * *', { timeZone: 'America/Lima' })

  private async procesarEscaneo() {
    try {
      const pendientes = await this.billingRepo.find({
        where: { status: In([40031, 40030]) },
        order: { attempt_count: 'DESC', created_at: 'DESC' }, 
        take: 10 
      });

      if (pendientes.length === 0) {
        this.logger.log('Todo en orden. No hay facturas pendientes.');
        return;
      }

      let mensaje = `🚨 *MONITOR DE FACTURACIÓN* 🚨\n\n`;
      
      pendientes.forEach((f, index) => {
        let iconoStatus = f.status === 40031 ? '❌' : '⏳';
        let nivelUrgencia = '';

        if (f.attempt_count >= 5) {
          iconoStatus = '🔥';
          nivelUrgencia = ' *[URGENTE]*';
        }

        const tipoError = f.status === 40031 ? 'SISTEMA' : 'CONEXIÓN';
        
        let errorMsg = 'Sin detalle';
        if (f.response) {
            try {
                const resData = (typeof f.response === 'string') 
                    ? JSON.parse(f.response) 
                    : f.response;
                errorMsg = resData.Mensaje || resData.mensaje || resData.message || resData.description || JSON.stringify(resData);
            } catch {
                errorMsg = String(f.response);
            }
        }

        const errorLimpio = errorMsg.replace(/[`*]/g, '').trim();

        mensaje += `${index + 1}. ${iconoStatus} *${f.document_full_number}*${nivelUrgencia}\n`;
        mensaje += `   • *IDs:* \`Sale: ${f.sale_id || 'N/A'}\` | \`Note: ${f.note_id || 'N/A'}\`\n`;
        mensaje += `   • *Intentos:* \`${f.attempt_count}\` | *Origen:* ${tipoError}\n`;
        mensaje += `   • *Error:* \`${errorLimpio}\`\n\n`;
      });

      mensaje += `📊 *Resumen:* ${pendientes.length} pendientes.\n`;
      mensaje += `📅 _${new Date().toLocaleString('es-PE')}_`;

      await axios.post(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
        chat_id: this.GROUP_ID,
        text: mensaje,
        parse_mode: 'Markdown',
      });

      this.logger.log('Reporte automático enviado con éxito.');

    } catch (error) {
      this.logger.error(`Error en el proceso automático: ${error.message}`, error.stack);
    }
  }
}