BEGIN;

-- "Clima da equipe" e "Pulso da cultura" no dashboard eram número fixo no
-- HTML (8,6/10 pra qualquer empresa, sempre) -- nunca existiu pesquisa de
-- verdade por trás. Isso cria uma pesquisa real, com 3 perguntas fixas
-- (mesmas 3 categorias que a tela já mostrava: comunicação, liderança,
-- bem-estar), em rodadas abertas/fechadas. Resposta é por colaborador
-- (pra não deixar responder duas vezes na mesma rodada), mas a API nunca
-- expõe resposta individual -- só médias agregadas.

CREATE TABLE IF NOT EXISTS climate_survey_rounds (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opened_by BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  UNIQUE (id, company_id),
  CONSTRAINT climate_round_status_check CHECK (status IN ('open','closed')),
  CONSTRAINT climate_round_opener_tenant_fk FOREIGN KEY (opened_by, company_id) REFERENCES users(id, company_id)
);

-- No máximo 1 rodada aberta por empresa de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS climate_one_open_round_per_company
  ON climate_survey_rounds (company_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS climate_survey_answers (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  round_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  comunicacao SMALLINT NOT NULL,
  lideranca SMALLINT NOT NULL,
  bem_estar SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, user_id),
  CONSTRAINT climate_answers_round_tenant_fk FOREIGN KEY (round_id, company_id) REFERENCES climate_survey_rounds(id, company_id) ON DELETE CASCADE,
  CONSTRAINT climate_answers_user_tenant_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id),
  CONSTRAINT climate_answers_range_check CHECK (
    comunicacao BETWEEN 0 AND 10 AND lideranca BETWEEN 0 AND 10 AND bem_estar BETWEEN 0 AND 10
  )
);

CREATE INDEX IF NOT EXISTS climate_answers_round_idx ON climate_survey_answers (round_id);

ALTER TABLE climate_survey_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE climate_survey_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON climate_survey_rounds;
DROP POLICY IF EXISTS tenant_isolation_insert ON climate_survey_rounds;
DROP POLICY IF EXISTS tenant_isolation_update ON climate_survey_rounds;
CREATE POLICY tenant_isolation_select ON climate_survey_rounds FOR SELECT TO authenticated
  USING (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_insert ON climate_survey_rounds FOR INSERT TO authenticated
  WITH CHECK (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_update ON climate_survey_rounds FOR UPDATE TO authenticated
  USING (company_id = private.auth_company_id()) WITH CHECK (company_id = private.auth_company_id());

DROP POLICY IF EXISTS tenant_isolation_select ON climate_survey_answers;
DROP POLICY IF EXISTS tenant_isolation_insert ON climate_survey_answers;
CREATE POLICY tenant_isolation_select ON climate_survey_answers FOR SELECT TO authenticated
  USING (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_insert ON climate_survey_answers FOR INSERT TO authenticated
  WITH CHECK (company_id = private.auth_company_id());

COMMIT;
