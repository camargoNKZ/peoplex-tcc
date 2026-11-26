const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const ctrl    = require('../controllers/requestsController');

router.use(auth, feature('requests'));
router.get('/', ctrl.listar);
router.post('/', ctrl.criar);
router.patch('/:id/status', ctrl.atualizarStatus);
router.patch('/:id', ctrl.editar);
router.delete('/:id', ctrl.excluir);

module.exports = router;
