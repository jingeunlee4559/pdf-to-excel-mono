const pool = require('../config/db');
const bcrypt = require('bcryptjs');
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

const listRoles = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM roles WHERE active_yn = 'Y' ORDER BY id`);
  res.json({ roles: rows.map((r) => ({ id: r.id, roleCode: r.role_code, roleName: r.role_name })) });
});

const getUser = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*, r.role_code, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  res.json({ user: toUser(rows[0]) });
});

const createUser = asyncHandler(async (req, res) => {
  const { loginId, password, userName, email, phone, departmentName, positionName, roleId } = req.body;
  if (!loginId || !password || !userName || !roleId) {
    return res.status(400).json({ error: '아이디, 비밀번호, 이름, 권한은 필수입니다.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const [result] = await pool.query(
      `INSERT INTO users (role_id, login_id, password_hash, user_name, email, phone, department_name, position_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [roleId, loginId, passwordHash, userName, email || null, phone || null, departmentName || null, positionName || null]
    );
    res.status(201).json({ id: result.insertId, message: '사용자가 생성되었습니다.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
    throw err;
  }
});

const updateUser = asyncHandler(async (req, res) => {
  const { userName, email, phone, departmentName, positionName, roleId, status, password } = req.body;
  const updates = [];
  const params = [];
  if (userName !== undefined) { updates.push('user_name = ?'); params.push(userName); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
  if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
  if (departmentName !== undefined) { updates.push('department_name = ?'); params.push(departmentName || null); }
  if (positionName !== undefined) { updates.push('position_name = ?'); params.push(positionName || null); }
  if (roleId !== undefined) { updates.push('role_id = ?'); params.push(roleId); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (password) { const hash = await bcrypt.hash(password, 10); updates.push('password_hash = ?'); params.push(hash); }
  if (!updates.length) return res.status(400).json({ error: '변경할 내용이 없습니다.' });
  params.push(req.params.id);
  await pool.query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  res.json({ message: '사용자 정보가 업데이트되었습니다.' });
});

const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.user?.id) === String(req.params.id)) {
    return res.status(400).json({ error: '자기 자신은 삭제할 수 없습니다.' });
  }
  await pool.query(`UPDATE users SET status = 'INACTIVE', updated_at = NOW() WHERE id = ?`, [req.params.id]);
  res.json({ message: '사용자가 비활성화되었습니다.' });
});

module.exports = { listUsers, listRoles, getUser, createUser, updateUser, deleteUser };
