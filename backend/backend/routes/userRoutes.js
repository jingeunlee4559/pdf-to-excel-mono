const express = require('express');
const { listUsers } = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/', authenticate, authorize('SYSTEM_ADMIN'), listUsers);

module.exports = router;
