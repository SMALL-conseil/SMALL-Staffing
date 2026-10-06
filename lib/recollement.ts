// ============================================================
//  RECOLLEMENT classeur → registre de l'app (a42) — module PUR, testé dans
//  tests/recollement.test.ts. Aucune dépendance Prisma : entrées = lignes
//  simples, sortie = un PLAN d'actions. Les écritures vivent dans
//  scripts/recoller.ts, jamais ici.
//
//  POURQUOI : le moteur est une réplique certifiée du classeur, donc un écart
//  de taux vient toujours des DONNÉES (a21/a41). Les retrouver à la main,
//  chaque mois, consultant par consultant, est le vrai coût — et c'est là que
//  les « cas particuliers » se perdent. Ce module les nomme une fois pour
//  toutes et dit, pour chacun, QUI a raison.
//
//  QUI A RAISON — la règle de départage, décidée le 06/10/2026 :
//   · ABSENCES PROLONGÉES → PERSONNE, tant qu'un humain n'a pas tranché.
//     Une fenêtre « Absence » au classeur peut décrire une vraie absence ou
//     cacher un consultant simplement en INTERCONTRAT, et les deux sont
//     l'inverse l'un de l'autre pour le taux : une absence SORT la personne du
//     dénominateur et le fait MONTER, un intercontrat l'y laisse et le fait
//     baisser — ce qui est tout l'intérêt du KPI. Rien dans le fichier ne les
//     distingue. Chaque divergence est donc une PROPOSITION, appliquée
//     nommément (`absencesConfirmees`) et jamais autrement. Une SUPPRESSION
//     n'est jamais une action, même confirmée : elle est signalée.
//     (Octobre 2026 : les deux fenêtres étaient de vraies absences, le
//     classeur avait raison — la question valait d'être posée quand même.)
//   · GRADE, ARRIVÉE, DÉPART → l'APP. Ils viennent de Boond (synchro
//     quotidienne) ; le classeur est en retard par construction. Jamais
//     écrasés depuis l'Excel, seulement signalés.
//   · PERSONNE au classeur et pas dans l'app → CRÉATION proposée (une fiche
//     manquante fausse l'effectif ET le taux), avec l'agence du périmètre
//     recollé : une personne au classeur « Paris » EST parisienne.
//   · AGENCE VIDE alors que la personne est au classeur du périmètre →
//     renseignée (elle ne tenait au périmètre que par le repli s5).
//   · MISSIONS → création de celles qui manquent, PROLONGATION de celles qui
//     existent chez le même client avec d'autres dates. Jamais de suppression
//     (honoraires, rang de saisie), jamais de rang modifié.
// ============================================================
import { memeClient } from "./missions-proposees"

/** Fenêtre d'absence, telle que le registre la porte. `end` null = ouverte. */
export interface Fenetre {
  start: string
  end: string | null
}

/** Consultant vu du classeur (après résolution des alias de noms). */
export interface ConsultantClasseur {
  nom: string
  grade: string
  arrival: string
  departure: string | null
  absence: Fenetre | null
}

/** Mission vue du classeur. */
export interface MissionClasseur {
  nom: string
  client: string
  start: string
  end: string
  share: number
}

/** Fiche de l'app (seuls les champs qui servent au recollement). */
export interface FicheApp {
  id: string
  nom: string
  grade: string
  arrival: string
  departure: string | null
  agency: string | null
  absences: (Fenetre & { id: string })[]
}

/** Mission de l'app. */
export interface MissionApp {
  id: string
  personId: string
  client: string
  start: string
  end: string
  share: number
}

export type Action =
  | { type: "ABSENCE_AJOUT"; nom: string; personId: string; fenetre: Fenetre }
  | {
      type: "ABSENCE_MAJ"
      nom: string
      absenceId: string
      avant: Fenetre
      apres: Fenetre
    }
  | { type: "AGENCE"; nom: string; personId: string; agence: string }
  | {
      type: "PERSONNE_CREE"
      nom: string
      grade: string
      arrival: string
      departure: string | null
      agence: string
      absence: Fenetre | null
    }
  | {
      type: "MISSION_CREE"
      nom: string
      personId: string | null
      client: string
      start: string
      end: string
      share: number
    }
  | {
      type: "MISSION_MAJ"
      nom: string
      missionId: string
      client: string
      avant: { start: string; end: string; share: number }
      apres: { start: string; end: string; share: number }
    }

