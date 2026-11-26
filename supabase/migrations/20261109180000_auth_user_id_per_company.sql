-- users_auth_user_unique exigia auth_user_id único em TODA a tabela users,
-- impedindo que a mesma identidade do Supabase Auth (mesmo e-mail/senha)
-- fosse dona/admin de mais de uma empresa -- exatamente o que createTenant()
-- passou a suportar (mesmo e-mail reaproveitado entre tenants, já que o
-- Supabase Auth é global por e-mail, não por company_id). Troca por uma
-- unique composta (company_id, auth_user_id): continua impedindo duas linhas
-- da MESMA empresa com o mesmo auth_user_id, mas permite a mesma identidade
-- aparecer em empresas diferentes.
DROP INDEX IF EXISTS users_auth_user_unique;
CREATE UNIQUE INDEX IF NOT EXISTS users_company_auth_user_unique
  ON users(company_id, auth_user_id) WHERE auth_user_id IS NOT NULL;
