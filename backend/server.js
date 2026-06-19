require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const templateRoutes = require('./routes/templateRoutes');
const documentJobRoutes = require('./routes/documentJobRoutes');
const referenceRoutes = require('./routes/referenceRoutes');
const errorMiddleware = require('./middleware/errorMiddleware');

const app = express();
const PORT = Number(process.env.PORT || 8080);

const allowedOrigins = String(
  process.env.FRONTEND_ORIGIN || 'http://localhost:3000,http://localhost:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS 차단: 허용되지 않은 origin입니다. origin=${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'document-automation-backend',
    port: PORT,
    aiServerUrl: process.env.AI_SERVER_URL || 'http://127.0.0.1:8000',
    storagePolicy: 'backend-memory-to-ai-server-storage',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/document-jobs', documentJobRoutes);
app.use('/api/references', referenceRoutes);

// 원본 PDF/엑셀 파일은 backend/uploads에 저장하지 않습니다.
// backend는 multer memoryStorage로 받은 파일을 ai-server로 전달하고,
// ai-server/app/storage/documents 또는 ai-server/app/storage/templates에 저장합니다.

app.use((req, res) => {
  res.status(404).json({
    message: '존재하지 않는 API 경로입니다.',
    method: req.method,
    path: req.originalUrl,
  });
});

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`[backend] running on http://localhost:${PORT}`);
  console.log(`[backend] allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[backend] ai-server: ${process.env.AI_SERVER_URL || 'http://127.0.0.1:8000'}`);
});
