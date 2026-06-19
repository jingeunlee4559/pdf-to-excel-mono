const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { signAccessToken } = require('../utils/jwt');
const { toUser } = require('../utils/mapper');

const getUserByLoginId = async (loginId) => {
  const [rows] = await pool.query(
    `SELECT u.*, r.role_code, r.role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.login_id = ?`,
    [loginId]
  );
  return rows[0];
};

const login = asyncHandler(async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ message: '아이디와 비밀번호를 입력하세요.' });

  const row = await getUserByLoginId(loginId);
  if (!row || row.status !== 'ACTIVE') return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);

  const user = toUser(row);
  const accessToken = signAccessToken({ userId: user.id, roleCode: user.roleCode });
  res.json({ user, accessToken });
});

const register = asyncHandler(async (req, res) => {
  const { loginId, password, userName, email, phone, departmentName, positionName } = req.body;
  if (!loginId || !password || !userName) return res.status(400).json({ message: '아이디, 비밀번호, 이름은 필수입니다.' });

  const exists = await getUserByLoginId(loginId);
  if (exists) return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });

  const [[role]] = await pool.query("SELECT id FROM roles WHERE role_code = 'GENERAL_USER'");
  if (!role) return res.status(500).json({ message: '일반 사용자 권한이 DB에 없습니다. 초기화 SQL을 먼저 실행하세요.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `INSERT INTO users (role_id, login_id, password_hash, user_name, email, phone, department_name, position_name, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [role.id, loginId, passwordHash, userName, email || null, phone || null, departmentName || '공사팀', positionName || '사용자']
  );

  res.status(201).json({ id: result.insertId, message: '회원가입이 완료되었습니다.' });
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

module.exports = { login, register, me };
