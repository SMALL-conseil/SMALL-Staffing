import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { loadStaffingData } from "@/lib/staffing-load"
import { icAtDate, mouvementsMoisProchain, sortiesMoisCourant } from "@/lib/staffing"
import { libelleMois, todayParis } from "@/lib/staffing-ui"
import { formatDate, formatDateShort } from "@/lib/utils"

// Intercontrat — réplique de l'onglet IC de l'Excel : consultants en IC à
// date (disponibles, sans mission en cours ni à venir), sorties de mission
// d'ici la fin du mois, mouvements du mois prochain (sorties + arrivées).
export default async function IntercontratPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { people, missions } = await loadStaffingData()
  const today = todayParis()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  const ic = icAtDate(people, missions, today)
  const sorties = sortiesMoisCourant(people, missions, today)
  const prochain = mouvementsMoisProchain(people, missions, today)

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">SMALL Staffing</div>
        <h1 className="titre-page mt-1.5">
          <span className="hl">Intercontrat</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">Au {formatDate(today)}</p>
      </div>

      <div className="card px-6 py-6 mb-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="titre-section">En intercontrat à date</h2>
          <span className={`tag ${ic.length > 0 ? "tag-rose" : "tag-ok"}`}>
            {ic.length > 0 ? `${ic.length} consultant${ic.length > 1 ? "s" : ""}` : "aucun"}
          </span>
        </div>
        {ic.length > 0 && (
          <table className="w-full text-[12.5px] mt-4">
            <thead>
              <tr className="text-label uppercase tracking-[0.08em] text-[10px]">
                <th className="text-left font-bold py-1.5 pr-3">Consultant</th>
                <th className="text-left font-bold py-1.5 px-3">Grade</th>
                <th className="text-left font-bold py-1.5 pl-3">Disponible depuis</th>
              </tr>
            </thead>
            <tbody>
              {ic.map((e) => (
                <tr key={e.personId} className="border-t border-ligne">
                  <td className="py-2 pr-3 font-bold text-anthracite">{e.name}</td>
                  <td className="py-2 px-3 text-texte">{e.grade}</td>
                  <td className="py-2 pl-3 text-texte-2">{formatDateShort(e.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-label mt-3">
          Consultants disponibles (arrivée ou retour d&rsquo;absence passés) sans aucune mission en
          cours ni à venir.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="card px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="titre-section">Sorties d&rsquo;ici fin {libelleMois(year, month).split(" ")[0]}</h2>
            <span className="tag tag-neutre">{sorties.length || "aucune"}</span>
          </div>
          {sorties.length > 0 ? (
            <ul className="mt-4 space-y-2.5">
              {sorties.map((e) => (
                <li key={e.personId} className="flex items-baseline justify-between gap-3 border-t border-ligne pt-2.5 flex-wrap">
                  <div>
                    <span className="text-[12.5px] font-bold text-anthracite">{e.name}</span>
                    <span className="text-[10.5px] text-label ml-2">{e.grade}</span>
                    {e.availableFrom && (
                      <span className="tag tag-rose ml-2">
                        absence jusqu&rsquo;au {formatDateShort(e.availableFrom)}
                      </span>
                    )}
                  </div>
                  <span className="text-[12px] text-texte-2 whitespace-nowrap">
                    fin de mission {formatDateShort(e.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-texte-2 mt-4">
              Aucune fin de mission d&rsquo;ici la fin du mois.
            </p>
          )}
          <p className="text-[11px] text-label mt-3">
            Dernière mission se terminant entre aujourd&rsquo;hui et la fin du mois — une absence
            prolongée en cours repousse la disponibilité réelle.
          </p>
        </div>

        <div className="card px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="titre-section">
              Mouvements de {libelleMois(nextYear, nextMonth).split(" ")[0]}
            </h2>
            <span className="tag tag-neutre">{prochain.length || "aucun"}</span>
          </div>
          {prochain.length > 0 ? (
            <ul className="mt-4 space-y-2.5">
              {prochain.map((e) => (
                <li key={e.personId} className="flex items-baseline justify-between gap-3 border-t border-ligne pt-2.5 flex-wrap">
                  <div>
                    <span className="text-[12.5px] font-bold text-anthracite">{e.name}</span>
                    <span className="text-[10.5px] text-label ml-2">{e.grade}</span>
                    <span className={`tag ml-2 ${e.type === "ARRIVEE" ? "tag-ok" : "tag-attente"}`}>
                      {e.type === "ARRIVEE" ? "arrivée" : "sortie de mission"}
                    </span>
                    {e.availableFrom && (
                      <span className="tag tag-rose ml-2">
                        absence jusqu&rsquo;au {formatDateShort(e.availableFrom)}
                      </span>
                    )}
                  </div>
                  <span className="text-[12px] text-texte-2 whitespace-nowrap">
                    {formatDateShort(e.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-texte-2 mt-4">Aucun mouvement connu le mois prochain.</p>
          )}
          <p className="text-[11px] text-label mt-3">
            Fins de mission du mois prochain, et arrivées de consultants sans mission.
          </p>
        </div>
      </div>
    </div>
  )
}
