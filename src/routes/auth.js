// src/routes/auth.js
const express = require('express');
const router  = express.Router();
router.post('/login', require('../controllers/authController').login);
router.post('/refresh', require('../controllers/authController').refresh);
router.post('/forgot-password', require('../controllers/authController').forgotPassword);
router.get('/my-companies', require('../controllers/authController').myCompanies);
router.get('/public-config', require('../controllers/authController').publicConfig);
module.exports = router;
