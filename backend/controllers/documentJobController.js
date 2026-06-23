
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { parseJson } = require('../utils/mapper');
const { analyzeDocuments, validateTable, defaultColumns, columnsForTableType, pruneEmptyColumns, chatWithDocuments } = require('../services/analysisService');
const { createExcelFile, createMappedTemplateExcel } = require('../services/excelService');
const { verifyToken } = require('../utils/jwt');


const DOCUMENT_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'documents');
const ANALYSIS_CONCURRENCY = Math.max(1, Number(process.env.DOCUMENT_JOB_CONCURRENCY || 2));
const analysisQueue = [];
const queuedOrRunningJobIds = new Set();
let activeAnalysisCount = 0;

function ensureDocumentUploadDir() {
  fs.mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });
}

function sanitizeStoredFileName(name) {
  const safe = String(name || 'upload.bin')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (safe || 'upload.bin').slice(0, 180);
}

function saveUploadFileForBackground(file) {
  if (!file?.buffer) throw new Error('업로드 파일 버퍼가 없습니다. multer memoryStorage 설정을 확인하세요.');
  ensureDocumentUploadDir();
  const originalName = String(file.originalname || file.filename || 'upload.bin').trim() || 'upload.bin';
  const storedName = `${Date.now()}_${crypto.randomUUID()}_${sanitizeStoredFileName(originalName)}`;
  const filePath = path.join(DOCUMENT_UPLOAD_DIR, storedName);
  fs.writeFileSync(filePath, file.buffer);
  return {
    ...file,
    originalname: originalName,
    storedName,
    filePath,
    fileType: path.extname(originalName).replace('.', '').toLowerCase(),
    size: file.size || file.buffer.length,
  };
}

async function loadUserForBackground(userId) {
  const [[row]] = await pool.query(
    `SELECT u.id, r.role_code AS roleCode
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [userId]
  );
  return row ? { id: row.id, roleCode: row.roleCode } : { id: userId, roleCode: 'GENERAL_USER' };
}

async function loadFilesForBackgroundAnalysis(jobId) {
  const [rows] = await pool.query('SELECT * FROM source_files WHERE job_id = ? ORDER BY id', [jobId]);
  const files = [];
  for (const row of rows) {
    if (!row.file_path || !fs.existsSync(row.file_path)) {
      throw new Error(`분석할 원본 파일을 찾을 수 없습니다: ${row.original_name || row.stored_name || row.id}`);
    }
    const buffer = fs.readFileSync(row.file_path);
    files.push({
      originalname: row.original_name || row.stored_name || `file_${row.id}`,
      mimetype: row.mime_type || 'application/octet-stream',
      size: row.file_size || buffer.length,
      buffer,
      sourceFileId: row.id,
      storedName: row.stored_name || '',
      savedPath: row.file_path || '',
      fileType: row.file_type || path.extname(row.original_name || '').replace('.', '').toLowerCase(),
    });
  }
  return files;
}

function enqueueDocumentAnalysis(jobId, sessionId = null) {
  const key = Number(jobId);
  if (!Number.isFinite(key) || key <= 0) return;
  if (queuedOrRunningJobIds.has(key)) return;
  queuedOrRunningJobIds.add(key);
  analysisQueue.push({ jobId: key, sessionId: sessionId || null });
  setImmediate(drainAnalysisQueue);
}

function drainAnalysisQueue() {
  while (activeAnalysisCount < ANALYSIS_CONCURRENCY && analysisQueue.length > 0) {
    const task = analysisQueue.shift();
    activeAnalysisCount += 1;
    runDocumentAnalysisJob(task)
      .catch((error) => {
        console.error(`[DOC_JOB][BACKGROUND_FAILED] jobId=${task.jobId}`, error);
      })
      .finally(() => {
        activeAnalysisCount -= 1;
        queuedOrRunningJobIds.delete(Number(task.jobId));
        setImmediate(drainAnalysisQueue);
      });
  }
}

async function resumeQueuedDocumentJobs() {
  const [rows] = await pool.query(
    `SELECT j.id AS job_id, s.id AS session_id
       FROM document_jobs j
       LEFT JOIN document_chat_sessions s ON s.active_job_id = j.id
      WHERE j.status IN ('QUEUED', 'PROCESSING')
      ORDER BY j.created_at ASC
      LIMIT 50`
  );
  rows.forEach((row) => enqueueDocumentAnalysis(row.job_id, row.session_id || null));
  if (rows.length) console.info(`[DOC_JOB][RESUME] queued=${rows.length} concurrency=${ANALYSIS_CONCURRENCY}`);
}

function canReadJob(user, job) {
  return user.roleCode === 'SYSTEM_ADMIN' || Number(job.user_id) === Number(user.id);
}

function normalizeExtractedPages(payload) {
  const parsed = Array.isArray(payload) || (payload && typeof payload === 'object') ? payload : [];
  if (Array.isArray(parsed)) return { pages: parsed, logs: [], metrics: {} };
  return {
    pages: Array.isArray(parsed.pages) ? parsed.pages : [],
    logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    metrics: parsed.metrics && typeof parsed.metrics === 'object' ? parsed.metrics : {}
  };
}

function mapChatMessage(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    jobId: row.job_id,
    role: String(row.role || '').toLowerCase(),
    content: row.message_text,
    payload: parseJson(row.payload_json, {}),
    action: row.action,
    llmModel: row.llm_model,
    createdAt: row.created_at,
  };
}

async function loadJob(jobId, user) {
  const [[job]] = await pool.query('SELECT * FROM document_jobs WHERE id = ?', [jobId]);
  if (!job) return null;
  if (!canReadJob(user, job)) return null;

  const [files] = await pool.query('SELECT * FROM source_files WHERE job_id = ? ORDER BY id', [jobId]);
  const [[analysis]] = await pool.query('SELECT * FROM document_analysis_results WHERE job_id = ? ORDER BY id DESC LIMIT 1', [jobId]);
  const [tables] = await pool.query('SELECT * FROM extracted_tables WHERE job_id = ? ORDER BY id', [jobId]);
  const [issues] = await pool.query('SELECT * FROM review_issues WHERE job_id = ? ORDER BY id', [jobId]);
  const [excels] = await pool.query('SELECT * FROM generated_excels WHERE job_id = ? ORDER BY id DESC', [jobId]);

  return {
    id: job.id,
    title: job.title,
    userRequest: job.user_request,
    outputMode: job.output_mode,
    templateId: job.template_id,
    status: job.status,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    files: files.map((file) => {
      const extractedPayload = normalizeExtractedPages(parseJson(file.extracted_pages_json, []));
      return {
        id: file.id,
        originalName: file.original_name,
        name: file.original_name,
        storedName: file.stored_name,
        fileType: file.file_type,
        mimeType: file.mime_type,
        fileSize: file.file_size,
        pageCount: file.page_count,
        parseStatus: file.parse_status,
        extractedText: file.extracted_text,
        extractedPages: extractedPayload.pages,
        parseLogs: [],
        parseMetrics: extractedPayload.metrics
      };
    }),
    analysis: analysis ? (() => {
      const rawAnalysis = parseJson(analysis.analysis_json, {});
      return {
        id: analysis.id,
        documentType: analysis.document_type,
        recommendedTableType: analysis.recommended_table_type,
        purpose: analysis.document_purpose,
        summary: analysis.summary,
        confidence: Number(analysis.confidence || 0),
        needsReviewYn: analysis.needs_review_yn,
        reviewSummary: analysis.review_summary,
        keyValues: rawAnalysis.keyValues || [],
        fileProfiles: rawAnalysis.fileProfiles || [],
        llmUsage: rawAnalysis.llmUsage || null,
        llmUsed: rawAnalysis.llmUsed || false,
        llmIntentUsed: rawAnalysis.llmIntentUsed || false,
        llmIntent: rawAnalysis.llmIntent || null,
        llmModel: analysis.llm_model,
        promptVersion: analysis.prompt_version,
        raw: rawAnalysis
      };
    })() : null,
    tables: tables.map((table) => ({
      id: table.id,
      tableName: table.table_name,
      tableType: table.table_type,
      columns: parseJson(table.columns_json, columnsForTableType(table.table_type)),
      rows: parseJson(table.rows_json, []),
      tableJson: parseJson(table.table_json, {}),
      rowCount: table.row_count,
      status: table.status
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      tableId: issue.table_id,
      rowIndex: issue.row_index,
      targetKey: issue.target_key,
      targetName: issue.target_name,
      fieldKey: issue.field_key,
      fieldLabel: issue.field_label,
      issueType: issue.issue_type,
      severity: issue.severity,
      message: issue.message,
      suggestedValue: issue.suggested_value,
      resolvedYn: issue.resolved_yn
    })),
    excels: excels.map((excel) => ({
      id: excel.id,
      templateId: excel.template_id,
      sourceSessionId: excel.source_session_id,
      sourceMessageId: excel.source_message_id,
      fileName: excel.file_name,
      generatedStatus: excel.generated_status,
      downloadedYn: excel.downloaded_yn,
      createdAt: excel.created_at,
      downloadedAt: excel.downloaded_at,
    }))
  };
}

async function replaceIssues(conn, jobId, tableId, issues) {
  await conn.query('DELETE FROM review_issues WHERE job_id = ?', [jobId]);
  for (const issue of issues || []) {
    await conn.query(
      `INSERT INTO review_issues (job_id, table_id, row_index, target_key, target_name, field_key, field_label, issue_type, severity, message, suggested_value, resolved_yn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
      [jobId, tableId || null, issue.rowIndex ?? null, issue.targetKey || null, issue.targetName || null, issue.fieldKey || null, issue.fieldLabel || null, issue.issueType || 'CHECK_REQUIRED', issue.severity || 'WARNING', issue.message || '확인이 필요합니다.', issue.suggestedValue || null]
    );
  }
}

async function ensureChatSession(user, sessionId, title = '새 문서 작업', jobId = null) {
  if (sessionId) {
    const [[session]] = await pool.query('SELECT * FROM document_chat_sessions WHERE id = ?', [sessionId]);
    if (session && (user.roleCode === 'SYSTEM_ADMIN' || Number(session.user_id) === Number(user.id))) {
      if (jobId && Number(session.active_job_id || 0) !== Number(jobId)) {
        await pool.query('UPDATE document_chat_sessions SET active_job_id = ?, updated_at = NOW() WHERE id = ?', [jobId, session.id]);
      }
      return session.id;
    }
  }
  const [result] = await pool.query(
    `INSERT INTO document_chat_sessions (user_id, active_job_id, title, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [user.id, jobId || null, title || '새 문서 작업']
  );
  return result.insertId;
}

async function loadPreviousAnalysisFilesForSession(user, chatSessionId, newFiles = []) {
  if (!chatSessionId) return { activeJobId: null, files: [] };
  const [[session]] = await pool.query('SELECT * FROM document_chat_sessions WHERE id = ?', [chatSessionId]);
  if (!session || !(user.roleCode === 'SYSTEM_ADMIN' || Number(session.user_id) === Number(user.id))) {
    return { activeJobId: null, files: [] };
  }
  const activeJobId = session.active_job_id || null;
  if (!activeJobId) return { activeJobId: null, files: [] };

  const [[job]] = await pool.query('SELECT * FROM document_jobs WHERE id = ?', [activeJobId]);
  if (!job || !canReadJob(user, job)) return { activeJobId: null, files: [] };

  const newKeys = new Set((newFiles || []).map((file) => `${file.originalname || ''}__${file.size || 0}`));
  const [rows] = await pool.query(
    `SELECT * FROM source_files
      WHERE job_id = ?
        AND COALESCE(file_path, '') <> ''
      ORDER BY id`,
    [activeJobId]
  );

  const files = [];
  for (const row of rows) {
    const key = `${row.original_name || ''}__${row.file_size || 0}`;
    if (newKeys.has(key)) continue;
    if (!row.file_path || !fs.existsSync(row.file_path)) continue;
    const buffer = fs.readFileSync(row.file_path);
    files.push({
      originalname: row.original_name || row.stored_name || `previous_${row.id}`,
      mimetype: row.mime_type || 'application/octet-stream',
      size: row.file_size || buffer.length,
      buffer,
      fromPreviousJobId: activeJobId,
      previousSourceFileId: row.id,
      existingFilePath: row.file_path,
      existingStoredName: row.stored_name || '',
      existingFileType: row.file_type || ''
    });
  }
  return { activeJobId, files };
}

async function appendChatMessage({ sessionId, jobId = null, role, text, payload = {}, action = null, llmModel = null }) {
  const [result] = await pool.query(
    `INSERT INTO document_chat_messages (session_id, job_id, role, message_text, payload_json, action, llm_model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, jobId || null, String(role || 'assistant').toUpperCase(), text || '', JSON.stringify(payload || {}), action || null, llmModel || null]
  );
  await pool.query('UPDATE document_chat_sessions SET updated_at = NOW(), active_job_id = COALESCE(?, active_job_id) WHERE id = ?', [jobId || null, sessionId]);
  return result.insertId;
}

