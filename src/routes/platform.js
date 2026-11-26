const express = require('express');
const controller = require('../controllers/platformController');
const platformAuth = require('../middlewares/platformAuth');

const router = express.Router();
router.post('/bootstrap', controller.bootstrap);
router.post('/auth/login', controller.login);
router.post('/auth/refresh', controller.refresh);
router.post('/auth/forgot-password', controller.forgotPassword);
router.use(platformAuth);
router.post('/auth/change-password', controller.changePassword);
router.get('/overview', controller.overview);
router.get('/tenants', controller.listTenants);
router.post('/tenants', controller.createTenant);
router.patch('/tenants/:id/configuration', controller.updateTenantConfiguration);
router.patch('/tenants/:id', controller.updateTenant);
router.patch('/tenants/:id/features', controller.updateFeatures);
router.get('/audit-logs', controller.listAuditLogs);
router.get('/admins', controller.listAdmins);
router.post('/admins', controller.inviteAdmin);
router.patch('/admins/:id/status', controller.setAdminActive);

module.exports = router;
