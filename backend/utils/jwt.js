const jwt = require('jsonwebtoken');

const signAccessToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret', { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');

module.exports = { signAccessToken, verifyToken };