async function loadChatSession(sessionId, user) {
  const [[session]] = await pool.query(
    `SELECT s.*, j.title AS job_title, j.status AS job_status
       FROM document_chat_sessions s
       LEFT JOIN document_jobs j ON j.id = s.active_job_id
      WHERE s.id = ?`,
    [sessionId]
  );
  if (!session || !(user.roleCode === 'SYSTEM_ADMIN' || Number(session.user_id) === Number(user.id))) return null;

  const [messages] = await pool.query('SELECT * FROM document_chat_messages WHERE session_id = ? ORDER BY id', [sessionId]);
  const activeJob = session.active_job_id ? await loadJob(session.active_job_id, user) : null;
  return {
    id: session.id,
    title: session.title || session.job_title || '문서 작업 채팅',
    activeJobId: session.active_job_id,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messages: messages.map(mapChatMessage),
    activeJob,
  };
}

function buildServerChatContext(job, selectedTableId = null, requestContext = {}) {
  const selectedTable = selectedTableId
    ? (job?.tables || []).find((item) => Number(item.id) === Number(selectedTableId))
    : (job?.tables || [])[0];
  return {
    ...(requestContext || {}),
    hasDocument: Boolean(job?.id),
    hasJob: Boolean(job?.id),
    jobId: job?.id || null,
    documentState: job?.id ? 'ANALYZED' : 'NO_FILE',
    files: (job?.files || []).map((file) => ({ id: file.id, name: file.originalName, pageCount: file.pageCount, fileSize: file.fileSize })),
    analysis: job?.analysis ? {
      documentType: job.analysis.documentType,
      purpose: job.analysis.purpose,
      summary: job.analysis.summary,
      confidence: job.analysis.confidence,
      tableCount: job.tables?.length || 0,
      issueCount: job.issues?.length || 0,
      keyValues: job.analysis.keyValues || [],
      fileProfiles: job.analysis.fileProfiles || job.analysis.raw?.fileProfiles || [],
      llmUsage: job.analysis.llmUsage || job.analysis.raw?.llmUsage || null,
      llmUsed: job.analysis.llmUsed || job.analysis.raw?.llmUsed || false,
      llmIntentUsed: job.analysis.llmIntentUsed || job.analysis.raw?.llmIntentUsed || false
    } : null,
    table: selectedTable ? {
      id: selectedTable.id,
      tableName: selectedTable.tableName,
      tableType: selectedTable.tableType,
      columns: selectedTable.columns || defaultColumns,
      rows: (selectedTable.rows || []).slice(0, 120),
      rowCount: (selectedTable.rows || []).length,
    } : null,
    issues: (job?.issues || []).slice(0, 100),
    generatedExcels: (job?.excels || []).slice(0, 20),
  };
}

const COLUMN_DEFINITIONS = {
  construction_code: { key: 'construction_code', label: '공종코드' },
  vendor_name: { key: 'vendor_name', label: '업체명' },
  item_name: { key: 'item_name', label: '공종명칭' },
  spec: { key: 'spec', label: '규격' },
  quantity: { key: 'quantity', label: '수량' },
  unit: { key: 'unit', label: '단위' },
  unit_price: { key: 'unit_price', label: '단가' },
  standard_unit_price: { key: 'standard_unit_price', label: '표준단가' },
  vendor_unit_price: { key: 'vendor_unit_price', label: '업체 견적단가' },
  price_diff: { key: 'price_diff', label: '차이금액' },
  diff_rate: { key: 'diff_rate', label: '대비율' },
  amount: { key: 'amount', label: '금액' },
  labor_ratio: { key: 'labor_ratio', label: '노무비율' },
  remark: { key: 'remark', label: '비고' },
};

const STANDARD_MARKET_COLUMN_ORDER = ['construction_code', 'item_name', 'spec', 'unit', 'unit_price', 'labor_ratio', 'remark'];
const NORMAL_COLUMN_ORDER = ['vendor_name', 'item_name', 'spec', 'quantity', 'unit', 'standard_unit_price', 'vendor_unit_price', 'unit_price', 'price_diff', 'diff_rate', 'amount', 'remark'];

const COLUMN_ALIASES = {
  construction_code: ['공종코드', '공종 코드', '코드', 'construction_code', 'construction code'],
  item_name: ['공종명칭', '공종 명칭', '품목명', '품목', '항목명', '내역명', 'item_name', 'item name'],
  spec: ['규격', 'spec', '사양'],
  unit: ['단위', 'unit'],
  quantity: ['수량', 'quantity'],
  unit_price: ['단가', 'unit_price', 'unit price', '가격'],
  standard_unit_price: ['표준단가', '기준단가', '시장단가', 'standard_unit_price'],
  vendor_unit_price: ['견적단가', '업체단가', '제안단가', 'vendor_unit_price', '견적가'],
  price_diff: ['차이', '차액', '증감', 'price_diff'],
  diff_rate: ['대비', '비율', '율', 'diff_rate'],
  amount: ['금액', 'amount'],
  labor_ratio: ['노무비율', '노무 비율', '노무율', '노무', 'labor_ratio', 'labor ratio'],
  remark: ['비고', 'remark', '메모', '참고사항'],
  vendor_name: ['업체명', '회사명', 'vendor_name', 'vendor name'],
};

function preferredColumnOrder(tableType) {
  if (tableType === 'STANDARD_MARKET_PRICE_TABLE') return STANDARD_MARKET_COLUMN_ORDER;
  return NORMAL_COLUMN_ORDER;
}

function uniqueColumns(columns = []) {
  const seen = new Set();
  const out = [];
  for (const col of columns || []) {
    if (!col?.key || seen.has(col.key)) continue;
    seen.add(col.key);
    out.push({ key: col.key, label: col.label || COLUMN_DEFINITIONS[col.key]?.label || col.key });
  }
  return out;
}

function isSummaryCompareColumnKey(key = '') {
  return ['lowest_vendor', 'lowest_unit_price', 'lowest_amount', 'lowest_vs_standard', 'remark'].includes(String(key || ''));
}

function isBaseCompareColumnKey(key = '') {
  return ['construction_code', 'item_name', 'spec', 'quantity', 'request_quantity', 'unit', 'standard_unit_price'].includes(String(key || ''));
}

function sortColumnsForTable(columns = [], tableType = '') {
  const cols = uniqueColumns(columns);
  const order = preferredColumnOrder(tableType);
  const baseOrder = ['construction_code', 'item_name', 'spec', 'quantity', 'request_quantity', 'unit', 'standard_unit_price'];
  const summaryOrder = ['lowest_vendor', 'lowest_unit_price', 'lowest_amount', 'lowest_vs_standard', 'remark'];
  const originalIndex = new Map(cols.map((col, index) => [col.key, index]));

  const rank = (key) => {
    const baseIdx = baseOrder.indexOf(key);
    if (baseIdx >= 0) return baseIdx;

    const normalIdx = order.indexOf(key);
    if (normalIdx >= 0 && !isSummaryCompareColumnKey(key)) return 50 + normalIdx;

    // 업체 단가/금액처럼 동적으로 생성된 컬럼은 항상 최저 업체/최저 금액 앞에 둔다.
    if (!isSummaryCompareColumnKey(key)) return 200 + (originalIndex.get(key) ?? 0);

    const summaryIdx = summaryOrder.indexOf(key);
    return 10000 + (summaryIdx >= 0 ? summaryIdx : 100);
  };

  return cols.sort((a, b) => {
    const diff = rank(a.key) - rank(b.key);
    if (diff) return diff;
    return (originalIndex.get(a.key) ?? 0) - (originalIndex.get(b.key) ?? 0);
  });
}

function findColumnKeysInMessage(message, columns = null) {
  const text = String(message || '').toLowerCase().replace(/\s+/g, ' ');
  const candidateKeys = Array.isArray(columns) && columns.length
    ? columns.map((col) => col.key)
    : Object.keys(COLUMN_ALIASES);
  const keys = [];
  for (const key of candidateKeys) {
    const aliases = COLUMN_ALIASES[key] || [key];
    if (aliases.some((alias) => text.includes(String(alias).toLowerCase()))) keys.push(key);
  }
  return [...new Set(keys)];
}

function getAvailableColumnsFromRows(rows = []) {
  const keys = new Set();
  for (const row of rows || []) {
    Object.entries(row || {}).forEach(([key, value]) => {
      if (String(value ?? '').trim() !== '') keys.add(key);
    });
  }
  return Array.from(keys).map((key) => COLUMN_DEFINITIONS[key] || { key, label: key });
}


function compactForSearch(value) {
  return String(value || '')
    .replace(/[\s\u00A0]+/g, '')
    .replace(/[()\[\]{}.,·ㆍ\/\\_"'`~:;|<>-]/g, '')
    .toLowerCase();
}

function getRowSearchText(row = {}) {
  return compactForSearch([
    row.item_name,
    row.construction_code,
    row.spec,
    row.vendor_name,
    row.remark
  ].filter(Boolean).join(' '));
}

function getRowIdentityKey(row = {}) {
  return compactForSearch([
    row.construction_code,
    row.item_name,
    row.spec,
    row.unit
  ].filter(Boolean).join('|'));
}

function hasExplicitParenthesizedItem(message = '') {
  return /[가-힣A-Za-z0-9·._\/-]{2,}\s*\([^)]{1,30}\)/.test(String(message || ''));
}

function extractRequestedQuantityFromMessage(message = '') {
  const text = String(message || '');
  const patterns = [
    /각\s*(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?\s*씩?/gi,
    /(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)\s*씩/gi,
    /수량\s*[:=]?\s*(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?/gi,
    /(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?\s*(?:기준|으로|만큼|수량)/gi,
    /(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)/gi,
  ];
  const isCompanyCount = (match) => {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    return /^\s*(업체|회사|파일|문서|자료|개사)/.test(after) || /(업체|회사|파일|문서)\s*$/.test(before);
  };
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (isCompanyCount(match)) continue;
      const groups = match.groups || {};
      const value = String(groups.qty || match[1] || '').replace(/,/g, '');
      if (value) return { value, unit: groups.unit || match[2] || '' };
    }
  }
  return { value: '', unit: '' };
}

function ensureColumn(columns = [], key) {
  if ((columns || []).some((col) => col.key === key)) return columns;
  return sortColumnsForTable([...(columns || []), COLUMN_DEFINITIONS[key] || { key, label: key }]);
}

function applyRequestedQuantityToRows(rows = [], quantity, targetRowKeys = null) {
  if (!quantity?.value) return rows;
  const targetSet = Array.isArray(targetRowKeys) && targetRowKeys.length ? new Set(targetRowKeys) : null;
  return (rows || []).map((row) => {
    if (targetSet && !targetSet.has(getRowIdentityKey(row))) return row;
    return { ...row, quantity: quantity.value, request_quantity: quantity.value };
  });
}


function stripCompareAliasPrefix(value = '') {
  return String(value || '')
    .replace(/^\s*[A-Z]\s*회사\s*[·ㆍ:：\-–—]*\s*/i, '')
    .replace(/^\s*[A-Z]\s*회사(?=㈜|\(주\)|주식회사|[가-힣A-Za-z0-9])\s*/i, '')
    .trim();
}

function normalizeVendorLabelForEdit(label = '') {
  return stripCompareAliasPrefix(String(label || '')
    .replace(/\s*(단가|금액|견적가|견적단가|업체견적단가)$/g, '')
    .replace(/\s+/g, ' ')
    .trim());
}

function sanitizeKoreanAssistantText(value = '', fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const cjkCount = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) || []).length;
  const hangulCount = (text.match(/[가-힣]/g) || []).length;
  // qwen이 중국어/일본어로 섞어 답하면 사용자 화면에는 규칙 기반 한국어 답변만 보여준다.
  if (cjkCount >= 2 || (cjkCount >= 1 && hangulCount < 20)) return fallback || text.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g, '').trim();
  return text;
}


function isIgnoredVendorLabelForEdit(label = '') {
  const cleaned = normalizeVendorLabelForEdit(label);
  return !cleaned || /^(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출|공급|세액|금액|단가|업체\d+)$/.test(compactForSearch(cleaned));
}