/** Catégorie d'une action — c'est l'unité d'autorisation côté script. */
export type Categorie = "absences" | "agences" | "personnes" | "missions"

export const CATEGORIES: Categorie[] = ["absences", "agences", "personnes", "missions"]

export function categorieDe(a: Action): Categorie {
  switch (a.type) {
    case "ABSENCE_AJOUT":
    case "ABSENCE_MAJ":
      return "absences"
    case "AGENCE":
      return "agences"
    case "PERSONNE_CREE":
      return "personnes"
    default:
      return "missions"
  }
}

/** Ce que le plan NE fait pas : à l'humain de trancher. */
export interface Signalement {
  nom: string
  quoi: string
  detail: string
}

/**
 * Divergence d'absence en attente d'un humain : le classeur ne distingue pas
 * une vraie absence d'un intercontrat garé dans les mêmes colonnes, et les
 * deux jouent en sens INVERSE sur le taux. `avant` null = aucune absence dans
 * l'app aujourd'hui.
 */
export interface PropositionAbsence {
  nom: string
  personId: string
  absenceId: string | null
  avant: Fenetre | null
  apres: Fenetre
}

export interface Plan {
  actions: Action[]
  signalements: Signalement[]
  /** Propositions d'absence : à confirmer nommément, jamais appliquées en bloc. */
  absencesAConfirmer: PropositionAbsence[]
}

const memeFenetre = (a: Fenetre, b: Fenetre) => a.start === b.start && (a.end ?? null) === (b.end ?? null)

export interface OptionsPlan {
  /** Clé de rapprochement des noms (alias du classeur résolus). */
  cle: (nom: string) => string
  /** Agence posée aux fiches créées / complétées. Null = ne rien poser. */
  agence: string | null
  /** Noms écartés du registre de l'app (correction assumée). */
  exclus?: string[]
  /**
   * Fiches EN COURS de l'app hors du périmètre chargé. Une personne au
   * classeur du périmètre qui s'y trouve n'est pas « manquante » : elle est
   * rattachée ailleurs. La créer ferait un doublon (et l'unicité partielle
   * s7 la refuserait de toute façon) — on signale, l'humain arbitre.
   */
  horsPerimetre?: { nom: string; agence: string | null }[]
  /**
   * Noms dont la divergence d'absence est CONFIRMÉE par un humain : eux seuls
   * donnent une action. Les autres restent des propositions à trancher — le
   * classeur ne distingue pas une vraie absence d'un intercontrat garé dans
   * les mêmes colonnes (cas Danny Gaurat).
   */
  absencesConfirmees?: string[]
}

/**
 * Confronte le classeur au registre de l'app et rend le PLAN des corrections.
 * Pur : ni base, ni horloge, ni fichier — tout entre par les paramètres.
 * Ne compare QUE les personnes du périmètre chargé côté app : une fiche
 * bordelaise absente du classeur parisien n'est pas un écart.
 */
