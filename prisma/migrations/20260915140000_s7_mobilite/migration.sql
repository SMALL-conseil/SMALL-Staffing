-- s7 (15/09/2026) — MOBILITÉ INTER-AGENCES.
-- Une personne transférée de Paris à Bordeaux porte DEUX fiches datées : la
-- période parisienne close à la veille du transfert, la période bordelaise
-- ouverte le jour même. Chaque agence garde ainsi ses chiffres justes, passé
-- compris, et « Tout SMALL » reste continu.
-- Idempotente (IF NOT EXISTS / DO block).

-- 1. Le lien entre les deux périodes (la fiche EN COURS pointe vers la précédente).
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "previousId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Person_previousId_key" ON "Person"("previousId");
DO $$ BEGIN
  ALTER TABLE "Person"
    ADD CONSTRAINT "Person_previousId_fkey" FOREIGN KEY ("previousId")
    REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. L'unicité (name, kind) devient PARTIELLE : au plus une fiche EN COURS par
--    personne. Les périodes CLOSES peuvent se répéter — c'est tout l'objet du
--    transfert. Le garde-fou contre le vrai doublon (deux fiches ouvertes pour
--    la même personne) reste donc en place.
DROP INDEX IF EXISTS "Person_name_kind_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Person_name_kind_encours_key"
  ON "Person"("name", "kind") WHERE "departureDate" IS NULL;