function getTableMetaVendors(table = {}) {
  const metaVendors = Array.isArray(table?.tableJson?.meta?.vendors) ? table.tableJson.meta.vendors : [];
  return metaVendors
    .map((vendor, index) => {
      const name = String(vendor?.name || vendor?.vendorName || vendor?.label || vendor || '').trim();
      const actualIndex = Number.isFinite(Number(vendor?.index)) ? Number(vendor.index) : index;
      return name ? { ...vendor, name, index: actualIndex, compareKey: compactForSearch(name) } : null;
    })
    .filter(Boolean);
}

function inferVendorColumnsForEdit(table = {}, columnsOverride = null) {
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (table.columns || []);
  const metaVendors = getTableMetaVendors(table);
  const metaByZeroIndex = new Map(metaVendors.map((vendor) => [Number(vendor.index), vendor]));
  const vendors = new Map();
  const put = (name, patch = {}) => {
    const clean = normalizeVendorLabelForEdit(name);
    const key = compactForSearch(clean);
    if (!clean || !key || isIgnoredVendorLabelForEdit(clean)) return null;
    const existing = vendors.get(key) || { name: clean, compareKey: key, columnKeys: [], labels: [], index: vendors.size };
    const next = { ...existing, ...patch, name: existing.name || clean, compareKey: key };
    next.columnKeys = Array.from(new Set([...(existing.columnKeys || []), ...(patch.columnKeys || [])].filter(Boolean)));
    next.labels = Array.from(new Set([...(existing.labels || []), ...(patch.labels || [])].filter(Boolean)));
    vendors.set(key, next);
    return next;
  };

  metaVendors.forEach((vendor) => {
    const keys = [vendor.unitPriceKey, vendor.priceKey, vendor.amountKey, vendor.specKey, vendor.quantityKey, vendor.nameKey].filter(Boolean);
    put(vendor.name, { index: vendor.index, columnKeys: keys, metaVendor: vendor });
  });

  for (const col of columns || []) {
    const key = String(col.key || '');
    const label = String(col.label || key || '').trim();
    const dynamic = key.match(/^(?:vendor|company|target)[_\-]?(\d+)[_\-]?(name|spec|quantity|qty|unit_price|price|amount)$/i);
    if (dynamic) {
      const rawIdx = Number(dynamic[1]);
      const zeroIndex = rawIdx > 0 ? rawIdx - 1 : rawIdx;
      const metaVendor = metaByZeroIndex.get(zeroIndex) || metaByZeroIndex.get(rawIdx);
      const name = metaVendor?.name || normalizeVendorLabelForEdit(label);
      const vendor = put(name, { index: zeroIndex, labels: [label], columnKeys: [key], metaVendor });
      if (vendor && (dynamic[2] || '').toLowerCase().includes('amount')) vendor.amountKey = key;
      if (vendor && /(unit_price|price)/i.test(dynamic[2] || '')) vendor.unitPriceKey = key;
      continue;
    }
    if (/(단가|금액|견적가|견적단가)$/i.test(label)) {
      const name = normalizeVendorLabelForEdit(label);
      const vendor = put(name, { labels: [label], columnKeys: [key] });
      if (vendor && /금액$/.test(label)) vendor.amountKey = key;
      else if (vendor) vendor.unitPriceKey = key;
    }
  }
  return Array.from(vendors.values());
}


function inferVisibleVendorColumnsForEdit(table = {}, columnsOverride = null) {
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (table.columns || []);
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  // 현재 화면에 보이는 업체는 meta.vendors가 아니라 실제 표시 컬럼으로 판단한다.
  // 이전 업데이트 과정에서 meta.vendors가 전체 업체로 남아 있으면 "한국전기 추가" 같은 명령을
  // 이미 표시 중인 업체로 오판하여 컬럼 복구가 실패한다.
  const visibleTable = {
    ...table,
    columns,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...meta,
        vendors: [],
      },
    },
  };
  return inferVendorColumnsForEdit(visibleTable, columns);
}

function mergeVendorsByCompareKey(vendors = []) {
  const byKey = new Map();
  for (const vendor of vendors || []) {
    if (!vendor || !vendor.compareKey) continue;
    const existing = byKey.get(vendor.compareKey) || {};
    byKey.set(vendor.compareKey, {
      ...existing,
      ...vendor,
      columnKeys: Array.from(new Set([...(existing.columnKeys || []), ...(vendor.columnKeys || [])].filter(Boolean))),
      labels: Array.from(new Set([...(existing.labels || []), ...(vendor.labels || [])].filter(Boolean))),
    });
  }
  return Array.from(byKey.values());
}

function vendorSearchKeysForEdit(name = '') {
  const raw = String(name || '').trim();
  const noPrefix = stripCompareAliasPrefix(raw);
  const noCorp = noPrefix.replace(/주식회사|\(주\)|㈜|（주）|유한회사|합자회사|합명회사/g, ' ');
  const pieces = [raw, noPrefix, noCorp]
    .flatMap((v) => String(v || '').split(/[\s·ㆍ/()\[\]{}.,_-]+/g))
    .concat([raw, noPrefix, noCorp])
    .map((v) => compactForSearch(stripCompareAliasPrefix(v)))
    .filter((v) => v && v.length >= 2 && !/^(회사|업체|단가|금액|견적|견적가|전기|설비|기술|건설|종합|시스템|이엔지|엔지니어링|주식회사)$/.test(v));
  const alias = raw.match(/([A-Z])\s*회사/i);
  if (alias) pieces.push(compactForSearch(alias[0]));
  return [...new Set(pieces)];
}


function parseNumberForEdit(value) {
  const num = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function formatNumberForEdit(value) {
  const num = parseNumberForEdit(value);
  return num ? String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
}

function recomputeLowestForRows(rows = [], columns = []) {
  const vendors = inferVendorColumnsForEdit({ columns, rows }, columns)
    .filter((vendor) => vendor.unitPriceKey || vendor.priceKey || vendor.amountKey);
  if (!vendors.length) return rows || [];
  return (rows || []).map((row) => {
    let best = null;
    for (const vendor of vendors) {
      const unitKey = vendor.unitPriceKey || vendor.priceKey;
      const amountKey = vendor.amountKey;
      const unitPrice = parseNumberForEdit(unitKey ? row[unitKey] : '');
      const amount = parseNumberForEdit(amountKey ? row[amountKey] : '');
      const compareValue = unitPrice || amount;
      if (!compareValue) continue;
      if (!best || compareValue < best.compareValue) {
        best = { vendor: vendor.name, unitPrice, amount, compareValue };
      }
    }
    if (!best) return { ...row, lowest_vendor: '', lowest_unit_price: '', lowest_amount: '' };
    return {
      ...row,
      lowest_vendor: best.vendor,
      lowest_unit_price: best.unitPrice ? formatNumberForEdit(best.unitPrice) : '',
      lowest_amount: best.amount ? formatNumberForEdit(best.amount) : (best.unitPrice && parseNumberForEdit(row.quantity || row.request_quantity) ? formatNumberForEdit(best.unitPrice * parseNumberForEdit(row.quantity || row.request_quantity)) : ''),
    };
  });
}

function sourceRowsFromTableMeta(table = {}) {
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  return Array.isArray(meta.allRows) && meta.allRows.length ? meta.allRows : [];
}

function mergeRowsWithSourceValues(rows = [], sourceRows = [], columns = []) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(sourceRows) || !sourceRows.length) return rows || [];
  const sourceByIdentity = new Map();
  for (const src of sourceRows) {
    const key = getRowIdentityKey(src);
    if (key && !sourceByIdentity.has(key)) sourceByIdentity.set(key, src);
  }
  const columnKeys = (columns || []).map((col) => String(col?.key || col || '')).filter(Boolean);
  const allKeys = columnKeys.length ? columnKeys : Array.from(new Set(sourceRows.flatMap((row) => Object.keys(row || {}))));
  return (rows || []).map((row) => {
    const key = getRowIdentityKey(row);
    const source = key ? sourceByIdentity.get(key) : null;
    if (!source) return row;
    const next = { ...row };
    for (const colKey of allKeys) {
      const current = next[colKey];
      const sourceValue = source[colKey];
      if ((current === undefined || current === null || String(current).trim() === '') && sourceValue !== undefined && sourceValue !== null && String(sourceValue).trim() !== '') {
        next[colKey] = sourceValue;
      }
    }
    return next;
  });
}

function extractRowSearchTerms(message = '') {
  const cleaned = String(message || '')
    .replace(/(추가해줘|추가|넣어줘|넣어|포함해줘|포함|같이|함께|보여줘|보여줄래|찾아줘|필터|정리|비교|단가|표|행|항목|공종|업체|회사|기준|수량|각각|으로|로|만|좀|다시|현재|문서|파일|빼줘|빼고|제외|삭제|제거|없애|숨겨줘|숨김)/g, ' ')
    .replace(/["'`~!@#$%^&*_=+\\|;:<>,.?]/g, ' ')
    .trim();
  const terms = cleaned.split(/[\s,\/]+/g).map((v) => v.trim()).filter((v) => compactForSearch(v).length >= 2);
  const compactWhole = compactForSearch(cleaned);
  if (compactWhole.length >= 3) terms.unshift(cleaned);
  return [...new Set(terms)].slice(0, 8);
}

function rowMatchesSearchTerm(row = {}, term = '') {
  const rowText = getRowSearchText(row);
  const t = compactForSearch(term);
  if (!t) return false;
  if (rowText.includes(t) || t.includes(rowText)) return true;
  const itemKey = compactForSearch(row.item_name || '');
  const specKey = compactForSearch(row.spec || '');
  const codeKey = compactForSearch(row.construction_code || '');
  if (itemKey && (itemKey.includes(t) || t.includes(itemKey))) return true;
  const splitTerms = String(term || '').split(/\s+/g).map(compactForSearch).filter((v) => v.length >= 2);
  if (splitTerms.length >= 2 && splitTerms.every((part) => rowText.includes(part))) return true;
  // 공백·기호·분리 표기를 흡수해서 품목명을 비교한다.
  if (t.length >= 5) {
    const parts = [itemKey, specKey, codeKey].filter(Boolean).join('');
    let hitCount = 0;
    for (const part of [itemKey, specKey].filter(Boolean)) {
      if (t.includes(part) || part.includes(t.slice(0, Math.min(t.length, 4)))) hitCount += 1;
    }
    if (hitCount >= 1 && parts.includes(t.slice(0, Math.min(t.length, 4)))) return true;
  }
  return false;
}

function extractVendorExcludeEdit(message = '', table = {}, columnsOverride = null) {
  const text = String(message || '');
  if (!/(빼|제외|삭제|숨|없애|제거)/i.test(text)) return null;
  const columns = Array.isArray(columnsOverride) ? columnsOverride : (table.columns || []);
  const vendors = inferVisibleVendorColumnsForEdit(table, columns);
  const compactMessage = compactForSearch(text);
  const targets = vendors.filter((vendor) => {
    const keys = vendorSearchKeysForEdit(vendor.name);
    return keys.some((key) => key && (compactMessage.includes(key) || key.includes(compactMessage)));
  });
  if (!targets.length) return null;

  const removeKeys = new Set();
  targets.forEach((vendor) => {
    (vendor.columnKeys || []).forEach((key) => removeKeys.add(key));
    if (vendor.unitPriceKey) removeKeys.add(vendor.unitPriceKey);
    if (vendor.amountKey) removeKeys.add(vendor.amountKey);
  });

  const targetKeys = new Set(targets.flatMap((vendor) => vendorSearchKeysForEdit(vendor.name)));
  const nextColumns = (columns || []).filter((col) => {
    const key = String(col.key || '');
    const labelKey = compactForSearch(normalizeVendorLabelForEdit(col.label || key));
    if (removeKeys.has(key)) return false;
    return !Array.from(targetKeys).some((targetKey) => labelKey && (labelKey.includes(targetKey) || targetKey.includes(labelKey)));
  });
  const oldMeta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  const nextVendors = getTableMetaVendors(table).filter((vendor) => !vendorSearchKeysForEdit(vendor.name).some((key) => targetKeys.has(key)));
  const nextRows = recomputeLowestForRows(table.rows || [], nextColumns);
  return {
    type: 'REMOVE_VENDOR_COLUMNS',
    vendorNames: targets.map((vendor) => vendor.name),
    columns: nextColumns,
    rows: nextRows,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...oldMeta,
        vendorCount: nextVendors.length,
        vendors: nextVendors,
      },
    },
  };
}

function hasVendorEditIntent(message = '') {
  const text = String(message || '');
  return /(업체|회사|거래처|단가|금액|추가|넣|복구|살려|표시|보여|포함|같이|함께|빼|제외|삭제|숨|없애|제거)/i.test(text);
}

