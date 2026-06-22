const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { listStandardFields } = require('../controllers/referenceController');

const router = express.Router();
router.get('/standard-fields', authenticate, listStandardFields);

module.exports = router;
