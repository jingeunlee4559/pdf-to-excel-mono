const express = require('express');
const { listUsers, listRoles, getUser, createUser, updateUser, deleteUser } = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authenticate, authorize('SYSTEM_ADMIN'));

router.get('/roles', listRoles);
router.get('/', listUsers);
router.get('/:id', getUser);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
