BEGIN;

-- Papel fixo (owner/admin/hr/manager/employee) substituído por is_owner +
-- grupos de acesso (ver 20261105150000_access_groups.sql). Todo o código
-- já parou de ler/gravar essa coluna antes desta migration ser aplicada.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP COLUMN IF EXISTS role;

COMMIT;