function vendorHasValuesInRows(vendor = {}, rows = []) {
  const keys = [vendor.unitPriceKey, vendor.priceKey, vendor.amountKey, ...(vendor.columnKeys || [])]
    .filter(Boolean)
    .map(String);
  if (!keys.length) return false;
  return (rows || []).some((row) => keys.some((key) => parseNumberForEdit(row?.[key]) > 0 || String(row?.[key] ?? '').trim() !== ''));
}

function availableVendorNamesForMessage(table = {}) {
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  const allColumns = Array.isArray(meta.allColumns) && meta.allColumns.length ? meta.allColumns : (table.columns || []);
  const sourceRows = Array.isArray(meta.allRows) && meta.allRows.length ? meta.allRows : (table.rows || []);
  const fullTable = {
    ...table,
    columns: allColumns,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...meta,
        vendors: Array.isArray(meta.allVendors) && meta.allVendors.length ? meta.allVendors : (Array.isArray(meta.vendors) ? meta.vendors : []),
      },
    },
  };
  return inferVendorColumnsForEdit(fullTable, allColumns)
    .filter((vendor) => vendorHasValuesInRows(vendor, sourceRows))
    .map((vendor) => vendor.name)
    .filter(Boolean);
}

function messageMentionsKnownVendor(message = '', table = {}) {
  const compactMessage = compactForSearch(message);
  if (!compactMessage) return false;
  return availableVendorNamesForMessage(table).some((name) => vendorSearchKeysForEdit(name).some((key) => key && compactMessage.includes(key)));
}

function buildVendorNoMatchEdit(message = '', table = {}) {
  if (!hasVendorEditIntent(message)) return null;
  const text = String(message || '');
  const hasCompanyWord = /(업체|회사|거래처)/i.test(text);
  const mentionsKnownVendor = messageMentionsKnownVendor(text, table);
  if (!hasCompanyWord && !mentionsKnownVendor) return null;
  const names = availableVendorNamesForMessage(table);
  return {
    type: 'VENDOR_EDIT_NO_MATCH',
    vendorNames: [],
    availableVendors: names,
    columns: table.columns || [],
    rows: table.rows || [],
  };
}

function extractVendorRestoreEdit(message = '', table = {}, columnsOverride = null) {
  const text = String(message || '');
  if (!/(추가|넣|복구|살려|표시|보여|포함|같이|함께)/i.test(text)) return null;

  const currentColumns = Array.isArray(columnsOverride) ? columnsOverride : (table.columns || []);
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  const allColumns = Array.isArray(meta.allColumns) && meta.allColumns.length ? meta.allColumns : currentColumns;
  if (!Array.isArray(allColumns) || !allColumns.length) return null;

  const currentKeys = new Set((currentColumns || []).map((col) => String(col.key || '')));
  const currentVendors = inferVisibleVendorColumnsForEdit(table, currentColumns);
  const currentVendorKeys = new Set(currentVendors.map((vendor) => vendor.compareKey).filter(Boolean));
  const fullTable = {
    ...table,
    columns: allColumns,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...meta,
        vendors: Array.isArray(meta.allVendors) && meta.allVendors.length ? meta.allVendors : (Array.isArray(meta.vendors) ? meta.vendors : []),
      },
    },
  };
  const sourceRowsForVendor = Array.isArray(meta.allRows) && meta.allRows.length ? meta.allRows : (table.rows || []);
  const allVendors = inferVendorColumnsForEdit(fullTable, allColumns)
    .filter((vendor) => vendor && vendor.name && !currentVendorKeys.has(vendor.compareKey))
    .filter((vendor) => vendorHasValuesInRows(vendor, sourceRowsForVendor));
  if (!allVendors.length) return null;

  const compactMessage = compactForSearch(text);
  const targets = allVendors.filter((vendor) => {
    const keys = vendorSearchKeysForEdit(vendor.name);
    return keys.some((key) => key && compactMessage.includes(key));
  });
  if (!targets.length) return null;

  const targetKeys = new Set();
  targets.forEach((vendor) => {
    (vendor.columnKeys || []).forEach((key) => targetKeys.add(String(key || '')));
    if (vendor.unitPriceKey) targetKeys.add(String(vendor.unitPriceKey));
    if (vendor.amountKey) targetKeys.add(String(vendor.amountKey));
    if (vendor.priceKey) targetKeys.add(String(vendor.priceKey));
    if (vendor.specKey) targetKeys.add(String(vendor.specKey));
    if (vendor.quantityKey) targetKeys.add(String(vendor.quantityKey));
  });

  const targetCompareKeys = targets.flatMap((vendor) => vendorSearchKeysForEdit(vendor.name)).filter(Boolean);
  const columnsToAdd = (allColumns || []).filter((col) => {
    const key = String(col.key || '');
    if (currentKeys.has(key)) return false;
    if (targetKeys.has(key)) return true;
    const labelKey = compactForSearch(normalizeVendorLabelForEdit(col.label || key));
    return targetCompareKeys.some((targetKey) => labelKey && (labelKey.includes(targetKey) || targetKey.includes(labelKey)));
  });

  if (!columnsToAdd.length) return null;

  const tableType = table.tableType || table.table_type || '';
  const nextColumns = sortColumnsForTable([...(currentColumns || []), ...columnsToAdd], tableType);
  const sourceRows = Array.isArray(meta.allRows) && meta.allRows.length ? meta.allRows : [];
  const baseRows = Array.isArray(table.rows) && table.rows.length ? table.rows : sourceRows;
  const rowsWithRestoredValues = mergeRowsWithSourceValues(baseRows, sourceRows, columnsToAdd);
  const nextRows = recomputeLowestForRows(rowsWithRestoredValues, nextColumns);
  const nextVendors = inferVisibleVendorColumnsForEdit({ ...table, columns: nextColumns, rows: nextRows }, nextColumns);

  return {
    type: 'RESTORE_VENDOR_COLUMNS',
    vendorNames: targets.map((vendor) => vendor.name),
    columns: nextColumns,
    rows: nextRows,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...meta,
        vendorCount: nextVendors.length,
        vendors: nextVendors.map((vendor, index) => ({
          name: vendor.name,
          index,
          unitPriceKey: vendor.unitPriceKey || vendor.priceKey || null,
          amountKey: vendor.amountKey || null,
        })),
      },
    },
  };
}


function getAllVendorTableForEdit(table = {}) {
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  const allColumns = Array.isArray(meta.allColumns) && meta.allColumns.length ? meta.allColumns : (table.columns || []);
  return {
    ...table,
    columns: allColumns,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...meta,
        vendors: Array.isArray(meta.allVendors) && meta.allVendors.length ? meta.allVendors : (Array.isArray(meta.vendors) ? meta.vendors : []),
      },
    },
  };
}

function findRequestedVendorsForEdit(message = '', table = {}) {
  const text = String(message || '');
  const compactMessage = compactForSearch(text);
  if (!compactMessage) return [];
  const fullTable = getAllVendorTableForEdit(table);
  const allColumns = fullTable.columns || [];
  const vendors = inferVendorColumnsForEdit(fullTable, allColumns);
  const matched = [];
  const seen = new Set();
  for (const vendor of vendors) {
    const keys = vendorSearchKeysForEdit(vendor.name);
    const hit = keys.some((key) => {
      if (!key || key.length < 2) return false;
      return compactMessage.includes(key);
    });
    if (hit && !seen.has(vendor.compareKey)) {
      matched.push(vendor);
      seen.add(vendor.compareKey);
    }
  }
  return matched;
}

function extractVendorSelectEdit(message = '', table = {}, rowsOverride = null, columnsOverride = null) {
  const text = String(message || '');
  if (!/(비교|기준|만|으로|로|표|정리|보여|추려|필터|수량|개씩)/i.test(text)) return null;
  const fullTable = getAllVendorTableForEdit(table);
  const allColumns = fullTable.columns || [];
  const targets = findRequestedVendorsForEdit(text, table);
  if (!targets.length) return null;

  const targetCompareKeys = new Set(targets.map((vendor) => vendor.compareKey).filter(Boolean));
  const allVendors = inferVendorColumnsForEdit(fullTable, allColumns);
  const vendorColumnKeys = new Set();
  const selectedColumnKeys = new Set();

  for (const vendor of allVendors) {
    const keys = new Set([...(vendor.columnKeys || []), vendor.unitPriceKey, vendor.priceKey, vendor.amountKey, vendor.specKey, vendor.quantityKey].filter(Boolean).map(String));
    keys.forEach((key) => vendorColumnKeys.add(key));
    if (targetCompareKeys.has(vendor.compareKey)) keys.forEach((key) => selectedColumnKeys.add(key));
  }

  const summaryKeys = new Set(['lowest_vendor', 'lowest_unit_price', 'lowest_amount', 'remark', 'lowest_vs_standard']);
  const nextColumns = (allColumns || []).filter((col) => {
    const key = String(col.key || '');
    if (summaryKeys.has(key)) return true;
    if (vendorColumnKeys.has(key)) return selectedColumnKeys.has(key);
    // 컬럼 라벨 기반으로도 한 번 더 방어한다.
    const labelKey = compactForSearch(normalizeVendorLabelForEdit(col.label || key));
    if (Array.from(targetCompareKeys).some((targetKey) => labelKey && (labelKey.includes(targetKey) || targetKey.includes(labelKey)))) return true;
    const belongsToOtherVendor = allVendors.some((vendor) => vendor.compareKey && labelKey && (labelKey.includes(vendor.compareKey) || vendor.compareKey.includes(labelKey)));
    return !belongsToOtherVendor;
  });

  const rowsSource = Array.isArray(rowsOverride) ? rowsOverride : (Array.isArray(table.rows) ? table.rows : []);
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  const sourceRows = Array.isArray(meta.allRows) && meta.allRows.length ? meta.allRows : [];
  const rowsWithSelectedValues = mergeRowsWithSourceValues(rowsSource, sourceRows, nextColumns);
  const nextRows = recomputeLowestForRows(rowsWithSelectedValues, nextColumns);
  const nextVendors = inferVisibleVendorColumnsForEdit({ ...table, columns: nextColumns, rows: nextRows }, nextColumns);

  return {
    type: 'SELECT_VENDOR_COLUMNS',
    vendorNames: targets.map((vendor) => vendor.name),
    columns: sortColumnsForTable(nextColumns, table.tableType || table.table_type || ''),
    rows: nextRows,
    tableJson: {
      ...(table.tableJson || {}),
      meta: {
        ...((table.tableJson && table.tableJson.meta) || {}),
        vendorCount: nextVendors.length,
        vendors: nextVendors.map((vendor, index) => ({
          name: vendor.name,
          index,
          unitPriceKey: vendor.unitPriceKey || vendor.priceKey || null,
          amountKey: vendor.amountKey || null,
        })),
      },
    },
  };
}

