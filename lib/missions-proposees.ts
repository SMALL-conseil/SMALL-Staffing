// ============================================================
//  MISSIONS PROPOSÉES PAR LES PRESTATIONS BOOND (s8) — logique PURE, testée.
//
//  Relevé du 15/09 : /deliveries/{id} porte `dependsOn = resource#NN`, donc la
//  PERSONNE ; plus les dates, le TJM vendu, les jours vendus et le projet (→ le
//  client). Une prestation contient donc tout ce qu'est une mission de l'app,
//  à une chose près : la PART d'intervention, qui ne figure nulle part et se
//  déduit des jours vendus.
//
//  DÉCISION DU 15/09 (Sacha) : les prestations PROPOSENT, elles n'écrivent pas.
//  Le registre des missions reste la source de vérité — une mission saisie ou
//  corrigée à la main n'est jamais réécrite, et rien n'entre sans qu'un humain
//  l'ait vu. Même contrat que la synchro des personnes.
//
//  Ce module ne fait QUE décider quoi proposer. L'écriture est ailleurs.
// ============================================================

/** Une prestation Boond, réduite à ce qui fait une mission. */
export interface PrestationSource {
  boondId: string
  personId: string
  client: string
  start: string
  end: string
  dailyRate: number | null
  daysSold: number | null
  workingDays: number | null
}

/** Une mission déjà au registre. */
export interface MissionExistante {
  personId: string
  client: string
  start: string
  end: string
}

export interface Proposition {
  boondId: string
  personId: string
  client: string
  start: string
  end: string
  /** TJM vendu, repris tel quel en honoraires. */
  fees: number | null
  /** Part d'intervention proposée (0 < part ≤ 1). */
  share: number
  /** Pourquoi cette part — affiché au siège, qui tranche. */
  motifShare: string
  /** Mission existante qui CHEVAUCHE la fenêtre chez un AUTRE client. Ce n'est
   *  pas un doublon — on travaille à temps partagé — mais ça mérite un regard
   *  avant de créer. Null = aucun recouvrement. */
  chevauche: string | null
}

const JOURS_OUVRES_AN = 218

/** Nombre approximatif de jours ouvrés entre deux dates (5/7 des jours). */
function joursOuvresApprox(start: string, end: string): number {
  const d1 = Date.parse(`${start}T00:00:00Z`)
  const d2 = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(d1) || !Number.isFinite(d2) || d2 < d1) return 0
  const jours = Math.round((d2 - d1) / 86_400_000) + 1
  return (jours * 5) / 7
}

/**
 * Part d'intervention déduite des jours vendus.
 *
 * Un temps plein vend à peu près le nombre de jours ouvrés de la fenêtre, moins
 * les congés : le rapport tourne autour de 0,85–1. On ne propose donc une part
 * réduite que lorsque l'écart est FRANC (≤ 0,7), et on l'arrondit au quart —
 * un mi-temps se vend à 0,5, pas à 0,4873. Dans le doute : 1, et le siège
 * corrige. Mieux vaut une part visiblement à vérifier qu'un chiffre inventé
 * qui a l'air juste.
 */
export function partProposee(p: PrestationSource): { share: number; motif: string } {
  const ouvres = joursOuvresApprox(p.start, p.end) || p.workingDays || JOURS_OUVRES_AN
  if (!p.daysSold || ouvres <= 0) return { share: 1, motif: "temps plein supposé (jours vendus inconnus)" }
  const ratio = p.daysSold / ouvres
  if (ratio > 0.7) return { share: 1, motif: `temps plein (${p.daysSold} j vendus / ~${Math.round(ouvres)} j ouvrés)` }
  const quart = Math.max(0.25, Math.min(1, Math.round(ratio * 4) / 4))
  return {
    share: quart,
    motif: `temps partiel supposé : ${p.daysSold} j vendus / ~${Math.round(ouvres)} j ouvrés → ${quart}`,
  }
}

/** Deux fenêtres se chevauchent-elles ? */
const chevauchent = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  a.start <= b.end && b.start <= a.end

/** Libellé client comparable : sans accents, sans casse, sans ponctuation. */
const normClient = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")

/**
 * Même client des deux côtés ? Le registre écrit « GROUPAMA » quand Boond dit
 * « Groupama », « FDJ » quand Boond dit « FDJ - Française des jeux » : on
 * compare donc par inclusion, sur des libellés normalisés. Le seuil de 3
 * caractères évite qu'une abréviation d'une lettre ne rapproche n'importe quoi.
 */
export function memeClient(a: string, b: string): boolean {
  const x = normClient(a)
  const y = normClient(b)
  if (x.length < 3 || y.length < 3) return x === y && x.length > 0
  return x.includes(y) || y.includes(x)
}

/**
 * Les prestations qui ne correspondent à AUCUNE mission du registre.
 *
 * « Correspondre » = même personne, fenêtre qui chevauche, ET même client (aux
 * libellés près : « GROUPAMA » / « Groupama »). Le client compte, car une même
 * personne peut tenir DEUX missions en parallèle chez deux clients — c'est tout
 * l'objet de la part d'intervention. Les ignorer sous prétexte de recouvrement
 * ferait disparaître la seconde des propositions, et donc du registre.
 *
 * Un recouvrement chez un autre client n'est donc pas éliminatoire : il est
 * SIGNALÉ (`chevauche`), pour que le siège regarde avant de créer.
 */
export function propositions(
  prestations: PrestationSource[],
  missions: MissionExistante[]
): Proposition[] {
  const parPersonne = new Map<string, MissionExistante[]>()
  for (const m of missions) parPersonne.set(m.personId, [...(parPersonne.get(m.personId) ?? []), m])

  const out: Proposition[] = []
  for (const p of prestations) {
    if (!p.personId || !p.client || !p.start || !p.end) continue
    if (p.end < p.start) continue
    const recouvrantes = (parPersonne.get(p.personId) ?? []).filter((m) => chevauchent(m, p))
    if (recouvrantes.some((m) => memeClient(m.client, p.client))) continue // déjà au registre
    const autre = recouvrantes[0]
    const { share, motif } = partProposee(p)
    out.push({
      boondId: p.boondId,
      personId: p.personId,
      client: p.client,
      start: p.start,
      end: p.end,
      fees: p.dailyRate,
      share,
      motifShare: motif,
      chevauche: autre ? `${autre.client} (${autre.start} → ${autre.end})` : null,
    })
  }
  // Les plus récentes d'abord : ce sont celles qui pèsent sur les chiffres du jour.
  return out.sort((a, b) => b.start.localeCompare(a.start))
}
