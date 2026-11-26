const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const ctrl    = require('../controllers/accessGroupsController');

router.use(auth);
router.get('/', ctrl.listar);
router.post('/', ctrl.criar);
router.patch('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.excluir);

module.exports = router;