function extractRowFilterEdit(message, table) {
  const visibleRows = Array.isArray(table?.rows) ? table.rows : [];
  const meta = table?.tableJson?.meta && typeof table.tableJson.meta === 'object' ? table.tableJson.meta : {};
  // 최초 요청으로 화면 rows가 3행 등으로 좁혀져도, 후속 질문은 전체 원본 비교행에서 다시 필터링해야 한다.
  const sourceRows = Array.isArray(meta.allRows) && meta.allRows.length ? meta.allRows : visibleRows;
  const sourceColumns = Array.isArray(meta.allColumns) && meta.allColumns.length ? meta.allColumns : table?.columns;
  if (!sourceRows.length) return null;
  const text = String(message || '').trim();
  const compact = compactForSearch(text);
  if (!/(보여|바꿔|대신|말고|제외|빼|삭제|제거|숨|없애|만|필터|검색|나오게|추려|찾아|기준|추가|넣어|포함|같이|함께|붙여)/i.test(text)) return null;

  const itemNames = [...new Set(sourceRows.map((row) => String(row.item_name || '').trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const includeTerms = [];
  const excludeTerms = [];
  let directMatchedRows = null;
  const 말고Index = compact.indexOf('말고');

  const isRemoveCommand = /(빼|빼고|빼줘|제외|삭제|숨|없애|제거)/i.test(text);
  for (const name of itemNames) {
    const key = compactForSearch(name);
    if (!key || !compact.includes(key)) continue;
    const pos = compact.indexOf(key);
    if (isRemoveCommand) excludeTerms.push(name);
    else if (말고Index >= 0 && pos < 말고Index) excludeTerms.push(name);
    else includeTerms.push(name);
  }

  // 사용자가 공백을 넣어 말해도 실제 item_name과 매칭한다.
  // 제거 명령에서는 발견된 품목을 include가 아니라 exclude로 넣어야 한다.
  if (isRemoveCommand) {
    const normalizedNoSpace = compact.replace(/[()\[\]{}.,]/g, '');
    for (const name of itemNames) {
      const key = compactForSearch(name);
      if (!key || excludeTerms.includes(name)) continue;
      const looseKey = key.replace(/[()\[\]{}.,]/g, '');
      if (looseKey && (normalizedNoSpace.includes(looseKey) || looseKey.includes(normalizedNoSpace))) {
        excludeTerms.push(name);
      }
    }
  }

  // 사용자가 부분 표현을 쓸 때만 보조 매칭한다.
  // 단, 톤마대(만들기)처럼 괄호 포함 품목을 명시했는데 정확 매칭에 실패한 경우에는
  // '쌓기' 같은 부분어로 P.P마대(쌓기)를 잘못 끌고 오지 않도록 보조 매칭을 막는다.
  if (!includeTerms.length && !excludeTerms.length && !hasExplicitParenthesizedItem(text)) {
    const tokens = text
      .replace(/[()\[\]{}.,]/g, ' ')
      .split(/\s+/)
      .map((v) => v.trim())
      .filter((v) => v.length >= 2 && !/^(이걸로|이거|이것|보여줘|보여줄래|다시|현재|파일|표|단가|비교|말고|대신|만|좀|각각|추가|빼주고|빼줘|제외|삭제|제거|업체|회사)$/.test(v));
    for (const token of tokens) {
      const t = compactForSearch(token);
      const matches = itemNames.filter((name) => {
        const nameKey = compactForSearch(name);
        return nameKey.includes(t) || t.includes(nameKey);
      });
      for (const matched of matches) {
        if (!matched) continue;
        if (isRemoveCommand && !excludeTerms.includes(matched)) excludeTerms.push(matched);
        else if (!isRemoveCommand && !includeTerms.includes(matched)) includeTerms.push(matched);
      }
    }
  }

  if (!includeTerms.length && !excludeTerms.length) {
    const fallbackTerms = extractRowSearchTerms(text);
    const matchedByTerms = sourceRows.filter((row) => fallbackTerms.some((term) => rowMatchesSearchTerm(row, term)));
    if (matchedByTerms.length) {
      directMatchedRows = matchedByTerms;
      includeTerms.push(...fallbackTerms);
    }
  }

  let nextRows = visibleRows;
  let appendedRowKeys = [];
  if (excludeTerms.length && isRemoveCommand) {
    nextRows = sourceRows.filter((row) => !excludeTerms.some((term) => getRowSearchText(row).includes(compactForSearch(term))));
  } else if (includeTerms.length) {
    const exactKeys = new Set(itemNames.map((name) => compactForSearch(name)));
    const exactTerms = includeTerms.map((term) => compactForSearch(term)).filter((term) => exactKeys.has(term));
    const matchedRows = directMatchedRows || sourceRows.filter((row) => {
      const itemKey = compactForSearch(row.item_name || '');
      if (exactTerms.length) return exactTerms.includes(itemKey);
      return includeTerms.some((term) => getRowSearchText(row).includes(compactForSearch(term)) || rowMatchesSearchTerm(row, term));
    });
    const shouldAppend = /(추가|이어|같이|함께|포함|더\s*넣|붙여)/i.test(text);
    if (shouldAppend) {
      const visibleKeys = new Set(visibleRows.map((row) => getRowIdentityKey(row)));
      appendedRowKeys = matchedRows
        .map((row) => getRowIdentityKey(row))
        .filter((key) => key && !visibleKeys.has(key));
      const inheritedQuantity = visibleRows.find((row) => row.quantity || row.request_quantity || row.requested_quantity);
      const inheritedQuantityValue = inheritedQuantity?.quantity || inheritedQuantity?.request_quantity || inheritedQuantity?.requested_quantity || '';
      const seen = new Set();
      nextRows = [...visibleRows, ...matchedRows].map((row) => (inheritedQuantityValue && !row.quantity && !row.request_quantity ? { ...row, quantity: inheritedQuantityValue, request_quantity: inheritedQuantityValue } : row)).filter((row) => {
        const key = getRowIdentityKey(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else {
      nextRows = matchedRows;
    }
  } else if (excludeTerms.length) {
    nextRows = sourceRows.filter((row) => !excludeTerms.some((term) => getRowSearchText(row).includes(compactForSearch(term))));
  } else {
    return null;
  }

  if (!nextRows.length) {
    return {
      type: 'FILTER_ROWS_NO_MATCH',
      includeTerms,
      excludeTerms,
      columns: table.columns || sourceColumns,
      rows: visibleRows
    };
  }

  return {
    type: 'FILTER_ROWS_BY_TERM',
    includeTerms,
    excludeTerms,
    columns: table.columns || sourceColumns,
    rows: nextRows,
    appendedRowKeys: typeof appendedRowKeys !== 'undefined' ? appendedRowKeys : []
  };
}

function detectTableEditCommand(message, table) {
  const text = String(message || '').trim();
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return null;
  const tableType = table.tableType || table.table_type || '';

  const requestedQuantity = extractRequestedQuantityFromMessage(text);
  const filterEdit = extractRowFilterEdit(text, table);
  if (filterEdit) {
    let nextEdit = filterEdit;
    if (requestedQuantity.value) {
      nextEdit = {
        ...filterEdit,
        type: filterEdit.type === 'FILTER_ROWS_BY_TERM' ? 'FILTER_ROWS_BY_TERM_AND_QUANTITY' : filterEdit.type,
        requestedQuantity,
        columns: ensureColumn(filterEdit.columns || table.columns, 'quantity'),
        rows: applyRequestedQuantityToRows(filterEdit.rows, requestedQuantity, filterEdit.appendedRowKeys),
      };
    }
    const vendorRemoval = extractVendorExcludeEdit(text, { ...table, columns: nextEdit.columns || table.columns, rows: nextEdit.rows || table.rows }, nextEdit.columns || table.columns);
    if (vendorRemoval) {
      nextEdit = {
        ...nextEdit,
        vendorNames: vendorRemoval.vendorNames,
        columns: vendorRemoval.columns,
        rows: recomputeLowestForRows(nextEdit.rows, vendorRemoval.columns),
        tableJson: vendorRemoval.tableJson,
        type: `${nextEdit.type}_AND_REMOVE_VENDOR`,
      };
    } else if (/(추가|넣|복구|살려|표시|보여|포함|같이|함께)/i.test(text)) {
      const vendorRestore = extractVendorRestoreEdit(text, { ...table, columns: nextEdit.columns || table.columns, rows: nextEdit.rows || table.rows, tableJson: nextEdit.tableJson || table.tableJson }, nextEdit.columns || table.columns);
      if (vendorRestore) {
        nextEdit = {
          ...nextEdit,
          vendorNames: vendorRestore.vendorNames,
          columns: vendorRestore.columns,
          rows: recomputeLowestForRows(vendorRestore.rows || nextEdit.rows, vendorRestore.columns),
          tableJson: vendorRestore.tableJson,
          type: `${nextEdit.type}_AND_RESTORE_VENDOR`,
        };
      }
    } else {
      const vendorSelection = extractVendorSelectEdit(text, { ...table, tableJson: nextEdit.tableJson || table.tableJson }, nextEdit.rows || table.rows, nextEdit.columns || table.columns);
      if (vendorSelection) {
        nextEdit = {
          ...nextEdit,
          vendorNames: vendorSelection.vendorNames,
          columns: vendorSelection.columns,
          rows: recomputeLowestForRows(nextEdit.rows || vendorSelection.rows, vendorSelection.columns),
          tableJson: vendorSelection.tableJson,
          type: `${nextEdit.type}_AND_SELECT_VENDOR`,
        };
      }
    }
    return nextEdit;
  }

  const vendorRemovalOnly = extractVendorExcludeEdit(text, table, table.columns);
  if (vendorRemovalOnly) return vendorRemovalOnly;

  if (!/(추가|넣|복구|살려|표시|보여|포함|같이|함께)/i.test(text)) {
    const vendorSelectOnly = extractVendorSelectEdit(text, table, table.rows, table.columns);
    if (vendorSelectOnly) return vendorSelectOnly;
  }

  const vendorRestoreOnly = extractVendorRestoreEdit(text, table, table.columns);
  if (vendorRestoreOnly) return vendorRestoreOnly;

  const vendorNoMatch = buildVendorNoMatchEdit(text, table);
  if (vendorNoMatch) return vendorNoMatch;

  if (requestedQuantity.value && /(수량|기준|개|ea|㎡|m2|m²|㎥|m3|m³|톤|kg|대|명|식|시간|일|세트)/i.test(text)) {
    return {
      type: 'APPLY_REQUESTED_QUANTITY',
      requestedQuantity,
      columns: ensureColumn(table.columns, 'quantity'),
      rows: applyRequestedQuantityToRows(table.rows, requestedQuantity),
    };
  }

  if (/(내용|값).*(없|비어|빈).*(컬럼|열).*(빼|제외|삭제|숨|없애)|빈\s*(컬럼|열).*(빼|제외|삭제|숨|없애)/i.test(text)) {
    const columns = sortColumnsForTable(pruneEmptyColumns(table.columns, table.rows), tableType);
    return { type: 'PRUNE_EMPTY_COLUMNS', columns, rows: table.rows };
  }

  if (/(빼|제외|삭제|숨|없애)/i.test(text)) {
    const keys = findColumnKeysInMessage(text, table.columns);
    if (keys.length) {
      const columns = sortColumnsForTable(table.columns.filter((col) => !keys.includes(col.key)), tableType);
      return { type: 'REMOVE_COLUMNS', keys, columns, rows: table.rows };
    }
  }

  if (/(추가|다시\s*넣|되돌|복구|표시|보여|살려)/i.test(text)) {
    const requestedKeys = findColumnKeysInMessage(text, null);
    if (/(전체|원래|처음|기본|모든\s*컬럼|전체\s*컬럼)/i.test(text) && !requestedKeys.length) {
      requestedKeys.push(...getAvailableColumnsFromRows(table.rows).map((col) => col.key));
    }
    const currentKeys = new Set((table.columns || []).map((col) => col.key));
    const availableByKey = new Map([
      ...getAvailableColumnsFromRows(table.rows).map((col) => [col.key, col]),
      ...Object.entries(COLUMN_DEFINITIONS),
    ]);
    const toAdd = requestedKeys
      .filter((key) => !currentKeys.has(key))
      .map((key) => availableByKey.get(key) || { key, label: key });
    if (toAdd.length) {
      const columns = sortColumnsForTable([...(table.columns || []), ...toAdd], tableType);
      return { type: 'ADD_COLUMNS', keys: toAdd.map((col) => col.key), columns, rows: table.rows };
    }
    if (requestedKeys.length) {
      return { type: 'NOOP_COLUMNS_ALREADY_VISIBLE', keys: requestedKeys, columns: table.columns, rows: table.rows };
    }
  }

  if (/단가.*(높은|큰|비싼).*순|내림차순|가격.*높은/i.test(text)) {
    const rows = [...table.rows].sort((a, b) => Number(String(b.unit_price || b.amount || '').replace(/[^0-9.-]/g, '')) - Number(String(a.unit_price || a.amount || '').replace(/[^0-9.-]/g, '')));
    return { type: 'SORT_ROWS', sort: 'UNIT_PRICE_DESC', columns: table.columns, rows };
  }
  if (/단가.*(낮은|작은|싼).*순|오름차순|가격.*낮은/i.test(text)) {
    const rows = [...table.rows].sort((a, b) => Number(String(a.unit_price || a.amount || '').replace(/[^0-9.-]/g, '')) - Number(String(b.unit_price || b.amount || '').replace(/[^0-9.-]/g, '')));
    return { type: 'SORT_ROWS', sort: 'UNIT_PRICE_ASC', columns: table.columns, rows };
  }
  return null;
}

async function updateExistingTable({ job, table, columns, rows, tableJson = null }) {
  const issues = validateTable({ ...table, columns, rows });
  const nextTableJson = {
    ...(table.tableJson || {}),
    ...(tableJson || {}),
    columns,
    rows,
    meta: {
      ...((table.tableJson || {}).meta || {}),
      ...((tableJson || {}).meta || {}),
    },
  };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE extracted_tables SET columns_json = ?, rows_json = ?, table_json = ?, row_count = ?, status = 'MODIFIED' WHERE id = ?`,
      [JSON.stringify(columns), JSON.stringify(rows), JSON.stringify(nextTableJson), rows.length, table.id]
    );
    await replaceIssues(conn, job.id, table.id, issues);
    await conn.query('UPDATE document_jobs SET status = ? WHERE id = ?', [issues.length ? 'NEED_REVIEW' : 'READY_TO_GENERATE', job.id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function describeTableEdit(edit) {
  const labelOf = (key) => COLUMN_DEFINITIONS[key]?.label || key;
  if (edit.type === 'PRUNE_EMPTY_COLUMNS') return '값이 전혀 없는 컬럼을 제외하고 표를 다시 구성했습니다.';
  if (edit.type === 'REMOVE_COLUMNS') return `${edit.keys.map(labelOf).join(', ')} 컬럼을 제외하고 표를 다시 구성했습니다.`;
  if (edit.type === 'ADD_COLUMNS') return `${edit.keys.map(labelOf).join(', ')} 컬럼을 다시 추가했습니다.`;
  if (edit.type === 'NOOP_COLUMNS_ALREADY_VISIBLE') return `${edit.keys.map(labelOf).join(', ')} 컬럼은 이미 표에 표시되어 있습니다.`;
  if (edit.type === 'SORT_ROWS') return edit.sort === 'UNIT_PRICE_DESC' ? '단가 높은 순으로 표를 정렬했습니다.' : '단가 낮은 순으로 표를 정렬했습니다.';
  if (edit.type === 'APPLY_REQUESTED_QUANTITY') return `요청 수량 ${edit.requestedQuantity?.value || ''}${edit.requestedQuantity?.unit || ''}을 표와 자사양식 산출 기준에 반영했습니다.`;
  if (edit.type === 'REMOVE_VENDOR_COLUMNS') return `${(edit.vendorNames || []).join(', ')} 업체 컬럼을 제외하고 현재 표를 다시 구성했습니다.`;
  if (edit.type === 'RESTORE_VENDOR_COLUMNS') return `${(edit.vendorNames || []).join(', ')} 업체 컬럼을 다시 추가하고 최저 업체/금액을 재계산했습니다.`;
  if (edit.type === 'SELECT_VENDOR_COLUMNS') return `${(edit.vendorNames || []).join(', ')} 업체만 남기고 표를 다시 정리했습니다.`;
  if (edit.type === 'VENDOR_EDIT_NO_MATCH') {
    const names = (edit.availableVendors || []).slice(0, 8).join(', ');
    return names ? `요청한 업체명을 현재 표/원본 컬럼에서 정확히 찾지 못했습니다. 인식된 업체 후보는 ${names}입니다.` : '요청한 업체명을 현재 표/원본 컬럼에서 정확히 찾지 못했습니다. 새 작업으로 다시 분석하면 원본 업체 컬럼을 복구할 수 있습니다.';
  }
  if (String(edit.type || '').includes('RESTORE_VENDOR') && edit.vendorNames?.length) {
    const base = (edit.includeTerms || []).join(', ') || '요청한 항목';
    return `${base} 기준으로 표를 정리하고 ${(edit.vendorNames || []).join(', ')} 업체 컬럼을 다시 추가했습니다.${edit.requestedQuantity?.value ? ` 요청 수량 ${edit.requestedQuantity.value}${edit.requestedQuantity.unit || ''}도 반영했습니다.` : ''}`;
  }
  if (String(edit.type || '').includes('REMOVE_VENDOR') && edit.vendorNames?.length) {
    const base = (edit.includeTerms || []).join(', ') || '요청한 항목';
    return `${base} 기준으로 표 행을 ${Number.isFinite(edit.rows?.length) ? `${edit.rows.length}행 ` : ''}정리하고 ${(edit.vendorNames || []).join(', ')} 업체 컬럼을 제외했습니다.${edit.requestedQuantity?.value ? ` 요청 수량 ${edit.requestedQuantity.value}${edit.requestedQuantity.unit || ''}도 반영했습니다.` : ''}`;
  }
  if (edit.type === 'FILTER_ROWS_BY_TERM_AND_QUANTITY' || edit.type === 'FILTER_ROWS_BY_TERM') {
    const includes = (edit.includeTerms || []).join(', ');
    const excludes = (edit.excludeTerms || []).join(', ');
    const countText = Number.isFinite(edit.rows?.length) ? ` ${edit.rows.length}행` : '';
    if (includes) {
      const appendText = Array.isArray(edit.appendedRowKeys) ? (edit.appendedRowKeys.length ? ` 새로 ${edit.appendedRowKeys.length}행을 추가했습니다.` : ' 이미 표시 중인 항목은 중복 추가하지 않았습니다.') : '';
      return `${includes} 기준으로 표 행을${countText} 정리했습니다.${appendText}${edit.requestedQuantity?.value ? ` 요청 수량 ${edit.requestedQuantity.value}${edit.requestedQuantity.unit || ''}도 반영했습니다.` : ''}`;
    }
    if (excludes) return `${excludes} 항목을 제외하고 표 행을${countText} 필터링했습니다.`;
    return `요청한 조건으로 표 행을${countText} 필터링했습니다.`;
  }
  if (edit.type === 'FILTER_ROWS_NO_MATCH') return '요청한 항목과 일치하는 표 행을 찾지 못했습니다. 기존 표를 유지합니다.';
  return '표 요청을 반영했습니다.';
}

function normalizeAiTables(aiResult) {
  const tables = Array.isArray(aiResult?.tables) && aiResult.tables.length
    ? aiResult.tables
    : [{ tableName: '표 후보', tableType: 'NORMAL_TABLE', columns: defaultColumns, rows: [] }];

  return tables.map((table, index) => {
    const tableType = table.tableType || table.table_type || 'NORMAL_TABLE';
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const rawColumns = Array.isArray(table.columns) && table.columns.length ? table.columns : columnsForTableType(tableType);
    const columns = pruneEmptyColumns(rawColumns, rows);
    return {
      tableName: table.tableName || table.table_name || `표 후보 ${index + 1}`,
      tableType,
      columns,
      rows,
      page: table.page || table.pageNumber || table.page_number || null,
      confidence: table.confidence ?? null,
      raw: table
    };
  });
}

function validateAllTables(tables) {
  const issues = [];
  for (const table of tables) {
    const tableIssues = validateTable(table) || [];
    for (const issue of tableIssues) {
      issues.push({ ...issue, targetKey: issue.targetKey || table.tableName, targetName: issue.targetName || table.tableName });
    }
  }
  return issues;
}


async function persistAnalysisResult({ jobId, sessionId, aiResult, userRequest, outputMode, templateId }) {
  const totalPages = (aiResult.files || []).reduce((sum, item) => sum + Number(item.pageCount || item.page_count || 0), 0);
  const totalChars = (aiResult.files || []).reduce((sum, item) => sum + String(item.extractedText || item.extracted_text || '').length, 0);
  const aiTables = normalizeAiTables(aiResult);
  const totalRows = aiTables.reduce((sum, table) => sum + Number((table.rows || []).length), 0);
  const table = aiTables[0];
  const validatedIssues = [...(aiResult.issues || []), ...validateAllTables(aiTables)];

  console.info(`[DOC_JOB][AI_DONE] jobId=${jobId} files=${(aiResult.files || []).length} pages=${totalPages} chars=${totalChars} tables=${aiTables.length} rows=${totalRows} issues=${validatedIssues.length} ocrUsed=${Boolean(aiResult.parseMetrics?.ocrUsed)} model=${aiResult.model || 'unknown'}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM review_issues WHERE job_id = ?', [jobId]);
    await conn.query('DELETE FROM extracted_tables WHERE job_id = ?', [jobId]);
    await conn.query('DELETE FROM document_analysis_results WHERE job_id = ?', [jobId]);

    for (const fileResult of aiResult.files || []) {
      await conn.query(
        `UPDATE source_files
            SET parse_status = 'PARSED',
                stored_name = COALESCE(NULLIF(?, ''), stored_name),
                file_path = COALESCE(NULLIF(?, ''), file_path),
                file_type = COALESCE(NULLIF(?, ''), file_type),
                mime_type = COALESCE(NULLIF(?, ''), mime_type),
                file_size = COALESCE(?, file_size),
                page_count = COALESCE(?, page_count),
                extracted_text = ?,
                extracted_pages_json = ?,
                error_message = NULL
          WHERE job_id = ? AND original_name = ?`,
        [
          fileResult.storedName || fileResult.stored_name || '',
          fileResult.savedPath || fileResult.filePath || fileResult.file_path || '',
          fileResult.fileType || fileResult.file_type || '',
          fileResult.mimeType || fileResult.mime_type || '',
          fileResult.fileSize || fileResult.file_size || null,
          fileResult.pageCount || fileResult.page_count || null,
          fileResult.extractedText || fileResult.extracted_text || '',
          JSON.stringify({ pages: fileResult.pages || fileResult.extractedPages || [], metrics: fileResult.parseMetrics || fileResult.parse_metrics || {} }),
          jobId,
          fileResult.originalName || fileResult.original_name
        ]
      );
    }

    const analysisJson = {
      ...(aiResult.analysis || {}),
      llmUsage: aiResult.llmUsage || null,
      llmUsed: Boolean(aiResult.llmUsed),
      llmIntentUsed: Boolean(aiResult.llmIntentUsed),
      llmIntent: aiResult.llmIntent || null,
      llmError: aiResult.llmError || ''
    };

    await conn.query(
      `INSERT INTO document_analysis_results (job_id, document_type, recommended_table_type, document_purpose, summary, confidence, needs_review_yn, review_summary, analysis_json, llm_model, prompt_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, aiResult.analysis?.documentType || '업무 문서', table.tableType || 'NORMAL_TABLE', aiResult.analysis?.purpose || userRequest || '', aiResult.analysis?.summary || '', aiResult.analysis?.confidence || 0.8, validatedIssues.length ? 'Y' : 'N', validatedIssues.length ? '확인 필요 항목이 있습니다.' : '정상', JSON.stringify(analysisJson), aiResult.model || 'rule-parser', aiResult.promptVersion || 'lite-v1']
    );

    let firstTableId = null;
    for (const tableItem of aiTables) {
      const tableJson = { ...(tableItem.raw || tableItem), tableName: tableItem.tableName, tableType: tableItem.tableType, columns: tableItem.columns, rows: tableItem.rows, page: tableItem.page, confidence: tableItem.confidence };
      const [tableResult] = await conn.query(
        `INSERT INTO extracted_tables (job_id, table_name, table_type, columns_json, rows_json, table_json, row_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
        [jobId, tableItem.tableName || '표 후보', tableItem.tableType || 'NORMAL_TABLE', JSON.stringify(tableItem.columns || defaultColumns), JSON.stringify(tableItem.rows || []), JSON.stringify(tableJson), (tableItem.rows || []).length]
      );
      if (!firstTableId) firstTableId = tableResult.insertId;
    }

    await replaceIssues(conn, jobId, firstTableId, validatedIssues);
    await conn.query('UPDATE document_jobs SET status = ?, error_message = NULL WHERE id = ?', [validatedIssues.length ? 'NEED_REVIEW' : 'READY_TO_GENERATE', jobId]);
    if (sessionId) await conn.query('UPDATE document_chat_sessions SET active_job_id = ?, updated_at = NOW() WHERE id = ?', [jobId, sessionId]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  if (sessionId) {
    const [[jobRow]] = await pool.query('SELECT * FROM document_jobs WHERE id = ?', [jobId]);
    const user = await loadUserForBackground(jobRow.user_id);
    const job = await loadJob(jobId, user);
    const assistantText = buildAnalysisAnswer(job, userRequest || '');
    await appendChatMessage({
      sessionId,
      jobId,
      role: 'ASSISTANT',
      text: assistantText,
      payload: { jobId, rowCount: totalRows, issueCount: validatedIssues.length, completed: true },
      action: 'ANALYSIS_DONE',
      llmModel: aiResult.model || 'rule-parser'
    });
  }
}

async function runDocumentAnalysisJob({ jobId, sessionId }) {
  const [[jobRow]] = await pool.query('SELECT * FROM document_jobs WHERE id = ?', [jobId]);
  if (!jobRow) return;

  try {
    await pool.query('UPDATE document_jobs SET status = ?, error_message = NULL WHERE id = ?', ['PROCESSING', jobId]);
    await pool.query("UPDATE source_files SET parse_status = 'PARSING', error_message = NULL WHERE job_id = ? AND parse_status <> 'PARSED'", [jobId]);

    const filesForAnalysis = await loadFilesForBackgroundAnalysis(jobId);
    console.info(`[DOC_JOB][BACKGROUND_START] jobId=${jobId} sessionId=${sessionId || '-'} files=${filesForAnalysis.length} outputMode=${jobRow.output_mode || 'FREE_FORM'}`);

    const aiResult = await analyzeDocuments({
      files: filesForAnalysis,
      userRequest: jobRow.user_request,
      outputMode: jobRow.output_mode,
      templateId: jobRow.template_id,
    });

    await pool.query('UPDATE document_jobs SET status = ? WHERE id = ?', ['VALIDATING', jobId]);
    await persistAnalysisResult({
      jobId,
      sessionId,
      aiResult,
      userRequest: jobRow.user_request,
      outputMode: jobRow.output_mode,
      templateId: jobRow.template_id,
    });
  } catch (error) {
    const message = error?.message || '문서 분석 중 오류가 발생했습니다.';
    await pool.query('UPDATE document_jobs SET status = ?, error_message = ? WHERE id = ?', ['FAILED', message.slice(0, 4000), jobId]);
    await pool.query("UPDATE source_files SET parse_status = 'FAILED', error_message = ? WHERE job_id = ? AND parse_status <> 'PARSED'", [message.slice(0, 4000), jobId]);
    if (sessionId) {
      await appendChatMessage({
        sessionId,
        jobId,
        role: 'ASSISTANT',
        text: `문서 분석 중 오류가 발생했습니다. ${message}`,
        payload: { jobId, error: message },
        action: 'ANALYSIS_FAILED',
        llmModel: 'background-worker'
      });
    }
    throw error;
  }
}


const createJob = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ message: '업로드 파일이 없습니다.' });

  const { title, userRequest, outputMode, templateId, chatSessionId, includePreviousFiles } = req.body;
  const savedNewFiles = files.map(saveUploadFileForBackground);
  // 새 파일을 첨부한 분석은 기본적으로 첨부한 파일만 분석한다.
  // 이전 activeJob 파일을 자동 병합하면 "4개 업체" 요청에 과거 업체까지 섞여 회사 컬럼이 늘어나는 문제가 생긴다.
  // 기존 문서의 품목 추가/필터링은 파일 재첨부가 아니라 채팅(aiChat)에서 처리한다.
  const shouldIncludePreviousFiles = String(includePreviousFiles || '').toLowerCase() === 'true';
  const previousContext = shouldIncludePreviousFiles ? await loadPreviousAnalysisFilesForSession(req.user, chatSessionId, savedNewFiles) : { activeJobId: null, files: [] };
  const previousFiles = previousContext.files || [];
  const filesForDisplay = [...previousFiles, ...savedNewFiles];

  const conn = await pool.getConnection();
  let jobId;
  try {
    await conn.beginTransaction();
    const [jobResult] = await conn.query(
      `INSERT INTO document_jobs (user_id, title, user_request, output_mode, template_id, status)
       VALUES (?, ?, ?, ?, ?, 'QUEUED')`,
      [req.user.id, title || savedNewFiles[0].originalname, userRequest || null, outputMode || 'FREE_FORM', templateId || null]
    );
    jobId = jobResult.insertId;

    for (const file of previousFiles) {
      await conn.query(
        `INSERT INTO source_files (job_id, original_name, stored_name, file_path, file_type, mime_type, file_size, parse_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')`,
        [jobId, file.originalname, file.existingStoredName || file.storedName || '', file.existingFilePath || file.filePath || '', file.existingFileType || file.fileType || (file.originalname || '').split('.').pop(), file.mimetype, file.size]
      );
    }

    for (const file of savedNewFiles) {
      await conn.query(
        `INSERT INTO source_files (job_id, original_name, stored_name, file_path, file_type, mime_type, file_size, parse_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')`,
        [jobId, file.originalname, file.storedName || '', file.filePath || '', file.fileType || file.originalname.split('.').pop(), file.mimetype, file.size]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    for (const file of savedNewFiles) {
      if (file.filePath && fs.existsSync(file.filePath)) {
        try { fs.unlinkSync(file.filePath); } catch (_) {}
      }
    }
    throw error;
  } finally {
    conn.release();
  }

  const sessionId = await ensureChatSession(req.user, chatSessionId, title || savedNewFiles[0]?.originalname || '문서 분석 작업', jobId);
  await appendChatMessage({
    sessionId,
    jobId,
    role: 'USER',
    text: userRequest || '첨부한 문서를 분석해줘',
    payload: { files: filesForDisplay.map((file) => ({ name: file.originalname, size: file.size, mimeType: file.mimetype, previous: Boolean(file.fromPreviousJobId) })) },
    action: 'RUN_ANALYSIS',
  });
  await appendChatMessage({
    sessionId,
    jobId,
    role: 'ASSISTANT',
    text: `문서 분석 작업을 대기열에 등록했습니다. 작업 ID ${jobId}번으로 백그라운드에서 처리하고, 완료되면 이 채팅에 결과가 표시됩니다.`,
    payload: { jobId, queued: true, fileCount: filesForDisplay.length },
    action: 'ANALYSIS_QUEUED',
    llmModel: 'background-worker'
  });

  console.info(`[DOC_JOB][QUEUED] jobId=${jobId} sessionId=${sessionId} files=${savedNewFiles.length} previousFiles=${previousFiles.length} analysisFiles=${filesForDisplay.length} outputMode=${outputMode || 'FREE_FORM'} concurrency=${ANALYSIS_CONCURRENCY}`);
  enqueueDocumentAnalysis(jobId, sessionId);

  const job = await loadJob(jobId, req.user);
  const session = await loadChatSession(sessionId, req.user);
  res.status(202).json({ job, sessionId, session, queued: true });
});

function buildAnalysisAnswer(jobData, requestText) {
  const docType = jobData?.analysis?.documentType || jobData?.analysis?.document_type || '업무 문서';
  const summary = jobData?.analysis?.summary || '문서 분석이 완료되었습니다.';
  const rowCount = (jobData?.tables || []).reduce((sum, item) => sum + Number((item.rows || []).length), 0);
  const issueCount = jobData?.issues?.length || 0;
  const totalPages = (jobData?.files || []).reduce((sum, file) => sum + Number(file.pageCount || 0), 0);
  const fileCount = (jobData?.files || []).length;
  const parseText = totalPages ? `첨부 파일 ${fileCount}개, 전체 ${totalPages.toLocaleString()}페이지를 텍스트 우선 파싱했습니다.` : `첨부 파일 ${fileCount}개를 텍스트 우선 파싱했습니다.`;
  const tableType = jobData?.tables?.[0]?.tableType || jobData?.tables?.[0]?.table_type || '';
  if (tableType === 'MULTI_VENDOR_PRICE_COMPARISON') return `업체별 단가 비교 기준으로 분석했습니다. ${parseText} 요청한 공종/품목 기준으로 비교표 ${rowCount.toLocaleString()}행을 만들었습니다. 표 데이터 탭에서 요청 업체별 단가와 계산 금액을 확인하세요.`;
  if (tableType === 'STANDARD_MARKET_PRICE_TABLE') return `표준시장단가 자료로 분석했습니다. ${parseText} 공종별 단가 ${rowCount.toLocaleString()}행을 표로 정리했고 확인 필요 항목은 ${issueCount}건입니다.`;
  if (['REFERENCE_GUIDELINE_TABLE', 'GUIDELINE_SUMMARY_TABLE'].includes(tableType)) return `기준서/지침서로 분석했습니다. ${parseText} 기준·단가·산정 문장 ${rowCount.toLocaleString()}행을 표로 정리했고 확인 필요 항목은 ${issueCount}건입니다.`;
  if (/(단가|비교|최저|가격)/i.test(requestText || '')) return `단가 비교 기준으로 분석했습니다. ${parseText} 표 후보 ${rowCount.toLocaleString()}행, 확인 필요 항목 ${issueCount}건입니다.`;
  return `문서 분석이 완료되었습니다. ${parseText} 이 문서는 ${docType}입니다. ${summary}`;
}

const listJobs = asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.roleCode !== 'SYSTEM_ADMIN') { where = 'WHERE j.user_id = ?'; params.push(req.user.id); }
  const [rows] = await pool.query(
    `SELECT j.*, u.user_name FROM document_jobs j JOIN users u ON u.id = j.user_id ${where} ORDER BY j.created_at DESC LIMIT 100`,
    params
  );
  res.json({ jobs: rows.map((row) => ({ id: row.id, title: row.title, userName: row.user_name, outputMode: row.output_mode, status: row.status, createdAt: row.created_at })) });
});

const getJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id, req.user);
  if (!job) return res.status(404).json({ message: '작업을 찾을 수 없습니다.' });
  res.json({ job });
});

