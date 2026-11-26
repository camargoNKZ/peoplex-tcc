const express = require('express');
const auth = require('../middlewares/auth');
const feature = require('../middlewares/feature');
const upload = require('../config/upload');
const controller = require('../controllers/messagesController');

const router = express.Router();
router.use(auth);
router.use(feature('messaging'));
router.get('/conversations', controller.listConversations);
router.post('/conversations', controller.createConversation);
router.post('/attachments', upload.single('file'), controller.uploadAttachment);
router.delete('/attachments', controller.deleteAttachment);
router.get('/conversations/:id', controller.getMessages);
router.post('/conversations/:id/messages', controller.sendMessage);
router.post('/conversations/:id/read', controller.markRead);

module.exports = router;
