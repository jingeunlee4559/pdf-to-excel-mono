const pool = require('../config/db');
const { verifyToken } = require('../utils/jwt');
const { toUser } = require('../utils/mapper');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: '인증 토큰이 없습니다.' });

    const decoded = verifyToken(token);
    const [rows] = await pool.query(
      `SELECT u.*, r.role_code, r.role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = ? AND u.status = 'ACTIVE'`,
      [decoded.userId]
    );
    if (!rows.length) return res.status(401).json({ message: '사용자를 찾을 수 없습니다.' });
    req.user = toUser(rows[0]);
    next();
  } catch (error) {
    return res.status(401).json({ message: '유효하지 않은 인증 토큰입니다.' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: '인증이 필요합니다.' });
    if (!roles.includes(req.user.roleCode)) return res.status(403).json({ message: '접근 권한이 없습니다.' });
    next();
  };
}

module.exports = { authenticate, authorize };
