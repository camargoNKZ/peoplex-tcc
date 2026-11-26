const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const ctrl    = require('../controllers/noticesController');

router.use(auth, feature('notices'));
router.get('/', ctrl.listar);
router.post('/read', ctrl.markRead);
router.post('/', ctrl.criar);
router.patch('/:id', ctrl.editar);
router.delete('/:id', ctrl.remover);

module.exports = router;
