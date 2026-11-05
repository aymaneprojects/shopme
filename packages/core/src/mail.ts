import nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; text: string; html?: string; from?: string; replyTo?: string }
export interface Mailer { send(mail: Mail): Promise<void> }
interface Logger { info(obj: unknown, msg?: string): void }

/** SMTP mailer when `smtpUrl` is set, otherwise a console mailer that logs the message. */
export function createMailer(opts: { smtpUrl?: string; from: string; logger?: Logger }): Mailer {
  if (!opts.smtpUrl) {
    return {
      async send(m) {
        const log = opts.logger ? (o: unknown, msg: string) => opts.logger!.info(o, msg) : (o: unknown, msg: string) => console.log(msg, o);
        log({ to: m.to, subject: m.subject, text: m.text }, 'email (SMTP_URL not set, not sent)');
      },
    };
  }
  const transport = nodemailer.createTransport(opts.smtpUrl);
  return { async send(m) { await transport.sendMail({ from: opts.from, ...m }); } };
}
