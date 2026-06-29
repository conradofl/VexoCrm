import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY || 're_123_placeholder_so_it_doesnt_crash');

export class ResendProvider {
  /**
   * Envia um email usando a API do Resend
   * @param {string} to Destinatário do e-mail
   * @param {string} subject Assunto
   * @param {string} html Corpo HTML
   * @param {string} [fromName] Nome do remetente opcional
   */
  static async sendEmail(to, subject, html, fromName = 'Equipe Comercial') {
    if (!process.env.RESEND_API_KEY) {
      console.warn('[ResendProvider] RESEND_API_KEY não configurada. E-mail não enviado.');
      return null;
    }

    try {
      const { data, error } = await resend.emails.send({
        from: `${fromName} <contato@vexoia.com>`, // Ajuste conforme domínio autenticado no Resend
        to: [to],
        subject,
        html,
      });

      if (error) {
        console.error('[ResendProvider] Erro ao enviar email:', error);
        throw error;
      }

      console.log(`[ResendProvider] E-mail enviado com sucesso para ${to}. ID: ${data.id}`);
      return data;
    } catch (err) {
      console.error('[ResendProvider] Falha crítica:', err);
      throw err;
    }
  }
}
