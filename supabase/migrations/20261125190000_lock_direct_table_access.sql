-- O navegador só acessa o banco direto para o Realtime de messages; o resto
-- passa pela API, que usa outro papel e valida permissões.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
