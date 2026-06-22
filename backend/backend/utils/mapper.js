function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    loginId: row.login_id,
    userName: row.user_name,
    email: row.email,
    phone: row.phone,
    departmentName: row.department_name,
    positionName: row.position_name,
    status: row.status,
    roleCode: row.role_code,
    roleName: row.role_name
  };
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

module.exports = { toUser, parseJson };
