const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const ctrl    = require('../controllers/climateController');

router.use(auth);
router.get('/status', ctrl.status);
router.post('/respond', ctrl.responder);
router.post('/rounds', ctrl.abrirRodada);

module.exports = router;
