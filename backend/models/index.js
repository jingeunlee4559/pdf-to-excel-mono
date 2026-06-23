const mongoose = require('mongoose');

const { Schema } = mongoose;

const timestampOptions = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
};

function numericIdSchema(definition, extraOptions = {}) {
  return new Schema(
    {
      id: { type: Number, unique: true, index: true },
      ...definition,
    },
    { ...timestampOptions, ...extraOptions }
  );
}

const counterSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false }
);

const roleSchema = numericIdSchema({
  role_code: { type: String, required: true, unique: true, index: true },
  role_name: { type: String, required: true },
  description: { type: String, default: null },
  active_yn: { type: String, default: 'Y', index: true },
});

const userSchema = numericIdSchema({
  role_id: { type: Number, required: true, index: true },
  login_id: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  user_name: { type: String, required: true },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  department_name: { type: String, default: null },
  position_name: { type: String, default: null },
  status: { type: String, default: 'ACTIVE', index: true },
  last_login_at: { type: Date, default: null },
});

const standardFieldSchema = numericIdSchema({
  field_key: { type: String, required: true, unique: true, index: true },
  field_label: { type: String, required: true },
  field_group: { type: String, required: true, index: true },
  data_type: { type: String, default: 'text' },
  description: { type: String, default: null },
  active_yn: { type: String, default: 'Y', index: true },
  sort_order: { type: Number, default: 0, index: true },
});

const fieldAliasKeywordSchema = numericIdSchema({
  field_key: { type: String, required: true, index: true },
  alias_keyword: { type: String, required: true, index: true },
  match_type: { type: String, default: 'CONTAINS' },
  priority: { type: Number, default: 100 },
  active_yn: { type: String, default: 'Y', index: true },
});
fieldAliasKeywordSchema.index({ field_key: 1, alias_keyword: 1 }, { unique: true });

const excelTemplateSchema = numericIdSchema({
  created_by: { type: Number, default: null, index: true },
  template_name: { type: String, required: true },
  template_code: { type: String, required: true, unique: true, index: true },
  template_type: { type: String, default: 'NORMAL_TABLE', index: true },
  file_path: { type: String, required: true },
  original_file_name: { type: String, default: null },
  default_sheet_name: { type: String, default: null },
  description: { type: String, default: null },
  active_yn: { type: String, default: 'Y', index: true },
});

const excelTemplateMappingSchema = numericIdSchema({
  template_id: { type: Number, required: true, index: true },
  created_by: { type: Number, default: null, index: true },
  mapping_name: { type: String, default: null },
  mapping_version: { type: String, default: 'v1', index: true },
  mapping_json: { type: Schema.Types.Mixed, required: true, default: {} },
  active_yn: { type: String, default: 'Y', index: true },
});

const documentJobSchema = numericIdSchema({
  user_id: { type: Number, required: true, index: true },
  title: { type: String, default: null },
  user_request: { type: String, default: null },
  output_mode: { type: String, default: 'FREE_FORM' },
  template_id: { type: Number, default: null, index: true },
  status: { type: String, default: 'UPLOADED', index: true },
  error_message: { type: String, default: null },
});

const sourceFileSchema = numericIdSchema(
  {
    job_id: { type: Number, required: true, index: true },
    original_name: { type: String, required: true },
    stored_name: { type: String, required: true },
    file_path: { type: String, required: true },
    file_type: { type: String, default: null },
    mime_type: { type: String, default: null },
    file_size: { type: Number, default: null },
    page_count: { type: Number, default: null },
    parse_status: { type: String, default: 'WAITING', index: true },
    extracted_text: { type: String, default: null },
    extracted_pages_json: { type: Schema.Types.Mixed, default: null },
    error_message: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false, minimize: false }
);

