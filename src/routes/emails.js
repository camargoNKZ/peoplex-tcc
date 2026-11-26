const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const ctrl    = require('../controllers/emailController');

router.use(auth, feature('email_broadcast'));
router.post('/broadcast', ctrl.broadcast);
router.get('/logs', ctrl.logs);

module.exports = router;
