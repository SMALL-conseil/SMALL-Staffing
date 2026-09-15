-- s8 (15/09/2026) — la RESSOURCE de la prestation (relation Boond `dependsOn`)
-- et ses jours ouvrés de référence. Relevé du 15/09 : /deliveries/{id} porte
-- `dependsOn = resource#NN`, ce qui rend les missions fabricables (personne +
-- client + dates + TJM vendu). Idempotente.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "resourceBoondId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "workingDays" DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS "Delivery_resourceBoondId_idx" ON "Delivery"("resourceBoondId");
