"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError("Email ou mot de passe incorrect.")
    } else {
      router.push("/")
      router.refresh()
    }
  }

  async function handleMicrosoftSignIn() {
    await signIn("microsoft-entra-id", { callbackUrl: "/" })
  }

  return (
    <div className="w-full max-w-[410px] card rounded-[18px] px-10 py-11 max-sm:px-6 max-sm:py-8">
      {/* Marque */}
      <div className="text-anthracite text-[27px] font-bold tracking-[0.2em]">SMALL</div>
      <div className="text-label text-[10px] tracking-[0.38em] uppercase mt-1">
        Big Change
      </div>

      <h1 className="titre-formation text-[23px] mt-6 mb-1">
        Connexion à <span className="hl">SMALL App</span>
      </h1>
      <p className="text-[13px] text-texte-2 mb-6">
        Outil interne SMALL Big Change
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 px-4 py-3 bg-err-bg border border-err-ligne rounded-[10px] text-sm text-err"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="field-label">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="field-input"
            placeholder="prenom.nom@small-conseil.com"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="field-label">
            Mot de passe
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="field-input"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary btn-block mt-2"
        >
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5 text-label text-[11px] uppercase tracking-[0.18em]">
        <div className="flex-1 h-px bg-ligne" aria-hidden="true" />
        ou
        <div className="flex-1 h-px bg-ligne" aria-hidden="true" />
      </div>

      <button
        type="button"
        onClick={handleMicrosoftSignIn}
        className="btn btn-ghost btn-block"
      >
        <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#F25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
        Se connecter avec Microsoft
      </button>
    </div>
  )
}
