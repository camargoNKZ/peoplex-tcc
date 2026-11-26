BEGIN;

-- Feature flag por colaborador, em cima da flag por empresa já existente
-- em companies.features. A feature efetiva é a interseção das duas (ver
-- src/policies/features.js:mergeFeatures) -- ausência de chave aqui
-- significa "sem restrição própria", herdando o que a empresa definiu.
ALTER TABLE users ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
