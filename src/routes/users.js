const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const upload  = require('../config/upload');
const ctrl    = require('../controllers/usersController');

router.post('/',              auth, feature('onboarding'),      ctrl.cadastrar);
router.get('/',               auth,                             ctrl.listar);
router.get('/directory',      auth, feature('messaging'),       ctrl.listarDiretorio);
router.patch('/:id/status',   auth,                             ctrl.alterarStatus);
router.patch('/:id/group',    auth,                             ctrl.atualizarGrupo);
router.patch('/:id/features', auth,                             ctrl.atualizarFeatures);
router.delete('/:id',         auth,                             ctrl.excluir);
router.get('/profile',        auth,                             ctrl.perfil);
router.put('/profile',        auth,                             ctrl.atualizarPerfil);
router.post('/photo',         auth, upload.single('foto'),      ctrl.uploadFoto);
router.post('/documents',     auth, feature('documents'), upload.single('documento'), ctrl.uploadDocumento);
router.get('/documents',      auth, feature('documents'),       ctrl.listarDocumentos);

module.exports = router;
