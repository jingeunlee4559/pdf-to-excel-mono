const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

function toField(row) {
  const group = row.field_group || 'DETAIL';
  return {
    id: row.id,
    fieldKey: row.field_key,
    fieldName: row.field_label,
    fieldLabel: row.field_label,
    fieldGroup: group,
    fieldScope: group === 'HEADER' || group === 'SUMMARY' ? group : 'DETAIL',
    dataType: row.data_type || 'text',
    description: row.description,
    defaultMappingType: group === 'HEADER' || group === 'SUMMARY' ? 'SINGLE_CELL' : 'REPEAT_COLUMN',
    isRequired: ['document_title', 'document_date', 'item_name', 'amount', 'total_amount'].includes(row.field_key),
    isActive: row.active_yn === 'Y',
    sortOrder: row.sort_order || 0
  };
}

const listStandardFields = asyncHandler(async (req, res) => {
  const mappingType = String(req.query.mappingType || '').toUpperCase();
  const [rows] = await pool.query(
    `SELECT * FROM standard_fields WHERE active_yn = 'Y' ORDER BY sort_order ASC, id ASC`
  );
  let fields = rows.map(toField);
  if (mappingType === 'SINGLE_CELL') fields = fields.filter((field) => field.defaultMappingType === 'SINGLE_CELL');
  if (mappingType === 'REPEAT_COLUMN') fields = fields.filter((field) => field.defaultMappingType === 'REPEAT_COLUMN');
  res.json({ fields });
});

module.exports = { listStandardFields };
