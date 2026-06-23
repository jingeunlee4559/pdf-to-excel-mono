
const express = require('express');
const {
  createJob,
  listJobs,
  getJob,
  updateTable,
  revalidateJob,
  createAiTemplate,
  updateCandidateField,
  generateExcel,
  downloadExcel,
  listDownloads,
  listChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  aiChat
} = require('../controllers/documentJobController');
const { authenticate } = require('../middleware/authMiddleware');
const { documentUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();
router.get('/downloads', authenticate, listDownloads);
router.get('/chats', authenticate, listChatSessions);
router.post('/chats', authenticate, createChatSession);
router.get('/chats/:sessionId', authenticate, getChatSession);
router.delete('/chats/:sessionId', authenticate, deleteChatSession);
router.post('/chat', authenticate, aiChat);
router.get('/', authenticate, listJobs);
router.post('/', authenticate, documentUpload.array('files', 20), createJob);
router.get('/:id', authenticate, getJob);
router.put('/:id/table', authenticate, updateTable);
router.post('/:id/revalidate', authenticate, revalidateJob);
router.post('/:id/ai-template', authenticate, createAiTemplate);
router.post('/:id/candidate-fields/:fieldId', authenticate, updateCandidateField);
router.post('/:id/excels', authenticate, generateExcel);
router.get('/:id/excels/:excelId/download', downloadExcel);

module.exports = router;
