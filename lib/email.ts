import nodemailer from "nodemailer"

// ============================================================
// Envoi d'emails — socle standard SMALL.
// - SMTP Office 365 configuré par variables d'environnement.
// - Si SMTP_USER/SMTP_PASS sont vides (cas de la PRÉPROD), AUCUN email ne
//   part : chaque envoi est « simulé » et journalisé — c'est le mécanisme
//   d'étanchéité des environnements de test, à conserver.
// - SMTP_FROM doit être LA MÊME adresse que SMTP_USER (sinon rejet
//   SendAsDenied côté Office 365) et le chevron fermant `>` est obligatoire.
// ⚠️ Microsoft coupe l'auth SMTP basique fin 2026 : prévoir la bascule vers
//   Microsoft Graph sendMail (voir CLAUDE.md).
// ============================================================

function getTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.office365.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

export interface MailOptions {
  to: string
  subject: string
  html: string
  attachments?: { filename: string; content: string; contentType?: string }[]
}

export async function sendMail({ to, subject, html, attachments }: MailOptions) {
  const transport = getTransport()
  if (!transport) {
    console.log(`[email] SMTP non configuré — envoi simulé : "${subject}" → ${to}`)
    return { simulated: true }
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    html,
    attachments,
  })
  return { simulated: false }
}

// Gabarit HTML aux couleurs SMALL (bandeau anthracite + accent jaune fluo).
// Utiliser pour tous les emails de l'outil afin de rester dans la charte.
export function brandEmail({
  title,
  bodyHtml,
  ctaLabel,
  ctaUrl,
}: {
  title: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
}) {
  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="background:#DAFF00;border-radius:9px">
           <a href="${ctaUrl}" style="display:inline-block;padding:11px 22px;font-family:'Trebuchet MS',sans-serif;font-size:14px;font-weight:bold;color:#1E1F1C;text-decoration:none">${ctaLabel}</a>
         </td></tr></table>
         <p style="font-size:12px;color:#79786C;margin:6px 0 0">Si le bouton ne fonctionne pas : <a href="${ctaUrl}" style="color:#1E1F1C">${ctaUrl}</a></p>`
      : ""
  return `<!doctype html><html><body style="margin:0;background:#FFF7EF;padding:24px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden">
    <tr><td style="background:#1E1F1C;padding:18px 28px">
      <span style="font-family:'Trebuchet MS',sans-serif;font-size:18px;font-weight:bold;letter-spacing:0.2em;color:#FFFFFF">SMALL</span>
      <span style="font-family:'Trebuchet MS',sans-serif;font-size:10px;letter-spacing:0.3em;color:#ACACAB;text-transform:uppercase;display:block;margin-top:2px">Big Change</span>
    </td></tr>
    <tr><td style="padding:26px 28px;font-family:'Trebuchet MS',sans-serif;color:#1E1F1C">
      <h1 style="font-size:19px;margin:0 0 14px">${title}</h1>
      <div style="font-size:14px;line-height:1.55;color:#3F403A">${bodyHtml}</div>
      ${cta}
    </td></tr>
    <tr><td style="padding:14px 28px;border-top:1px solid #F0D5BD">
      <span style="font-family:'Trebuchet MS',sans-serif;font-size:11px;color:#79786C">SMALL Big Change — 28 Place Saint Georges, 75009 Paris</span>
    </td></tr>
  </table></body></html>`
}
