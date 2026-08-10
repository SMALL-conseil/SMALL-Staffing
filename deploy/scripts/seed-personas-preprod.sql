-- ============================================================
--  Personas de recette PRÉPROD — idempotent, garde-fou anti-prod.
--  Injection :  docker compose -f docker-compose.prod.yml exec -T postgres \
--    psql -U <user> -d small_app_preprod -f - < scripts/seed-personas-small-app.sql
--  Mot de passe commun : Smallchange2024!  (hash bcrypt ci-dessous)
-- ============================================================

DO $$
BEGIN
  -- Garde-fou : ne JAMAIS s'exécuter ailleurs qu'en préprod
  IF current_database() NOT LIKE '%preprod%' THEN
    RAISE EXCEPTION 'Garde-fou : cette base (%) n''est pas une préprod', current_database();
  END IF;

  INSERT INTO "User" (id, email, name, password, role, active, "createdAt", "updatedAt")
  VALUES
    ('persona-admin-preprod',  'persona.admin@small-conseil.fr',  'Persona Admin',
     '$2b$10$mg0aXrZZZdcr.hqMsIJT6.SWNM/T8/yyhbmB/vpwiFhqGk4h1.VP.', 'ADMIN',  true, now(), now()),
    ('persona-membre-preprod', 'persona.membre@small-conseil.fr', 'Persona Membre',
     '$2b$10$mg0aXrZZZdcr.hqMsIJT6.SWNM/T8/yyhbmB/vpwiFhqGk4h1.VP.', 'MEMBER', true, now(), now())
  ON CONFLICT (email) DO NOTHING;
END $$;
