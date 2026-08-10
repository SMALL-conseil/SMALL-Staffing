import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

// Authentification standard SMALL : Credentials (email/mdp) + SSO Microsoft
// Entra ID optionnel (actif seulement si les variables AUTH_MICROSOFT_* sont
// renseignées). Règle : le SSO n'accepte que les comptes DÉJÀ présents en base
// (créés par un admin) — jamais de création de compte à la volée.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_CLIENT_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
        ? `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`
        : undefined,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        })
        if (!user || !user.active) return null
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )
        if (!valid) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "microsoft-entra-id") {
        if (!user.email) return false
        const dbUser = await prisma.user.findUnique({ where: { email: user.email } })
        return !!dbUser && dbUser.active
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "microsoft-entra-id" && token.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: token.email } })
        if (dbUser) {
          token.id = dbUser.id
          token.role = dbUser.role
        }
      } else if (user) {
        token.id = user.id ?? ""
        token.role = (user as any).role
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      return session
    },
  },
  trustHost: true,
  cookies: { sessionToken: { name: "staffing.session-token" } },
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
})
