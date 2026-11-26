const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const ctrl    = require('../controllers/requestsController');

router.use(auth, feature('requests'));
router.get('/', ctrl.listarTipos);
router.get('/admin', ctrl.listarTiposAdmin);
router.post('/', ctrl.criarTipo);
router.patch('/:id', ctrl.atualizarTipo);
router.delete('/:id', ctrl.excluirTipo);

module.exports = router;
