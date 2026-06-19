const fs = require('fs');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { parseJson } = require('../utils/mapper');
const { analyzeDocuments, validateTable, defaultColumns, chatWithDocuments } = require('../services/analysisService');
const { createExcelFile } = require('../services/excelService');
const { verifyToken } = require('../utils/jwt');

function canReadJob(user, job) {
  return user.roleCode === 'SYSTEM_ADMIN' || Number(job.user_id) === Number(user.id);
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
    files: files.map((file) => ({
      id: file.id,
      originalName: file.original_name,
      storedName: file.stored_name,
      fileType: file.file_type,
      mimeType: file.mime_type,
      fileSize: file.file_size,
      pageCount: file.page_count,
      parseStatus: file.parse_status,
      extractedText: file.extracted_text,
      extractedPages: parseJson(file.extracted_pages_json, [])
    })),
    analysis: analysis ? {
      id: analysis.id,
      documentType: analysis.document_type,
      recommendedTableType: analysis.recommended_table_type,
      purpose: analysis.document_purpose,
      summary: analysis.summary,
      confidence: Number(analysis.confidence || 0),
      needsReviewYn: analysis.needs_review_yn,
      reviewSummary: analysis.review_summary,
      keyValues: parseJson(analysis.analysis_json, {}).keyValues || [],
      llmModel: analysis.llm_model,
      promptVersion: analysis.prompt_version,
      raw: parseJson(analysis.analysis_json, {})
    } : null,
    tables: tables.map((table) => ({
      id: table.id,
      tableName: table.table_name,
      tableType: table.table_type,
      columns: parseJson(table.columns_json, defaultColumns),
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
      fileName: excel.file_name,
      generatedStatus: excel.generated_status,
      downloadedYn: excel.downloaded_yn,
      createdAt: excel.created_at
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


const aiChat = asyncHandler(async (req, res) => {
  const { message, context } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ message: '채팅 메시지를 입력하세요.' });
  }

  const safeContext = context && typeof context === 'object' ? context : {};
  const result = await chatWithDocuments({ message: String(message), context: safeContext });
  res.json({ chat: result });
});

const createJob = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ message: '업로드 파일이 없습니다.' });

  const { title, userRequest, outputMode, templateId } = req.body;
  const conn = await pool.getConnection();
  let jobId;
  try {
    await conn.beginTransaction();
    const [jobResult] = await conn.query(
      `INSERT INTO document_jobs (user_id, title, user_request, output_mode, template_id, status)
       VALUES (?, ?, ?, ?, ?, 'PROCESSING')`,
      [req.user.id, title || files[0].originalname, userRequest || null, outputMode || 'FREE_FORM', templateId || null]
    );
    jobId = jobResult.insertId;

    for (const file of files) {
      await conn.query(
        `INSERT INTO source_files (job_id, original_name, stored_name, file_path, file_type, mime_type, file_size, parse_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')`,
        [jobId, file.originalname, '', '', file.originalname.split('.').pop(), file.mimetype, file.size]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  const aiResult = await analyzeDocuments({ files, userRequest, outputMode, templateId });
  const table = aiResult.tables?.[0] || { tableName: '표 후보', tableType: 'NORMAL_TABLE', columns: defaultColumns, rows: [] };
  const validatedIssues = [...(aiResult.issues || []), ...validateTable(table)];

  const conn2 = await pool.getConnection();
  try {
    await conn2.beginTransaction();
    for (const fileResult of aiResult.files || []) {
      await conn2.query(
        `UPDATE source_files
            SET parse_status = 'PARSED',
                stored_name = COALESCE(NULLIF(?, ''), stored_name),
                file_path = COALESCE(NULLIF(?, ''), file_path),
                file_type = COALESCE(NULLIF(?, ''), file_type),
                mime_type = COALESCE(NULLIF(?, ''), mime_type),
                file_size = COALESCE(?, file_size),
                page_count = COALESCE(?, page_count),
                extracted_text = ?,
                extracted_pages_json = ?
          WHERE job_id = ? AND original_name = ?`,
        [
          fileResult.storedName || fileResult.stored_name || '',
          fileResult.savedPath || fileResult.filePath || fileResult.file_path || '',
          fileResult.fileType || fileResult.file_type || '',
          fileResult.mimeType || fileResult.mime_type || '',
          fileResult.fileSize || fileResult.file_size || null,
          fileResult.pageCount || fileResult.page_count || null,
          fileResult.extractedText || fileResult.extracted_text || '',
          JSON.stringify(fileResult.pages || fileResult.extractedPages || []),
          jobId,
          fileResult.originalName || fileResult.original_name
        ]
      );
    }
    await conn2.query(
      `INSERT INTO document_analysis_results (job_id, document_type, recommended_table_type, document_purpose, summary, confidence, needs_review_yn, review_summary, analysis_json, llm_model, prompt_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, aiResult.analysis?.documentType || '업무 문서', table.tableType || 'NORMAL_TABLE', aiResult.analysis?.purpose || userRequest || '', aiResult.analysis?.summary || '', aiResult.analysis?.confidence || 0.8, validatedIssues.length ? 'Y' : 'N', validatedIssues.length ? '확인 필요 항목이 있습니다.' : '정상', JSON.stringify(aiResult.analysis || {}), aiResult.model || 'rule-parser', aiResult.promptVersion || 'lite-v1']
    );
    const [tableResult] = await conn2.query(
      `INSERT INTO extracted_tables (job_id, table_name, table_type, columns_json, rows_json, table_json, row_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
      [jobId, table.tableName || '표 후보', table.tableType || 'NORMAL_TABLE', JSON.stringify(table.columns || defaultColumns), JSON.stringify(table.rows || []), JSON.stringify(table), (table.rows || []).length]
    );
    await replaceIssues(conn2, jobId, tableResult.insertId, validatedIssues);
    await conn2.query('UPDATE document_jobs SET status = ? WHERE id = ?', [validatedIssues.length ? 'NEED_REVIEW' : 'READY_TO_GENERATE', jobId]);
    await conn2.commit();
  } catch (error) {
    await conn2.rollback();
    await pool.query('UPDATE document_jobs SET status = ?, error_message = ? WHERE id = ?', ['FAILED', error.message, jobId]);
    throw error;
  } finally {
    conn2.release();
  }

  const job = await loadJob(jobId, req.user);
  res.status(201).json({ job });
});

const listJobs = asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.roleCode !== 'SYSTEM_ADMIN') {
    where = 'WHERE j.user_id = ?';
    params.push(req.user.id);
  }
  const [rows] = await pool.query(
    `SELECT j.*, u.user_name
       FROM document_jobs j
       JOIN users u ON u.id = j.user_id
       ${where}
      ORDER BY j.created_at DESC
      LIMIT 100`,
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
  const table = job.tables[0];
  if (!table) return res.status(404).json({ message: '수정할 표가 없습니다.' });

  const columns = req.body.columns || table.columns || defaultColumns;
  const rows = req.body.rows || [];
  const issues = validateTable({ columns, rows });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE extracted_tables SET columns_json = ?, rows_json = ?, table_json = ?, row_count = ?, status = 'MODIFIED' WHERE id = ?`,
      [JSON.stringify(columns), JSON.stringify(rows), JSON.stringify({ columns, rows }), rows.length, table.id]
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
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  res.json({ job: await loadJob(job.id, req.user) });
});

const generateExcel = asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id, req.user);
  if (!job) return res.status(404).json({ message: '작업을 찾을 수 없습니다.' });
  const table = job.tables[0];
  if (!table) return res.status(400).json({ message: '엑셀로 만들 표 데이터가 없습니다.' });

  const excel = await createExcelFile({ jobId: job.id, fileName: req.body.fileName, columns: table.columns, rows: table.rows });
  const [result] = await pool.query(
    `INSERT INTO generated_excels (job_id, template_id, file_name, file_path, generated_status, downloaded_yn)
     VALUES (?, ?, ?, ?, 'GENERATED', 'N')`,
    [job.id, req.body.templateId || job.templateId || null, excel.fileName, excel.filePath]
  );
  await pool.query('UPDATE document_jobs SET status = ? WHERE id = ?', ['GENERATED', job.id]);
  res.status(201).json({ excel: { id: result.insertId, fileName: excel.fileName } });
});

const downloadExcel = asyncHandler(async (req, res) => {
  let user = req.user;
  if (!user && req.query.token) {
    const decoded = verifyToken(req.query.token);
    const [[row]] = await pool.query(
      `SELECT u.*, r.role_code, r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [decoded.userId]
    );
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

module.exports = { createJob, listJobs, getJob, updateTable, revalidateJob, generateExcel, downloadExcel, aiChat };
