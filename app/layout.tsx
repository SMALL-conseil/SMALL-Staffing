import type { Metadata } from "next"
import { Libre_Caslon_Text } from "next/font/google"
import "./globals.css"

// Libre Caslon Text n'existe qu'en 400 (normal + italique) et 700 (normal, sans italique).
// On charge donc exactement les variantes utilisées par le thème Brume :
// 700 normal pour les titres, 400 italique pour les intertitres.
const caslon = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: "700",
  style: "normal",
  variable: "--font-caslon",
  display: "swap",
})

const caslonItalic = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-caslon-italic",
  display: "swap",
})

export const metadata: Metadata = {
  title: "SMALL App",
  description: "Outil interne SMALL Big Change",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`h-full ${caslon.variable} ${caslonItalic.variable}`}>
      <body className="h-full">{children}</body>
    </html>
  )
}
