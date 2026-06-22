
const express = require('express');
const {
  createJob,
  listJobs,
  getJob,
  updateTable,
  revalidateJob,
  generateExcel,
  downloadExcel,
  listDownloads,
  listChatSessions,
  createChatSession,
  getChatSession,
  aiChat
} = require('../controllers/documentJobController');
const { authenticate } = require('../middleware/authMiddleware');
const { documentUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();
router.get('/downloads', authenticate, listDownloads);
router.get('/chats', authenticate, listChatSessions);
router.post('/chats', authenticate, createChatSession);
router.get('/chats/:sessionId', authenticate, getChatSession);
router.post('/chat', authenticate, aiChat);
router.get('/', authenticate, listJobs);
router.post('/', authenticate, documentUpload.array('files', 20), createJob);
router.get('/:id', authenticate, getJob);
router.put('/:id/table', authenticate, updateTable);
router.post('/:id/revalidate', authenticate, revalidateJob);
router.post('/:id/excels', authenticate, generateExcel);
router.get('/:id/excels/:excelId/download', downloadExcel);

module.exports = router;