const updateTable = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id, req.user);
  if (!job) return res.status(404).json({ message: '작업을 찾을 수 없습니다.' });
  const requestedTableId = req.body.id || req.body.tableId || req.body.table_id;
  const table = requestedTableId ? job.tables.find((item) => Number(item.id) === Number(requestedTableId)) : job.tables[0];
  if (!table) return res.status(404).json({ message: '수정할 표가 없습니다.' });

  const rows = req.body.rows || [];
  const columns = pruneEmptyColumns(req.body.columns || table.columns || defaultColumns, rows);
  const issues = validateTable({ columns, rows, tableType: table.tableType });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const nextTableJson = {
      ...(table.tableJson || {}),
      columns,
      rows,
      meta: {
        ...((table.tableJson || {}).meta || {}),
      },
    };
    await conn.query(`UPDATE extracted_tables SET columns_json = ?, rows_json = ?, table_json = ?, row_count = ?, status = 'MODIFIED' WHERE id = ?`, [JSON.stringify(columns), JSON.stringify(rows), JSON.stringify(nextTableJson), rows.length, table.id]);
    await replaceIssues(conn, job.id, table.id, issues);
    await conn.query('UPDATE document_jobs SET status = ? WHERE id = ?', [issues.length ? 'NEED_REVIEW' : 'READY_TO_GENERATE', job.id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
  res.json({ job: await loadJob(job.id, req.user) });
});

