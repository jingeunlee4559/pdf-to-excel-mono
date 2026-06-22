const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { toUser } = require('../utils/mapper');

const listUsers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*, r.role_code, r.role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      ORDER BY u.created_at DESC`
  );
  res.json({ users: rows.map(toUser) });
});

module.exports = { listUsers };