export function planRecollement(
  classeur: { consultants: ConsultantClasseur[]; missions: MissionClasseur[] },
  app: { fiches: FicheApp[]; missions: MissionApp[] },
  opts: OptionsPlan
): Plan {
  const { cle, agence } = opts
  const exclus = new Set((opts.exclus ?? []).map(cle))
  const actions: Action[] = []
  const signalements: Signalement[] = []
  const absencesAConfirmer: PropositionAbsence[] = []

  const parCle = new Map(app.fiches.map((f) => [cle(f.nom), f]))
  const ailleurs = new Map((opts.horsPerimetre ?? []).map((f) => [cle(f.nom), f]))
  const confirmees = new Set((opts.absencesConfirmees ?? []).map(cle))
  const consultants = classeur.consultants.filter((c) => !exclus.has(cle(c.nom)))
  /** Personnes du classeur laissées de côté : leurs missions aussi. */
  const laissees = new Set<string>()

  for (const c of consultants) {
    const fiche = parCle.get(cle(c.nom))

    // ---- personne absente de l'app : création (fiche + absence du classeur)
    if (!fiche) {
      const autre = ailleurs.get(cle(c.nom))
      if (autre) {
        laissees.add(cle(c.nom))
        signalements.push({
          nom: c.nom,
          quoi: "au classeur du périmètre, mais rattachée ailleurs dans l'app",
          detail:
            `fiche en cours en ${autre.agence ?? "agence vide"} — soit le classeur la suit à tort,` +
            ` soit son agence est à corriger (ou c'est un transfert à enregistrer, s7). Jamais dupliquée.`,
        })
        continue
      }
      actions.push({
        type: "PERSONNE_CREE",
        nom: c.nom,
        grade: c.grade,
        arrival: c.arrival,
        departure: c.departure,
        agence: agence ?? "",
        absence: c.absence,
      })
      continue
    }

    // ---- grade / arrivée / départ : l'app (Boond) a raison — on signale
    const retards: string[] = []
    if (fiche.grade !== c.grade) retards.push(`grade ${c.grade} → ${fiche.grade}`)
    if (fiche.arrival !== c.arrival) retards.push(`arrivée ${c.arrival} → ${fiche.arrival}`)
    if ((fiche.departure ?? null) !== (c.departure ?? null))
      retards.push(`départ ${c.departure ?? "—"} → ${fiche.departure ?? "—"}`)
    if (retards.length) {
      signalements.push({
        nom: c.nom,
        quoi: "classeur en retard sur l'app (Boond fait foi)",
        detail: retards.join(" · "),
      })
    }

    // ---- agence vide alors que la personne est au classeur du périmètre
    if (agence && fiche.agency !== agence) {
      if (!fiche.agency) {
        actions.push({ type: "AGENCE", nom: fiche.nom, personId: fiche.id, agence })
      } else {
        signalements.push({
          nom: fiche.nom,
          quoi: "agence différente du périmètre recollé",
          detail: `fiche ${fiche.agency}, mais présente au classeur ${agence} — à trancher à la main`,
        })
      }
    }

    // ---- absences : proposition, jamais une évidence (cf. en-tête)
    const confirmee = confirmees.has(cle(c.nom))
    if (c.absence) {
      if (!fiche.absences.length) {
        if (confirmee) {
          actions.push({ type: "ABSENCE_AJOUT", nom: fiche.nom, personId: fiche.id, fenetre: c.absence })
        } else {
          absencesAConfirmer.push({
            nom: fiche.nom,
            personId: fiche.id,
            absenceId: null,
            avant: null,
            apres: c.absence,
          })
        }
      } else if (fiche.absences.length === 1) {
        const a = fiche.absences[0]
        if (!memeFenetre(a, c.absence)) {
          if (confirmee) {
            actions.push({
              type: "ABSENCE_MAJ",
              nom: fiche.nom,
              absenceId: a.id,
              avant: { start: a.start, end: a.end },
              apres: c.absence,
            })
          } else {
            absencesAConfirmer.push({
              nom: fiche.nom,
              personId: fiche.id,
              absenceId: a.id,
              avant: { start: a.start, end: a.end },
              apres: c.absence,
            })
          }
        }
      } else if (!fiche.absences.some((a) => memeFenetre(a, c.absence!))) {
        // Plusieurs absences côté app : laquelle le classeur décrit-il ? On ne
        // devine pas sur un registre.
        signalements.push({
          nom: fiche.nom,
          quoi: "plusieurs absences dans l'app",
          detail:
            `classeur ${c.absence.start} → ${c.absence.end ?? "ouverte"} ; app ` +
            fiche.absences.map((a) => `${a.start} → ${a.end ?? "ouverte"}`).join(" ; "),
        })
      }
    } else if (fiche.absences.length) {
      // Connue de l'app seule : peut-être la plus récente — jamais supprimée.
      signalements.push({
        nom: fiche.nom,
        quoi: "absence connue de l'app seule (jamais supprimée)",
        detail: fiche.absences.map((a) => `${a.start} → ${a.end ?? "ouverte"}`).join(" ; "),
      })
    }
  }

  // ---- missions ------------------------------------------------------------
  const nomDe = new Map(app.fiches.map((f) => [f.id, f.nom]))
  const dejaUtilisees = new Set<string>()
  const connues = new Set(consultants.map((c) => cle(c.nom)).filter((k) => !laissees.has(k)))

  const aTraiter = classeur.missions.filter((m) => connues.has(cle(m.nom)))

  // Deux passes, et l'ordre du classeur cesse de décider. Passe 1 : les
  // missions IDENTIQUES des deux côtés sont appariées d'abord — sinon une
  // ligne du classeur qui chevauche deux missions pourrait s'attribuer celle
  // qui appartient, à l'identique, à une ligne suivante.
  const resteAApparier: MissionClasseur[] = []
  for (const m of aTraiter) {
    const fiche = parCle.get(cle(m.nom))
    const identique = fiche
      ? app.missions.find(
          (x) =>
            x.personId === fiche.id &&
            !dejaUtilisees.has(x.id) &&
            memeClient(x.client, m.client) &&
            x.start === m.start &&
            x.end === m.end &&
            x.share === m.share
        )
      : undefined
    if (identique) dejaUtilisees.add(identique.id)
    else resteAApparier.push(m)
  }

  // Passe 2 : ce qui reste est soit la même mission qui a BOUGÉ (prolongation,
  // part revue) — on ajuste, jamais on duplique — soit une mission à créer.
  const recouvrement = (a: MissionClasseur, b: MissionApp) =>
    a.start <= b.end && b.start <= a.end
      ? (Math.min(Date.parse(a.end), Date.parse(b.end)) -
          Math.max(Date.parse(a.start), Date.parse(b.start))) /
        86_400_000
      : -1
  for (const m of resteAApparier) {
    const fiche = parCle.get(cle(m.nom))
    // Titulaire pas encore créé : la mission suivra la création de la fiche.
    if (!fiche) {
      actions.push({
        type: "MISSION_CREE",
        nom: m.nom,
        personId: null,
        client: m.client,
        start: m.start,
        end: m.end,
        share: m.share,
      })
      continue
    }
    // Le meilleur candidat est celui qui recouvre le PLUS — pas le premier venu.
    const aAjuster = app.missions
      .filter(
        (x) =>
          x.personId === fiche.id &&
          !dejaUtilisees.has(x.id) &&
          memeClient(x.client, m.client) &&
          recouvrement(m, x) >= 0
      )
      .sort((x, y) => recouvrement(m, y) - recouvrement(m, x))[0]
    if (aAjuster) {
      dejaUtilisees.add(aAjuster.id)
      actions.push({
        type: "MISSION_MAJ",
        nom: fiche.nom,
        missionId: aAjuster.id,
        client: aAjuster.client,
        avant: { start: aAjuster.start, end: aAjuster.end, share: aAjuster.share },
        apres: { start: m.start, end: m.end, share: m.share },
      })
      continue
    }
    actions.push({
      type: "MISSION_CREE",
      nom: fiche.nom,
      personId: fiche.id,
      client: m.client,
      start: m.start,
      end: m.end,
      share: m.share,
    })
  }

  // Missions de l'app qu'aucune ligne du classeur ne réclame : signalées
  // (saisies dans l'app, ou classeur en retard) — jamais supprimées.
  for (const x of app.missions) {
    if (dejaUtilisees.has(x.id)) continue
    const nom = nomDe.get(x.personId)
    if (!nom || !connues.has(cle(nom))) continue
    signalements.push({
      nom,
      quoi: "mission de l'app absente du classeur (jamais supprimée)",
      detail: `${x.client} · ${x.start} → ${x.end} · part ${x.share}`,
    })
  }

  return { actions, signalements, absencesAConfirmer }
}