const revalidateJob = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id, req.user);
  if (!job) return res.status(404).json({ message: '작업을 찾을 수 없습니다.' });
  const table = job.tables[0] || { columns: defaultColumns, rows: [] };
  const issues = validateTable(table);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await replaceIssues(conn, job.id, table.id, issues);
    await conn.query('UPDATE document_jobs SET status = ? WHERE id = ?', [issues.length ? 'NEED_REVIEW' : 'READY_TO_GENERATE', job.id]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  res.json({ job: await loadJob(job.id, req.user) });
});

function normalizeExcelOutputMode(value, fallback = 'FREE_FORM') {
  const raw = String(value || fallback || 'FREE_FORM').trim().toUpperCase();
  return raw === 'COMPANY_TEMPLATE' ? 'COMPANY_TEMPLATE' : 'FREE_FORM';
}

function normalizeTemplateId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
  return text;
}

async function loadTemplateWithMappings(templateId) {
  if (!templateId) return { template: null, mappings: [] };
  const [[template]] = await pool.query(`SELECT * FROM excel_templates WHERE id = ? AND active_yn = 'Y'`, [templateId]);
  if (!template) throw new Error('선택한 자사 양식을 찾을 수 없습니다.');
  const [[mappingRow]] = await pool.query(
    `SELECT * FROM excel_template_mappings WHERE template_id = ? AND active_yn = 'Y' ORDER BY id DESC LIMIT 1`,
    [templateId]
  );
  const mappingJson = parseJson(mappingRow?.mapping_json, { mappings: [] });
  return { template, mappings: Array.isArray(mappingJson.mappings) ? mappingJson.mappings : [] };
}

async function generateExcelForJob({ job, tableId, fileName, outputMode = null, templateId = null, sourceSessionId = null, sourceMessageId = null, authorName = '', templateLayoutMode = 'COMPACT_VENDOR_GROUPS' }) {
  const table = tableId ? job.tables.find((item) => Number(item.id) === Number(tableId)) : job.tables[0];
  if (!table) throw new Error('엑셀로 만들 표 데이터가 없습니다.');

  const effectiveOutputMode = normalizeExcelOutputMode(outputMode, job.outputMode || 'FREE_FORM');
  const requestedTemplateId = normalizeTemplateId(templateId);
  const effectiveTemplateId = effectiveOutputMode === 'COMPANY_TEMPLATE' ? (requestedTemplateId || job.templateId || null) : null;

  let excel;
  if (effectiveTemplateId) {
    const { template, mappings } = await loadTemplateWithMappings(effectiveTemplateId);
    if (!mappings.length) throw new Error('자사 양식 매핑이 저장되어 있지 않습니다. 매핑 페이지에서 먼저 저장하세요.');
    excel = await createMappedTemplateExcel({
      jobId: job.id,
      fileName,
      template,
      mappings,
      columns: table.columns,
      rows: table.rows,
      job: { ...job, tables: [table] },
      authorName,
      templateLayoutMode: templateLayoutMode || 'COMPACT_VENDOR_GROUPS'
    });
  } else {
    excel = await createExcelFile({ jobId: job.id, fileName, columns: table.columns, rows: table.rows });
  }

  const [result] = await pool.query(
    `INSERT INTO generated_excels (job_id, template_id, source_session_id, source_message_id, file_name, file_path, generated_status, downloaded_yn)
     VALUES (?, ?, ?, ?, ?, ?, 'GENERATED', 'N')`,
    [job.id, effectiveTemplateId, sourceSessionId || null, sourceMessageId || null, excel.fileName, excel.filePath]
  );
  await pool.query('UPDATE document_jobs SET status = ? WHERE id = ?', ['GENERATED', job.id]);
  return { id: result.insertId, fileName: excel.fileName, jobId: job.id, outputMode: effectiveOutputMode, templateApplied: Boolean(effectiveTemplateId) };
}

