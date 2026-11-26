const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const ctrl = require('../controllers/companySettingsController');

router.use(auth);
router.get('/email', ctrl.getEmailSettings);
router.put('/email', ctrl.saveEmailSettings);
router.delete('/email', ctrl.deleteEmailSettings);
router.post('/email/test', ctrl.testEmailSettings);

module.exports = router;
