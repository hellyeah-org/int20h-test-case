import { Resend } from 'resend'

import { serverEnv } from '#/env/server'

const resend = new Resend(serverEnv.RESEND_API_KEY)

const FROM = 'onboarding@resend.dev'

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  })

  if (error) {
    console.error('[email] Failed to send email:', error)
  }
}
