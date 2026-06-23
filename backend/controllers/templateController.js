const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { parseJson } = require('../utils/mapper');
const { uploadFileToAiServer, getExcelPreview } = require('../services/aiServerService');

function makeTemplateCode(templateName = 'TEMPLATE') {
  const compact = String(templateName)
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return `${compact || 'TEMPLATE'}_${Date.now()}`.slice(0, 96);
}

const SYSTEM_SEED_TEMPLATE_CODES = ['NORMAL_TABLE_V1', 'COMPARISON_MATRIX_V1', 'WORK_LOG_TABLE_V1'];

function toTemplate(row) {
  const mappingJson = parseJson(row.mapping_json, null);
  const status = row.active_yn === 'Y' ? 'DRAFT' : 'INACTIVE';
  return {
    id: row.id,
    templateId: row.id,
    templateName: row.template_name,
    templateCode: row.template_code,
    templateType: row.template_type,
    originalFileName: row.original_file_name,
    filePath: row.file_path,
    defaultSheetName: row.default_sheet_name,
    description: row.description,
    activeYn: row.active_yn,
    status,
    isLocked: Boolean(mappingJson?.locked),
    mapping: mappingJson,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const listTemplates = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.*, m.mapping_json
       FROM excel_templates t
       LEFT JOIN excel_template_mappings m ON m.template_id = t.id AND m.active_yn = 'Y'
      WHERE t.active_yn = 'Y'
        AND t.template_code NOT IN (${SYSTEM_SEED_TEMPLATE_CODES.map(() => '?').join(',')})
      ORDER BY t.created_at DESC`,
    SYSTEM_SEED_TEMPLATE_CODES
  );
  res.json({ templates: rows.map(toTemplate) });
});

const createTemplate = asyncHandler(async (req, res) => {
  const { templateName, templateCode, templateType, description, mappingJson } = req.body;
  if (!templateName) return res.status(400).json({ message: '템플릿명은 필수입니다.' });
  if (!req.file) return res.status(400).json({ message: '엑셀 템플릿 파일은 필수입니다.' });

  let mapping = {};
  try { mapping = JSON.parse(mappingJson || '{}'); } catch { return res.status(400).json({ message: '매핑 JSON 형식이 올바르지 않습니다.' }); }

  const uploaded = await uploadFileToAiServer(req.file, 'templates');
  const filePath = uploaded.filePath || uploaded.file_path || uploaded.savedPath || '';
  const storedName = uploaded.storedName || uploaded.stored_name || '';
  const originalFileName = uploaded.originalName || uploaded.original_name || req.file.originalname;
  const safeTemplateCode = templateCode || makeTemplateCode(templateName);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO excel_templates (created_by, template_name, template_code, template_type, file_path, original_file_name, default_sheet_name, description, active_yn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Y')`,
      [req.user.id, templateName, safeTemplateCode, templateType || 'NORMAL_TABLE', filePath, originalFileName, mapping.sheetName || mapping.sheet || null, description || null]
    );

    const defaultMapping = {
      sheetName: mapping.sheetName || mapping.sheet || null,
      mappings: Array.isArray(mapping.mappings) ? mapping.mappings : [],
      aiServerStoredName: storedName
    };

    await conn.query(
      `INSERT INTO excel_template_mappings (template_id, created_by, mapping_name, mapping_version, mapping_json, active_yn)
       VALUES (?, ?, ?, 'v1', ?, 'Y')`,
      [result.insertId, req.user.id, `${templateName} 기본 매핑`, JSON.stringify(defaultMapping)]
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, templateId: result.insertId, filePath, message: '자사 양식이 ai-server에 저장되고 등록되었습니다.' });
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: '이미 등록된 양식코드입니다.' });
    throw error;
  } finally {
    conn.release();
  }
});

const getTemplatePreview = asyncHandler(async (req, res) => {
  const [[template]] = await pool.query('SELECT * FROM excel_templates WHERE id = ? AND active_yn = \'Y\'', [req.params.id]);
  if (!template) return res.status(404).json({ message: '템플릿을 찾을 수 없습니다.' });

  const preview = await getExcelPreview({
    filePath: template.file_path,
    sheetName: req.query.sheetName || req.query.sheet_name || template.default_sheet_name,
    maxRows: Number(req.query.maxRows || 80),
    maxCols: Number(req.query.maxCols || 26)
  });

  res.json({
    template: toTemplate({ ...template, mapping_json: null }),
    ...preview
  });
});

const getTemplateMappings = asyncHandler(async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT * FROM excel_template_mappings WHERE template_id = ? AND active_yn = 'Y' ORDER BY id DESC LIMIT 1`,
    [req.params.id]
  );
  const mappingJson = parseJson(row?.mapping_json, { mappings: [] });
  res.json({
    mappingId: row?.id || null,
    templateId: Number(req.params.id),
    sheetName: mappingJson.sheetName || mappingJson.sheet || '',
    mappings: Array.isArray(mappingJson.mappings) ? mappingJson.mappings : []
  });
});

const saveTemplateMappings = asyncHandler(async (req, res) => {
  const templateId = Number(req.params.id);
  const { sheetName, mappings } = req.body;
  const [[template]] = await pool.query('SELECT id, template_name FROM excel_templates WHERE id = ? AND active_yn = \'Y\'', [templateId]);
  if (!template) return res.status(404).json({ message: '템플릿을 찾을 수 없습니다.' });

  const nextMapping = {
    sheetName: sheetName || null,
    mappings: Array.isArray(mappings) ? mappings : [],
    savedAt: new Date().toISOString()
  };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE excel_template_mappings SET active_yn = 'N' WHERE template_id = ?`, [templateId]);
    await conn.query(
      `INSERT INTO excel_template_mappings (template_id, created_by, mapping_name, mapping_version, mapping_json, active_yn)
       VALUES (?, ?, ?, 'v1', ?, 'Y')`,
      [templateId, req.user.id, `${template.template_name} 매핑`, JSON.stringify(nextMapping)]
    );
    await conn.query(`UPDATE excel_templates SET default_sheet_name = ? WHERE id = ?`, [sheetName || null, templateId]);
    await conn.commit();
    res.json({ message: '매핑이 저장되었습니다.', templateId, ...nextMapping });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

module.exports = { listTemplates, createTemplate, getTemplatePreview, getTemplateMappings, saveTemplateMappings };