const documentAnalysisResultSchema = numericIdSchema({
  job_id: { type: Number, required: true, index: true },
  document_type: { type: String, default: null, index: true },
  recommended_table_type: { type: String, default: null, index: true },
  document_purpose: { type: String, default: null },
  summary: { type: String, default: null },
  confidence: { type: Number, default: null },
  needs_review_yn: { type: String, default: 'N', index: true },
  review_summary: { type: String, default: null },
  analysis_json: { type: Schema.Types.Mixed, default: null },
  llm_model: { type: String, default: null },
  prompt_version: { type: String, default: null },
});

const extractedTableSchema = numericIdSchema({
  job_id: { type: Number, required: true, index: true },
  table_name: { type: String, default: null },
  table_type: { type: String, default: 'NORMAL_TABLE', index: true },
  columns_json: { type: Schema.Types.Mixed, default: null },
  rows_json: { type: Schema.Types.Mixed, default: null },
  table_json: { type: Schema.Types.Mixed, default: null },
  row_count: { type: Number, default: 0 },
  status: { type: String, default: 'DRAFT', index: true },
});


const candidateFieldSchema = numericIdSchema({
  job_id: { type: Number, required: true, index: true },
  table_id: { type: Number, default: null, index: true },
  original_label: { type: String, required: true },
  suggested_field_key: { type: String, required: true, index: true },
  suggested_data_type: { type: String, default: 'TEXT' },
  matched_standard_field: { type: String, default: null },
  confidence: { type: Number, default: 0.7 },
  source: { type: String, default: 'AI_OR_USER' },
  status: { type: String, default: 'PENDING', index: true },
  active_yn: { type: String, default: 'Y', index: true },
});
candidateFieldSchema.index({ job_id: 1, table_id: 1, suggested_field_key: 1 }, { unique: false });

