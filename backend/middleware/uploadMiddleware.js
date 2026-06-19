const multer = require('multer');

const allowedDocumentMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

function fileFilter(req, file, cb) {
  const name = String(file.originalname || '').toLowerCase();
  const allowedByExt = /\.(pdf|xlsx|xlsm|xls|csv|txt|docx)$/i.test(name);
  const allowedByMime = allowedDocumentMimeTypes.has(file.mimetype);

  if (allowedByExt || allowedByMime) return cb(null, true);
  cb(new Error('PDF, 엑셀, CSV, TXT, DOCX 파일만 업로드할 수 있습니다.'));
}

const documentUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 20 }
});

const templateUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (/\.(xlsx|xlsm)$/i.test(name)) return cb(null, true);
    cb(new Error('엑셀 미리보기는 xlsx, xlsm 템플릿 파일만 지원합니다.'));
  },
  limits: { fileSize: 30 * 1024 * 1024, files: 1 }
});

module.exports = { documentUpload, templateUpload };
