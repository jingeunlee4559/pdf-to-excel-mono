const axios = require('axios');
const FormData = require('form-data');
const { repairMojibakeFilename } = require('../middleware/uploadMiddleware');

function aiBaseUrl() {
  return (process.env.AI_SERVER_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

function appendUploadFile(form, fieldName, file) {
  if (!file) return;
  if (file.buffer) {
    form.append(fieldName, file.buffer, {
      filename: repairMojibakeFilename(file.originalname || file.filename || 'upload.bin'),
      contentType: file.mimetype || 'application/octet-stream',
      knownLength: file.size || file.buffer.length
    });
    return;
  }
  throw new Error('업로드 파일 버퍼가 없습니다. multer memoryStorage 설정을 확인하세요.');
}

async function postForm(path, form, timeout = 120000) {
  const { data } = await axios.post(`${aiBaseUrl()}${path}`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout
  });
  return data;
}

async function postJson(path, payload, timeout = 120000) {
  const { data } = await axios.post(`${aiBaseUrl()}${path}`, payload, { timeout });
  return data;
}

async function uploadFileToAiServer(file, uploadType = 'documents') {
  const form = new FormData();
  form.append('upload_type', uploadType);
  appendUploadFile(form, 'file', file);
  return postForm('/api/storage/upload', form, 120000);
}

async function analyzeWithAiServer({ files, userRequest, outputMode, templateId }) {
  const form = new FormData();
  form.append('user_request', userRequest || '문서를 분석해서 표로 만들어줘');
  form.append('output_mode', outputMode || 'FREE_FORM');
  if (templateId) form.append('template_id', String(templateId));
  for (const file of files || []) appendUploadFile(form, 'files', file);
  return postForm('/api/analyze', form, Number(process.env.AI_ANALYZE_TIMEOUT_MS || 300000));
}

async function chatWithAiServer({ message, context }) {
  return postJson('/api/chat', { message: message || '', context: context || {} }, Number(process.env.AI_CHAT_TIMEOUT_MS || 120000));
}

async function designTemplateWithAiServer({ userRequest, analysis, columns, rows, standardFields, layoutRegistry }) {
  return postJson('/api/template/design', {
    user_request: userRequest || '',
    analysis: analysis || {},
    columns: columns || [],
    rows: rows || [],
    standard_fields: standardFields || [],
    layout_registry: layoutRegistry || []
  }, Number(process.env.AI_TEMPLATE_DESIGN_TIMEOUT_MS || 120000));
}

async function getExcelPreview({ filePath, sheetName, maxRows = 80, maxCols = 26 }) {
  const { data } = await axios.post(
    `${aiBaseUrl()}/api/excel/preview`,
    { file_path: filePath, sheet_name: sheetName || null, max_rows: maxRows, max_cols: maxCols },
    { timeout: 120000 }
  );
  return data;
}

async function generateExcelWithAiServer({ jobId, fileName, outputMode, template, mappings, mappingJson, columns, rows, job, authorName, templateLayoutMode, designId }) {
  return postJson('/api/excel/generate', {
    job_id: jobId,
    file_name: fileName || null,
    output_mode: outputMode || 'FREE_FORM',
    template: template || null,
    mappings: mappings || [],
    mapping_json: mappingJson || {},
    columns: columns || [],
    rows: rows || [],
    job: job || {},
    author_name: authorName || '',
    template_layout_mode: templateLayoutMode || 'COMPACT_VENDOR_GROUPS',
    design_id: designId || null,
  }, Number(process.env.AI_EXCEL_GENERATE_TIMEOUT_MS || 180000));
}

async function createTemplateSkeletonWithAiServer({ design, fileName }) {
  return postJson('/api/template/skeleton', { design: design || {}, file_name: fileName || null }, Number(process.env.AI_TEMPLATE_SKELETON_TIMEOUT_MS || 120000));
}

module.exports = { uploadFileToAiServer, analyzeWithAiServer, chatWithAiServer, designTemplateWithAiServer, generateExcelWithAiServer, createTemplateSkeletonWithAiServer, getExcelPreview };
