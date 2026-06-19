const express = require('express');
const { createJob, listJobs, getJob, updateTable, revalidateJob, generateExcel, downloadExcel, aiChat } = require('../controllers/documentJobController');
const { authenticate } = require('../middleware/authMiddleware');
const { documentUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();
router.get('/', authenticate, listJobs);
router.post('/', authenticate, documentUpload.array('files', 20), createJob);
router.post('/chat', authenticate, aiChat);
router.get('/:id', authenticate, getJob);
router.put('/:id/table', authenticate, updateTable);
router.post('/:id/revalidate', authenticate, revalidateJob);
router.post('/:id/excels', authenticate, generateExcel);
router.get('/:id/excels/:excelId/download', downloadExcel);

module.exports = router;
