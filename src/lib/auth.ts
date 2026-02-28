import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db/index'
import * as schema from '#/db/schema/auth'
import { serverEnv } from '#/env/server'
import { sendEmail } from '#/lib/email'

export const auth = betterAuth({
  secret: serverEnv.BETTER_AUTH_SECRET,
  baseURL: serverEnv.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        html: `
          <p>Hi ${user.name},</p>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <p><a href="${url}">Reset password</a></p>
          <p>If you did not request a password reset, you can safely ignore this email.</p>
        `,
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your email address',
        html: `
          <p>Hi ${user.name},</p>
          <p>Click the link below to verify your email address.</p>
          <p><a href="${url}">Verify email</a></p>
          <p>If you did not create an account, you can safely ignore this email.</p>
        `,
      })
    },
  },
  socialProviders: {
    github: {
      clientId: serverEnv.GITHUB_CLIENT_ID,
      clientSecret: serverEnv.GITHUB_CLIENT_SECRET,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
    },
  },
  plugins: [tanstackStartCookies()],
})
