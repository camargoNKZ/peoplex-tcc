const express = require('express');
const auth = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const controller = require('../controllers/dashboardController');

const router = express.Router();
router.get('/overview', auth, controller.overview);
router.get('/analytics', auth, feature('analytics'), controller.analytics);
router.get('/realtime-config', auth, controller.realtimeConfig);

module.exports = router;
