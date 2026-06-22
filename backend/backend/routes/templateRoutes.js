const express = require('express');
const {
  listTemplates,
  createTemplate,
  getTemplatePreview,
  getTemplateMappings,
  saveTemplateMappings
} = require('../controllers/templateController');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { templateUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();
router.get('/', authenticate, listTemplates);
router.post('/', authenticate, authorize('SYSTEM_ADMIN'), templateUpload.single('file'), createTemplate);
router.get('/:id/preview', authenticate, getTemplatePreview);
router.get('/:id/mappings', authenticate, getTemplateMappings);
router.put('/:id/mappings', authenticate, authorize('SYSTEM_ADMIN'), saveTemplateMappings);

module.exports = router;