/** Une ligne lisible par action — le plan est fait pour être relu avant d'écrire. */
export function libelleAction(a: Action): string {
  switch (a.type) {
    case "ABSENCE_AJOUT":
      return `${a.nom} — AJOUTER l'absence ${a.fenetre.start} → ${a.fenetre.end ?? "ouverte"}`
    case "ABSENCE_MAJ":
      return (
        `${a.nom} — CORRIGER l'absence ${a.avant.start} → ${a.avant.end ?? "ouverte"}` +
        ` en ${a.apres.start} → ${a.apres.end ?? "ouverte"}`
      )
    case "AGENCE":
      return `${a.nom} — RENSEIGNER l'agence ${a.agence} (vide aujourd'hui, donc Paris par repli)`
    case "PERSONNE_CREE":
      return (
        `${a.nom} — CRÉER la fiche (${a.grade}, arrivée ${a.arrival}` +
        `${a.departure ? `, départ ${a.departure}` : ""}${a.agence ? `, ${a.agence}` : ""})` +
        `${a.absence ? ` + absence ${a.absence.start} → ${a.absence.end ?? "ouverte"}` : ""}`
      )
    case "MISSION_CREE":
      return `${a.nom} — CRÉER la mission ${a.client} ${a.start} → ${a.end} · part ${a.share}`
    case "MISSION_MAJ":
      return (
        `${a.nom} — AJUSTER la mission ${a.client} ${a.avant.start} → ${a.avant.end} (part ${a.avant.share})` +
        ` en ${a.apres.start} → ${a.apres.end} (part ${a.apres.share})`
      )
  }
}