const tableEditLogSchema = numericIdSchema(
  {
    job_id: { type: Number, required: true, index: true },
    table_id: { type: Number, default: null, index: true },
    action: { type: String, required: true, index: true },
    row_id: { type: String, default: null },
    column_key: { type: String, default: null, index: true },
    before_value: { type: Schema.Types.Mixed, default: null },
    after_value: { type: Schema.Types.Mixed, default: null },
    edited_by: { type: Number, default: null, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false, minimize: false }
);

const reviewIssueSchema = numericIdSchema(
  {
    job_id: { type: Number, required: true, index: true },
    table_id: { type: Number, default: null, index: true },
    row_index: { type: Number, default: null },
    target_key: { type: String, default: null, index: true },
    target_name: { type: String, default: null },
    field_key: { type: String, default: null, index: true },
    field_label: { type: String, default: null },
    issue_type: { type: String, required: true },
    severity: { type: String, default: 'WARNING', index: true },
    message: { type: String, required: true },
    suggested_value: { type: String, default: null },
    resolved_yn: { type: String, default: 'N', index: true },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false, minimize: false }
);

const generatedExcelSchema = numericIdSchema(
  {
    job_id: { type: Number, required: true, index: true },
    template_id: { type: Number, default: null, index: true },
    source_session_id: { type: Number, default: null, index: true },
    source_message_id: { type: Number, default: null, index: true },
    file_name: { type: String, required: true },
    file_path: { type: String, required: true },
    generated_status: { type: String, default: 'GENERATED', index: true },
    downloaded_yn: { type: String, default: 'N', index: true },
    error_message: { type: String, default: null },
    downloaded_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false, minimize: false }
);


const documentTemplateRecommendationSchema = numericIdSchema(
  {
    job_id: { type: Number, required: true, index: true },
    template_id: { type: Number, default: null, index: true },
    recommendation_type: { type: String, default: 'EXISTING_TEMPLATE', index: true },
    template_name: { type: String, default: null },
    template_type: { type: String, default: null, index: true },
    score: { type: Number, default: 0, index: true },
    rank: { type: Number, default: 0, index: true },
    reason_json: { type: Schema.Types.Mixed, default: [] },
    matched_fields_json: { type: Schema.Types.Mixed, default: [] },
    missing_fields_json: { type: Schema.Types.Mixed, default: [] },
    design_json: { type: Schema.Types.Mixed, default: null },
    status: { type: String, default: 'RECOMMENDED', index: true },
    applied_yn: { type: String, default: 'N', index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false, minimize: false }
);

const documentChatSessionSchema = numericIdSchema({
  user_id: { type: Number, required: true, index: true },
  active_job_id: { type: Number, default: null, index: true },
  title: { type: String, default: '새 문서 작업' },
  status: { type: String, default: 'ACTIVE', index: true },
});

const documentChatMessageSchema = numericIdSchema(
  {
    session_id: { type: Number, required: true, index: true },
    job_id: { type: Number, default: null, index: true },
    role: { type: String, required: true },
    message_text: { type: String, default: '' },
    payload_json: { type: Schema.Types.Mixed, default: {} },
    action: { type: String, default: null },
    llm_model: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false, minimize: false }
);

const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
const Role = mongoose.models.Role || mongoose.model('Role', roleSchema, 'roles');
const User = mongoose.models.User || mongoose.model('User', userSchema, 'users');
const StandardField = mongoose.models.StandardField || mongoose.model('StandardField', standardFieldSchema, 'standard_fields');
const FieldAliasKeyword = mongoose.models.FieldAliasKeyword || mongoose.model('FieldAliasKeyword', fieldAliasKeywordSchema, 'field_alias_keywords');
const ExcelTemplate = mongoose.models.ExcelTemplate || mongoose.model('ExcelTemplate', excelTemplateSchema, 'excel_templates');
const ExcelTemplateMapping = mongoose.models.ExcelTemplateMapping || mongoose.model('ExcelTemplateMapping', excelTemplateMappingSchema, 'excel_template_mappings');
const DocumentJob = mongoose.models.DocumentJob || mongoose.model('DocumentJob', documentJobSchema, 'document_jobs');
const SourceFile = mongoose.models.SourceFile || mongoose.model('SourceFile', sourceFileSchema, 'source_files');
const DocumentAnalysisResult = mongoose.models.DocumentAnalysisResult || mongoose.model('DocumentAnalysisResult', documentAnalysisResultSchema, 'document_analysis_results');
const ExtractedTable = mongoose.models.ExtractedTable || mongoose.model('ExtractedTable', extractedTableSchema, 'extracted_tables');
const CandidateField = mongoose.models.CandidateField || mongoose.model('CandidateField', candidateFieldSchema, 'candidate_fields');
const TableEditLog = mongoose.models.TableEditLog || mongoose.model('TableEditLog', tableEditLogSchema, 'table_edit_logs');
const ReviewIssue = mongoose.models.ReviewIssue || mongoose.model('ReviewIssue', reviewIssueSchema, 'review_issues');
const GeneratedExcel = mongoose.models.GeneratedExcel || mongoose.model('GeneratedExcel', generatedExcelSchema, 'generated_excels');
const DocumentTemplateRecommendation = mongoose.models.DocumentTemplateRecommendation || mongoose.model('DocumentTemplateRecommendation', documentTemplateRecommendationSchema, 'document_template_recommendations');
const DocumentChatSession = mongoose.models.DocumentChatSession || mongoose.model('DocumentChatSession', documentChatSessionSchema, 'document_chat_sessions');
const DocumentChatMessage = mongoose.models.DocumentChatMessage || mongoose.model('DocumentChatMessage', documentChatMessageSchema, 'document_chat_messages');

module.exports = {
  mongoose,
  Counter,
  Role,
  User,
  StandardField,
  FieldAliasKeyword,
  ExcelTemplate,
  ExcelTemplateMapping,
  DocumentJob,
  SourceFile,
  DocumentAnalysisResult,
  ExtractedTable,
  CandidateField,
  TableEditLog,
  ReviewIssue,
  GeneratedExcel,
  DocumentTemplateRecommendation,
  DocumentChatSession,
  DocumentChatMessage,
};
