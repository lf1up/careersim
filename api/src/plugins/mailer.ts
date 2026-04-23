import nodemailer, { type Transporter } from 'nodemailer';
import fp from 'fastify-plugin';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface MailerOptions {
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  from: string;
  /**
   * When true (default in dev/test), rendered emails are captured in
   * `outbox` and logged rather than delivered. Tests read from `outbox`.
   */
  devFallback?: boolean;
  outbox?: MailMessage[];
}

declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
    mailOutbox: MailMessage[];
  }
}

export default fp<MailerOptions>(
  async (app, opts) => {
    const from = opts.from;
    const outbox: MailMessage[] = opts.outbox ?? [];
    const useSmtp = Boolean(opts.smtp?.host) && !opts.devFallback;

    let transporter: Transporter | null = null;
    if (useSmtp && opts.smtp) {
      transporter = nodemailer.createTransport({
        host: opts.smtp.host,
        port: opts.smtp.port,
        secure: opts.smtp.secure,
        auth:
          opts.smtp.user || opts.smtp.pass
            ? { user: opts.smtp.user, pass: opts.smtp.pass }
            : undefined,
      });
    }

    const mailer: Mailer = {
      async send(message) {
        outbox.push(message);
        if (transporter) {
          await transporter.sendMail({
            from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
          app.log.debug(
            { to: message.to, subject: message.subject },
            'mail.sent',
          );
        } else {
          app.log.info(
            {
              to: message.to,
              subject: message.subject,
              text: message.text,
            },
            'mail.devFallback',
          );
        }
      },
    };

    app.decorate('mailer', mailer);
    app.decorate('mailOutbox', outbox);

    app.addHook('onClose', async () => {
      transporter?.close();
    });
  },
  { name: 'mailer' },
);
