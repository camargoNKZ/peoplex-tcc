require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const db = require('./src/config/db');
const queueService = require('./src/services/queueService');
const app     = express();

// ── Middlewares globais ──
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // scriptSrcAttr: o Helmet herda 'none' por padrão quando omitido, o que
      // bloqueia todo onclick="" inline (login, cadastro, perfil) mesmo com
      // scriptSrc já permitindo unsafe-inline — descoberto porque o botão
      // "Entrar" parava de responder sem nenhum erro de rede.
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.supabase.co'],
      connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
      workerSrc: ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  if (!path.extname(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Nota sobre o worker da fila de e-mails: tentamos um setInterval solto e
// depois um gatilho via res.on("finish") — nenhum dos dois sobrevive em
// serverless. Testado em produção: a Vercel congela a instância assim que
// a resposta HTTP termina, sem garantia nenhuma de código rodando depois
// disso (sem usar a API waitUntil, que este projeto não integra). Por
// isso o processamento é chamado de forma síncrona (aguardado) logo após
// cada enqueueEmail(), dentro dos próprios controllers — ver
// noticesController, requestsController e emailController. O endpoint
// /internal/queue/process + Cron diário (limite do plano Hobby) cobre o
// caso raro de uma tentativa anterior ter ficado pendente por falha.

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

// Roda antes do middleware de auth de cada rota (é global, montado uma vez
// aqui embaixo), então não dá pra chavear por companyId/userId direto --
// eles ainda não existem em req. Em vez disso, usa o hash do próprio
// bearer token quando presente: sem isso, o limite era só por IP, e
// pessoas atrás do mesmo NAT/VPN corporativo (times inteiros, em
// empresas diferentes) dividiam a mesma cota e podiam derrubar o limite
// umas das outras em uso normal. Não precisa validar o token aqui -- é só
// uma chave de agrupamento, nunca usado pra autorizar nada.
function mutationLimiterKey(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return ipKeyGenerator(req.ip);
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
}

const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 150,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: req => !['POST','PUT','PATCH','DELETE'].includes(req.method),
  keyGenerator: mutationLimiterKey,
  message: { error: 'Muitas alterações em pouco tempo. Aguarde e tente novamente.' },
});

app.use(mutationLimiter);

// ── Arquivos estáticos ──
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ── Rotas da API ──
app.use('/auth',          authLimiter, require('./src/routes/auth'));
app.use('/users',         require('./src/routes/users'));
app.use('/requests',      require('./src/routes/requests'));
app.use('/request-types', require('./src/routes/requestTypes'));
app.use('/notices',       require('./src/routes/notices'));
app.use('/emails',        require('./src/routes/emails'));
app.use('/messages',      require('./src/routes/messages'));
app.use('/dashboard',     require('./src/routes/dashboard'));
app.use('/access-groups', require('./src/routes/accessGroups'));
app.use('/climate',       require('./src/routes/climate'));
app.use('/company',       require('./src/routes/companySettings'));
app.use('/platform',      authLimiter, require('./src/routes/platform'));
app.use('/internal',      require('./src/routes/internal'));

// ── Rota padrão ──
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'peopleX',
  version: require('./package.json').version,
  supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
  timestamp: new Date().toISOString(),
}));
app.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, service: 'peopleX', database: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, service: 'peopleX', database: 'unavailable', timestamp: new Date().toISOString() });
  }
});

// ── Tratamento de erros global ──
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Arquivo muito grande. Máximo: 5MB.' });
  }
  if (err.message && err.message.includes('permitidos')) {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
  }
  // Erros com status/statusCode 4xx já marcados como seguros de expor
  // (ex.: body-parser, express-rate-limit) são erro do cliente, não do
  // servidor — devolver 500 pra eles confundia diagnóstico (ver JSON
  // malformado acima, que chegava como "Erro interno do servidor").
  const clientStatus = err.expose && Number.isInteger(err.status || err.statusCode)
    ? (err.status || err.statusCode) : null;
  if (clientStatus && clientStatus >= 400 && clientStatus < 500) {
    return res.status(clientStatus).json({ error: err.message || 'Requisição inválida.' });
  }
  console.error('[Erro global]', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ── Inicialização ──
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 peopleX rodando em http://localhost:${PORT}`);
    console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Worker contínuo da fila de e-mails — só faz sentido com um processo
  // sempre de pé (dev local / servidor tradicional). Um setInterval solto
  // não sobrevive em serverless: a Vercel congela a instância assim que a
  // resposta HTTP é enviada, então o timer nunca chega a rodar de verdade
  // em segundo plano (foi testado em produção e confirmado: a linha ficava
  // presa em "processing" pra sempre). Em produção, ver o gatilho por
  // requisição no topo do arquivo + o endpoint /internal/queue/process via Cron.
  setInterval(() => {
    queueService.processPendingQueue().catch(error => {
      console.error('[Queue worker]', error.message);
    });
  }, 5000).unref();
}

module.exports = app;