const generateExcel = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id, req.user);
  if (!job) return res.status(404).json({ message: '작업을 찾을 수 없습니다.' });
  const outputMode = normalizeExcelOutputMode(req.body.outputMode || req.body.output_mode, job.outputMode || 'FREE_FORM');
  const excel = await generateExcelForJob({
    job,
    tableId: req.body.tableId || req.body.table_id,
    fileName: req.body.fileName,
    outputMode,
    templateId: outputMode === 'COMPANY_TEMPLATE' ? (req.body.templateId ?? req.body.template_id ?? null) : null,
    sourceSessionId: req.body.chatSessionId || null,
    authorName: req.user.userName || req.user.loginId || '',
    templateLayoutMode: outputMode === 'COMPANY_TEMPLATE' ? (req.body.templateLayoutMode || 'COMPACT_VENDOR_GROUPS') : null
  });
  res.status(201).json({ excel });
});

const downloadExcel = asyncHandler(async (req, res) => {
  let user = req.user;
  if (!user && req.query.token) {
    const decoded = verifyToken(req.query.token);
    const [[row]] = await pool.query(`SELECT u.*, r.role_code, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [decoded.userId]);
    user = row ? { id: row.id, roleCode: row.role_code } : null;
  }
  if (!user) return res.status(401).json({ message: '인증이 필요합니다.' });
  const [[job]] = await pool.query('SELECT * FROM document_jobs WHERE id = ?', [req.params.id]);
  if (!job || !(user.roleCode === 'SYSTEM_ADMIN' || Number(job.user_id) === Number(user.id))) return res.status(404).json({ message: '작업을 찾을 수 없습니다.' });
  const [[excel]] = await pool.query('SELECT * FROM generated_excels WHERE id = ? AND job_id = ?', [req.params.excelId, req.params.id]);
  if (!excel || !fs.existsSync(excel.file_path)) return res.status(404).json({ message: '엑셀 파일을 찾을 수 없습니다.' });
  await pool.query("UPDATE generated_excels SET downloaded_yn = 'Y', downloaded_at = NOW() WHERE id = ?", [excel.id]);
  res.download(excel.file_path, excel.file_name);
});

const listDownloads = asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.roleCode !== 'SYSTEM_ADMIN') { where = 'WHERE j.user_id = ?'; params.push(req.user.id); }
  const [rows] = await pool.query(
    `SELECT e.*, j.title AS job_title, s.title AS session_title
       FROM generated_excels e
       JOIN document_jobs j ON j.id = e.job_id
       LEFT JOIN document_chat_sessions s ON s.id = e.source_session_id
       ${where}
      ORDER BY e.created_at DESC
      LIMIT 100`,
    params
  );
  res.json({ downloads: rows.map((row) => ({ id: row.id, jobId: row.job_id, fileName: row.file_name, jobTitle: row.job_title, sessionTitle: row.session_title, generatedStatus: row.generated_status, downloadedYn: row.downloaded_yn, createdAt: row.created_at, downloadedAt: row.downloaded_at })) });
});

const listChatSessions = asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.roleCode !== 'SYSTEM_ADMIN') { where = 'WHERE s.user_id = ?'; params.push(req.user.id); }
  const [rows] = await pool.query(
    `SELECT s.*, j.title AS job_title, j.status AS job_status,
            (SELECT COUNT(*) FROM document_chat_messages m WHERE m.session_id = s.id) AS message_count
       FROM document_chat_sessions s
       LEFT JOIN document_jobs j ON j.id = s.active_job_id
       ${where}
      ORDER BY s.updated_at DESC
      LIMIT 100`,
    params
  );
  res.json({ sessions: rows.map((row) => ({ id: row.id, title: row.title || row.job_title || '문서 작업 채팅', activeJobId: row.active_job_id, jobTitle: row.job_title, jobStatus: row.job_status, status: row.status, messageCount: row.message_count, createdAt: row.created_at, updatedAt: row.updated_at })) });
});

const createChatSession = asyncHandler(async (req, res) => {
  const sessionId = await ensureChatSession(req.user, null, req.body?.title || '새 문서 작업', null);
  await appendChatMessage({ sessionId, role: 'ASSISTANT', text: '새 채팅을 시작했습니다. 파일을 첨부하거나 기존 문서에 대해 질문해 주세요.', action: 'SESSION_CREATED' });
  res.status(201).json({ session: await loadChatSession(sessionId, req.user) });
});

const getChatSession = asyncHandler(async (req, res) => {
  const session = await loadChatSession(req.params.sessionId, req.user);
  if (!session) return res.status(404).json({ message: '채팅을 찾을 수 없습니다.' });
  res.json({ session });
});

const deleteChatSession = asyncHandler(async (req, res) => {
  const sessionId = req.params.sessionId;
  const [[session]] = await pool.query('SELECT * FROM document_chat_sessions WHERE id = ?', [sessionId]);
  if (!session || !(req.user.roleCode === 'SYSTEM_ADMIN' || Number(session.user_id) === Number(req.user.id))) {
    return res.status(404).json({ message: '채팅을 찾을 수 없습니다.' });
  }
  await pool.query('DELETE FROM document_chat_messages WHERE session_id = ?', [sessionId]);
  await pool.query('DELETE FROM document_chat_sessions WHERE id = ?', [sessionId]);
  res.json({ message: '채팅이 삭제되었습니다.', deletedSessionId: Number(sessionId) });
});

const aiChat = asyncHandler(async (req, res) => {
  const { message, context, jobId, tableId, sessionId: requestSessionId } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ message: '채팅 메시지를 입력하세요.' });

  let job = null;
  const effectiveJobId = jobId || context?.jobId || context?.activeJobId || null;
  if (effectiveJobId) job = await loadJob(effectiveJobId, req.user);

  const sessionId = await ensureChatSession(req.user, requestSessionId || null, job?.title || '문서 작업 채팅', job?.id || null);

  if (!job && sessionId) {
    const session = await loadChatSession(sessionId, req.user);
    if (session?.activeJob) job = session.activeJob;
  }

  const userMessageId = await appendChatMessage({ sessionId, jobId: job?.id || null, role: 'USER', text: String(message), payload: { tableId: tableId || context?.table?.id || null }, action: 'USER_CHAT' });

  const selectedTableId = tableId || context?.table?.id || null;
  const selectedTable = selectedTableId && job ? job.tables.find((item) => Number(item.id) === Number(selectedTableId)) : job?.tables?.[0];

  if (job && selectedTable) {
    const edit = detectTableEditCommand(message, selectedTable);
    if (edit) {
      if (!['NOOP_COLUMNS_ALREADY_VISIBLE', 'FILTER_ROWS_NO_MATCH', 'VENDOR_EDIT_NO_MATCH'].includes(edit.type)) {
        await updateExistingTable({ job, table: selectedTable, columns: edit.columns, rows: edit.rows, tableJson: edit.tableJson || null });
      }
      const updatedJob = await loadJob(job.id, req.user);
      const baseAnswer = `${describeTableEdit(edit)} 현재 표는 ${edit.rows.length}행, ${edit.columns.length}개 컬럼입니다.`;
      let answer = baseAnswer;
      let llmEdit = null;
      try {
        if (edit.type !== 'VENDOR_EDIT_NO_MATCH') {
          llmEdit = await chatWithDocuments({
            message: `반드시 한국어로만 답변하세요. 중국어/일본어/영어 문장을 섞지 마세요. 다음 표 수정 결과를 사용자에게 2~4줄로 설명하고, 실제 반영된 행/업체/금액 기준으로 추가 확인할 점을 알려줘. 사용자 요청: ${String(message)} / 수정 결과: ${baseAnswer}`,
            context: buildServerChatContext(updatedJob, selectedTable.id, { editSummary: baseAnswer, edit }),
          });
          const cleanLlmAnswer = sanitizeKoreanAssistantText(llmEdit?.answer || '', '표 수정은 반영되었습니다. 금액과 최저 업체는 현재 표시된 업체 컬럼 기준으로 다시 계산했습니다.');
          if (llmEdit?.llmUsed && cleanLlmAnswer) answer = `${baseAnswer}

AI 검토: ${cleanLlmAnswer}`;
        }
      } catch (error) {
        llmEdit = null;
      }
      await appendChatMessage({ sessionId, jobId: job.id, role: 'ASSISTANT', text: answer, payload: { edit, llmEdit }, action: edit.type === 'NOOP_COLUMNS_ALREADY_VISIBLE' ? 'TABLE_INFO' : 'TABLE_UPDATED', llmModel: llmEdit?.model || 'rule-table-editor' });
      return res.json({ chat: { answer, intent: 'TABLE_EDIT', action: edit.type === 'NOOP_COLUMNS_ALREADY_VISIBLE' ? 'NO_CHANGE' : 'UPDATE_TABLE', recommendedTab: 'table', quickReplies: ['표 확인', '단가 비교', '엑셀 만들어줘'], llmUsed: Boolean(llmEdit?.llmUsed), model: llmEdit?.model || 'rule-table-editor' }, job: updatedJob, session: await loadChatSession(sessionId, req.user) });
    }
  }

  if (job && /(엑셀|xlsx).*(만들|생성|다운로드)|다운로드.*(만들|생성|해줘)/i.test(String(message))) {
    const chatOutputMode = normalizeExcelOutputMode(context?.outputMode || job.outputMode || 'FREE_FORM', job.outputMode || 'FREE_FORM');
    const chatTemplateId = chatOutputMode === 'COMPANY_TEMPLATE' ? (context?.templateId || context?.selectedTemplate?.id || job.templateId || null) : null;
    const excel = await generateExcelForJob({ job, tableId: selectedTable?.id, fileName: null, outputMode: chatOutputMode, templateId: chatTemplateId, sourceSessionId: sessionId, sourceMessageId: userMessageId, authorName: req.user.userName || req.user.loginId || '', templateLayoutMode: chatOutputMode === 'COMPANY_TEMPLATE' ? (context?.templateLayoutMode || 'COMPACT_VENDOR_GROUPS') : null });
    const answer = `엑셀 파일을 생성했습니다. 다운로드 목록에도 함께 표시됩니다. 파일명: ${excel.fileName}`;
    await appendChatMessage({ sessionId, jobId: job.id, role: 'ASSISTANT', text: answer, payload: { generatedExcel: excel }, action: 'EXCEL_GENERATED', llmModel: 'rule-excel-generator' });
    return res.json({ chat: { answer, intent: 'EXCEL_CREATE', action: 'SHOW_EXCEL', recommendedTab: 'excel', quickReplies: ['다운로드 목록 보여줘', '표 데이터 보여줘'], generatedExcel: excel, llmUsed: false, model: 'rule-excel-generator' }, job: await loadJob(job.id, req.user), session: await loadChatSession(sessionId, req.user) });
  }

  const safeContext = buildServerChatContext(job, selectedTableId, context && typeof context === 'object' ? context : {});
  const result = await chatWithDocuments({ message: `반드시 한국어로만 답변하세요. 중국어/일본어/영어 문장을 섞지 마세요. ${String(message)}`, context: safeContext });
  const sanitizedAnswer = sanitizeKoreanAssistantText(result.answer || '', '요청을 확인했습니다. 현재 표 데이터 기준으로 답변을 생성했지만, LLM 응답 형식이 불안정하여 한국어 규칙 답변으로 대체했습니다. 표 데이터 탭에서 실제 반영 결과를 확인해 주세요.');
  const safeResult = { ...result, answer: sanitizedAnswer };
  await appendChatMessage({ sessionId, jobId: job?.id || null, role: 'ASSISTANT', text: safeResult.answer || '답변을 생성하지 못했습니다.', payload: safeResult, action: safeResult.action || 'AI_CHAT', llmModel: safeResult.model || null });
  res.json({ chat: safeResult, job: job ? await loadJob(job.id, req.user) : null, session: await loadChatSession(sessionId, req.user) });
});

module.exports = {
  createJob,
  listJobs,
  getJob,
  updateTable,
  revalidateJob,
  generateExcel,
  downloadExcel,
  listDownloads,
  listChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  aiChat,
  resumeQueuedDocumentJobs
};
