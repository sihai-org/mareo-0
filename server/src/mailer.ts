// Verification-code delivery. Uses SMTP when configured (works with Feishu /
// Lark mail and any other provider); falls back to a console logger for local
// development and tests, and refuses to run silently in production without SMTP.
import nodemailer from 'nodemailer'

export interface Mailer {
  sendCode(to: string, code: string): Promise<void>
}

export function createEmailMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const host = env.SMTP_HOST?.trim()
  const user = env.SMTP_USER?.trim()
  const pass = env.SMTP_PASS ?? ''
  const from = env.SMTP_FROM?.trim() || user || ''

  if (!host || !user) {
    if (env.NODE_ENV === 'production') {
      // Do not break gateway startup or token-based usage: fail only when an
      // email is actually sent and no SMTP transport is configured.
      return {
        async sendCode(_to, _code) {
          throw new Error('SMTP_HOST/SMTP_USER are not configured; cannot deliver verification emails.')
        },
      }
    }
    return {
      async sendCode(to, code) {
        console.log(`[mail:dev] would email ${to} the code ${code} (SMTP not configured)`)
      },
    }
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT ?? 465),
    secure: (env.SMTP_SECURE ?? 'true') !== 'false',
    auth: { user, pass },
  })

  return {
    async sendCode(to, code) {
      await transport.sendMail({
        from,
        to,
        subject: 'Mareo 登录验证码 / Mareo sign-in code',
        text: `你的 Mareo 登录验证码是 ${code}，5 分钟内有效。若非本人操作请忽略本邮件。\n\nYour Mareo sign-in code is ${code}. It expires in 5 minutes. If you did not request it, ignore this email.`,
      })
    },
  }
}
