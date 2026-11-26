const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');

// Acionado pelo Vercel Cron (vercel.json) em produção, onde um setInterval
// de processo não sobrevive entre invocações serverless. Vercel Cron chama
// via GET e injeta "Authorization: Bearer <CRON_SECRET>" automaticamente
// quando a env var CRON_SECRET está configurada no projeto — é essa
// convenção nativa que validamos aqui, não um segredo próprio.
router.get('/queue/process', async (req, res) => {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.authorization;
  if (!expected || provided !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const summary = await queueService.processPendingQueue();
    res.json({ ok: true, ...summary });
  } catch (error) {
    console.error('[Queue process endpoint]', error);
    res.status(500).json({ error: 'Erro ao processar fila.' });
  }
});

module.exports = router;
