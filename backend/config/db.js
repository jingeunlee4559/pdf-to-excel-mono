const {
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
  ReviewIssue,
  GeneratedExcel,
  DocumentChatSession,
  DocumentChatMessage,
} = require('../models');
const { seedMongo } = require('./mongoSeed');

let connectPromise = null;

function normalizeSql(sql) {
  return String(sql || '').replace(/`/g, '').replace(/\\'/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

function cleanObject(value) {
  if (!value) return value;
  const obj = typeof value.toObject === 'function' ? value.toObject() : { ...value };
  delete obj._id;
  delete obj.__v;
  return obj;
}

function rows(values) {
  return (Array.isArray(values) ? values : [values]).filter(Boolean).map(cleanObject);
}

async function nextSeq(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return counter.seq;
}

function duplicateError(error) {
  if (error?.code === 11000) {
    error.code = 'ER_DUP_ENTRY';
  }
  return error;
}

async function createRow(Model, collectionName, data) {
  try {
    const doc = await Model.create({ id: await nextSeq(collectionName), ...data });
    return { insertId: doc.id, affectedRows: 1 };
  } catch (error) {
    throw duplicateError(error);
  }
}

async function userWithRole(filter, { activeOnly = false } = {}) {
  const user = await User.findOne(filter).lean();
  if (!user) return null;
  if (activeOnly && user.status !== 'ACTIVE') return null;
  const role = await Role.findOne({ id: user.role_id }).lean();
  return {
    ...user,
    role_code: role?.role_code || null,
    roleCode: role?.role_code || null,
    role_name: role?.role_name || null,
    roleName: role?.role_name || null,
  };
}

async function listJobsWithUser(userId = null) {
  const filter = userId ? { user_id: toId(userId) } : {};
  const jobs = await DocumentJob.find(filter).sort({ created_at: -1, id: -1 }).limit(100).lean();
  const userIds = [...new Set(jobs.map((job) => job.user_id).filter(Boolean))];
  const users = await User.find({ id: { $in: userIds } }).lean();
  const userMap = new Map(users.map((user) => [user.id, user]));
  return jobs.map((job) => ({ ...job, user_name: userMap.get(job.user_id)?.user_name || '' }));
}

async function listDownloadsWithJoins(userId = null) {
  const excels = await GeneratedExcel.find({}).sort({ created_at: -1, id: -1 }).limit(200).lean();
  const jobIds = [...new Set(excels.map((excel) => excel.job_id).filter(Boolean))];
  const sessionIds = [...new Set(excels.map((excel) => excel.source_session_id).filter(Boolean))];
  const jobs = await DocumentJob.find({ id: { $in: jobIds } }).lean();
  const sessions = await DocumentChatSession.find({ id: { $in: sessionIds } }).lean();
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  return excels
    .filter((excel) => !userId || jobMap.get(excel.job_id)?.user_id === toId(userId))
    .slice(0, 100)
    .map((excel) => ({
      ...excel,
      job_title: jobMap.get(excel.job_id)?.title || null,
      session_title: sessionMap.get(excel.source_session_id)?.title || null,
    }));
}

async function listChatSessionsWithJoins(userId = null) {
  const filter = userId ? { user_id: toId(userId) } : {};
  const sessions = await DocumentChatSession.find(filter).sort({ updated_at: -1, id: -1 }).limit(100).lean();
  const jobIds = [...new Set(sessions.map((session) => session.active_job_id).filter(Boolean))];
  const jobs = await DocumentJob.find({ id: { $in: jobIds } }).lean();
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const counts = await DocumentChatMessage.aggregate([
    { $match: { session_id: { $in: sessions.map((session) => session.id) } } },
    { $group: { _id: '$session_id', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((item) => [item._id, item.count]));
  return sessions.map((session) => ({
    ...session,
    job_title: jobMap.get(session.active_job_id)?.title || null,
    job_status: jobMap.get(session.active_job_id)?.status || null,
    message_count: countMap.get(session.id) || 0,
  }));
}

async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectPromise) {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/prototypeversion3';
    connectPromise = mongoose.connect(uri, {
      autoIndex: process.env.MONGO_AUTO_INDEX !== 'false',
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
    }).then(async (connection) => {
      if (process.env.MONGO_AUTO_SEED !== 'false') {
        await seedMongo();
      }
      return connection;
    }).catch((error) => {
      connectPromise = null;
      throw error;
    });
  }
  return connectPromise;
}

async function query(sql, params = []) {
  await connectDb();
  const q = normalizeSql(sql);

  // ===== users / roles =====
  if (q.startsWith('select u.*, r.role_code, r.role_name') && q.includes('where u.login_id = ?')) {
    return [rows(await userWithRole({ login_id: params[0] }))];
  }
  if (q.startsWith('select u.*, r.role_code, r.role_name') && q.includes('where u.id = ? and u.status =')) {
    return [rows(await userWithRole({ id: toId(params[0]) }, { activeOnly: true }))];
  }
  if (q.startsWith('select u.*, r.role_code, r.role_name') && q.includes('where u.id = ?')) {
    return [rows(await userWithRole({ id: toId(params[0]) }))];
  }
  if (q.startsWith('select u.id, r.role_code as rolecode')) {
    const user = await userWithRole({ id: toId(params[0]) });
    return [rows(user ? { id: user.id, roleCode: user.role_code } : null)];
  }
  if (q.startsWith('select u.*, r.role_code, r.role_name') && q.includes('order by u.created_at desc')) {
    const users = await User.find({}).sort({ created_at: -1, id: -1 }).lean();
    const roleIds = [...new Set(users.map((user) => user.role_id).filter(Boolean))];
    const roles = await Role.find({ id: { $in: roleIds } }).lean();
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return [users.map((user) => ({ ...user, role_code: roleMap.get(user.role_id)?.role_code || null, role_name: roleMap.get(user.role_id)?.role_name || null }))];
  }
  if (q === "select id from roles where role_code = 'general_user'") {
    return [rows(await Role.findOne({ role_code: 'GENERAL_USER' }).lean())];
  }
  if (q.startsWith('select * from roles where active_yn')) {
    return [await Role.find({ active_yn: 'Y' }).sort({ id: 1 }).lean()];
  }
  if (q.startsWith('select u.*, r.role_code, r.role_name from users u join roles r') && q.includes('where u.id = ?')) {
    return [rows(await userWithRole({ id: toId(params[0]) }))];
  }
  if (q.startsWith('update users set last_login_at')) {
    await User.updateOne({ id: toId(params[0]) }, { $set: { last_login_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('update users set') && q.includes('where id = ?')) {
    const setMatch = q.match(/update users set (.+?),\s*updated_at\s*=\s*now\(\)\s*where id = \?/);
    if (setMatch) {
      const setParts = setMatch[1].split(',').map((s) => s.trim());
      const allowedFields = new Set(['user_name', 'email', 'phone', 'department_name', 'position_name', 'role_id', 'status', 'password_hash']);
      const $set = { updated_at: new Date() };
      for (let i = 0; i < setParts.length; i++) {
        const fieldName = setParts[i].replace(/\s*=\s*\?.*/, '').trim();
        if (allowedFields.has(fieldName)) {
          $set[fieldName] = fieldName === 'role_id' ? toId(params[i]) : (params[i] !== undefined ? params[i] : null);
        }
      }
      await User.updateOne({ id: toId(params[params.length - 1]) }, { $set });
    }
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('insert into users')) {
    const data = { role_id: toId(params[0]), login_id: params[1], password_hash: params[2], user_name: params[3], email: params[4] || null, phone: params[5] || null, department_name: params[6] || null, position_name: params[7] || null, status: params[8] || 'ACTIVE' };
    return [await createRow(User, 'users', data)];
  }

  // ===== standard fields =====
  if (q.startsWith('select * from standard_fields')) {
    return [await StandardField.find({ active_yn: 'Y' }).sort({ sort_order: 1, id: 1 }).lean()];
  }

  // ===== templates =====
  if (q.startsWith('select t.*, m.mapping_json from excel_templates')) {
    const excludedCodes = params || [];
    const templates = await ExcelTemplate.find({ active_yn: 'Y', template_code: { $nin: excludedCodes } }).sort({ created_at: -1, id: -1 }).lean();
    const rowsOut = [];
    for (const template of templates) {
      const mapping = await ExcelTemplateMapping.findOne({ template_id: template.id, active_yn: 'Y' }).sort({ id: -1 }).lean();
      rowsOut.push({ ...template, mapping_json: mapping?.mapping_json || null });
    }
    return [rowsOut];
  }
  if (q.startsWith('insert into excel_templates')) {
    return [await createRow(ExcelTemplate, 'excel_templates', {
      created_by: toId(params[0]), template_name: params[1], template_code: params[2], template_type: params[3] || 'NORMAL_TABLE', file_path: params[4], original_file_name: params[5] || null, default_sheet_name: params[6] || null, description: params[7] || null, active_yn: 'Y'
    })];
  }
  if (q.startsWith('select * from excel_templates where id = ?')) {
    return [rows(await ExcelTemplate.findOne({ id: toId(params[0]), active_yn: 'Y' }).lean())];
  }
  if (q.startsWith('select id, template_name from excel_templates where id = ?') || q.startsWith('select id, template_name, template_type')) {
    return [rows(await ExcelTemplate.findOne({ id: toId(params[0]), active_yn: 'Y' }).select('id template_name template_type default_sheet_name').lean())];
  }
  if (q.startsWith('select * from excel_template_mappings where template_id = ?')) {
    return [rows(await ExcelTemplateMapping.findOne({ template_id: toId(params[0]), active_yn: 'Y' }).sort({ id: -1 }).lean())];
  }
  if (q.startsWith('insert into excel_template_mappings')) {
    return [await createRow(ExcelTemplateMapping, 'excel_template_mappings', {
      template_id: toId(params[0]), created_by: toId(params[1]), mapping_name: params[2] || null, mapping_version: 'v1', mapping_json: typeof params[3] === 'string' ? JSON.parse(params[3] || '{}') : (params[3] || {}), active_yn: 'Y'
    })];
  }
  if (q.startsWith('update excel_template_mappings set active_yn')) {
    const result = await ExcelTemplateMapping.updateMany({ template_id: toId(params[0]) }, { $set: { active_yn: 'N', updated_at: new Date() } });
    return [{ affectedRows: result.modifiedCount || 0 }];
  }
  if (q.startsWith('update excel_templates set default_sheet_name')) {
    await ExcelTemplate.updateOne({ id: toId(params[1]) }, { $set: { default_sheet_name: params[0] || null, updated_at: new Date() } });
    return [{ affectedRows: 1 }];
  }

  // ===== document jobs / files =====
  if (q.startsWith('select j.id as job_id')) {
    const jobs = await DocumentJob.find({ status: { $in: ['QUEUED', 'PROCESSING'] } }).sort({ created_at: 1, id: 1 }).limit(50).lean();
    const sessions = await DocumentChatSession.find({ active_job_id: { $in: jobs.map((job) => job.id) } }).lean();
    const sessionByJob = new Map(sessions.map((session) => [session.active_job_id, session]));
    return [jobs.map((job) => ({ job_id: job.id, session_id: sessionByJob.get(job.id)?.id || null }))];
  }
  if (q === 'select * from document_jobs where id = ?') {
    return [rows(await DocumentJob.findOne({ id: toId(params[0]) }).lean())];
  }
  if (q.startsWith('select j.*, u.user_name from document_jobs')) {
    const userId = q.includes('where j.user_id = ?') ? params[0] : null;
    return [await listJobsWithUser(userId)];
  }
  if (q.startsWith('insert into document_jobs')) {
    return [await createRow(DocumentJob, 'document_jobs', {
      user_id: toId(params[0]), title: params[1] || null, user_request: params[2] || null, output_mode: params[3] || 'FREE_FORM', template_id: toId(params[4]), status: 'QUEUED', error_message: null
    })];
  }
  if (q.startsWith('update document_jobs set status = ?, error_message = null')) {
    await DocumentJob.updateOne({ id: toId(params[1]) }, { $set: { status: params[0], error_message: null, updated_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('update document_jobs set status = ?, error_message = ?')) {
    await DocumentJob.updateOne({ id: toId(params[2]) }, { $set: { status: params[0], error_message: params[1] || null, updated_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('update document_jobs set status = ? where id = ?')) {
    await DocumentJob.updateOne({ id: toId(params[1]) }, { $set: { status: params[0], updated_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('select * from source_files where job_id = ?')) {
    return [await SourceFile.find({ job_id: toId(params[0]) }).sort({ id: 1 }).lean()];
  }
  if (q.startsWith('insert into source_files')) {
    return [await createRow(SourceFile, 'source_files', {
      job_id: toId(params[0]), original_name: params[1], stored_name: params[2] || '', file_path: params[3] || '', file_type: params[4] || null, mime_type: params[5] || null, file_size: Number(params[6] || 0), parse_status: 'WAITING'
    })];
  }
  if (q.startsWith('update source_files set parse_status = \'parsing\'')) {
    const result = await SourceFile.updateMany({ job_id: toId(params[0]), parse_status: { $ne: 'PARSED' } }, { $set: { parse_status: 'PARSING', error_message: null } });
    return [{ affectedRows: result.modifiedCount || 0 }];
  }
  if (q.startsWith('update source_files set parse_status = \'failed\'')) {
    const result = await SourceFile.updateMany({ job_id: toId(params[1]), parse_status: { $ne: 'PARSED' } }, { $set: { parse_status: 'FAILED', error_message: params[0] || null } });
    return [{ affectedRows: result.modifiedCount || 0 }];
  }
  if (q.startsWith('update source_files set parse_status = \'parsed\'')) {
    const [storedName, filePath, fileType, mimeType, fileSize, pageCount, extractedText, extractedPagesJson, jobId, originalName] = params;
    const set = { parse_status: 'PARSED', extracted_text: extractedText || '', extracted_pages_json: typeof extractedPagesJson === 'string' ? JSON.parse(extractedPagesJson || '{}') : extractedPagesJson, error_message: null };
    if (storedName) set.stored_name = storedName;
    if (filePath) set.file_path = filePath;
    if (fileType) set.file_type = fileType;
    if (mimeType) set.mime_type = mimeType;
    if (fileSize !== null && fileSize !== undefined) set.file_size = Number(fileSize);
    if (pageCount !== null && pageCount !== undefined) set.page_count = Number(pageCount);
    await SourceFile.updateOne({ job_id: toId(jobId), original_name: originalName }, { $set: set });
    return [{ affectedRows: 1 }];
  }

  // ===== analysis / tables / issues =====
  if (q.startsWith('select * from document_analysis_results where job_id = ?')) {
    return [rows(await DocumentAnalysisResult.findOne({ job_id: toId(params[0]) }).sort({ id: -1 }).lean())];
  }
  if (q.startsWith('delete from document_analysis_results')) {
    const result = await DocumentAnalysisResult.deleteMany({ job_id: toId(params[0]) });
    return [{ affectedRows: result.deletedCount || 0 }];
  }
  if (q.startsWith('insert into document_analysis_results')) {
    return [await createRow(DocumentAnalysisResult, 'document_analysis_results', {
      job_id: toId(params[0]), document_type: params[1] || null, recommended_table_type: params[2] || null, document_purpose: params[3] || null, summary: params[4] || null, confidence: Number(params[5] || 0), needs_review_yn: params[6] || 'N', review_summary: params[7] || null, analysis_json: typeof params[8] === 'string' ? JSON.parse(params[8] || '{}') : (params[8] || {}), llm_model: params[9] || null, prompt_version: params[10] || null
    })];
  }
  if (q.startsWith('select * from extracted_tables where job_id = ?')) {
    return [await ExtractedTable.find({ job_id: toId(params[0]) }).sort({ id: 1 }).lean()];
  }
  if (q.startsWith('delete from extracted_tables')) {
    const result = await ExtractedTable.deleteMany({ job_id: toId(params[0]) });
    return [{ affectedRows: result.deletedCount || 0 }];
  }
  if (q.startsWith('insert into extracted_tables')) {
    return [await createRow(ExtractedTable, 'extracted_tables', {
      job_id: toId(params[0]), table_name: params[1] || null, table_type: params[2] || 'NORMAL_TABLE', columns_json: typeof params[3] === 'string' ? JSON.parse(params[3] || '[]') : (params[3] || []), rows_json: typeof params[4] === 'string' ? JSON.parse(params[4] || '[]') : (params[4] || []), table_json: typeof params[5] === 'string' ? JSON.parse(params[5] || '{}') : (params[5] || {}), row_count: Number(params[6] || 0), status: 'DRAFT'
    })];
  }
  if (q.startsWith('update extracted_tables set columns_json')) {
    const [columnsJson, rowsJson, tableJson, rowCount, id] = params;
    await ExtractedTable.updateOne({ id: toId(id) }, { $set: { columns_json: JSON.parse(columnsJson || '[]'), rows_json: JSON.parse(rowsJson || '[]'), table_json: JSON.parse(tableJson || '{}'), row_count: Number(rowCount || 0), status: 'MODIFIED', updated_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('select * from review_issues where job_id = ?')) {
    return [await ReviewIssue.find({ job_id: toId(params[0]) }).sort({ id: 1 }).lean()];
  }
  if (q.startsWith('delete from review_issues')) {
    const result = await ReviewIssue.deleteMany({ job_id: toId(params[0]) });
    return [{ affectedRows: result.deletedCount || 0 }];
  }
  if (q.startsWith('insert into review_issues')) {
    return [await createRow(ReviewIssue, 'review_issues', {
      job_id: toId(params[0]), table_id: toId(params[1]), row_index: params[2] ?? null, target_key: params[3] || null, target_name: params[4] || null, field_key: params[5] || null, field_label: params[6] || null, issue_type: params[7] || 'CHECK_REQUIRED', severity: params[8] || 'WARNING', message: params[9] || '확인이 필요합니다.', suggested_value: params[10] || null, resolved_yn: 'N'
    })];
  }

  // ===== generated excels =====
  if (q.startsWith('select * from generated_excels where job_id = ?')) {
    return [await GeneratedExcel.find({ job_id: toId(params[0]) }).sort({ id: -1 }).lean()];
  }
  if (q.startsWith('insert into generated_excels')) {
    return [await createRow(GeneratedExcel, 'generated_excels', {
      job_id: toId(params[0]), template_id: toId(params[1]), source_session_id: toId(params[2]), source_message_id: toId(params[3]), file_name: params[4], file_path: params[5], generated_status: 'GENERATED', downloaded_yn: 'N'
    })];
  }
  if (q.startsWith('select * from generated_excels where id = ? and job_id = ?')) {
    return [rows(await GeneratedExcel.findOne({ id: toId(params[0]), job_id: toId(params[1]) }).lean())];
  }
  if (q.startsWith('update generated_excels set downloaded_yn')) {
    await GeneratedExcel.updateOne({ id: toId(params[0]) }, { $set: { downloaded_yn: 'Y', downloaded_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('select e.*, j.title as job_title')) {
    const userId = q.includes('where j.user_id = ?') ? params[0] : null;
    return [await listDownloadsWithJoins(userId)];
  }

  // ===== chat sessions/messages =====
  if (q === 'select * from document_chat_sessions where id = ?') {
    return [rows(await DocumentChatSession.findOne({ id: toId(params[0]) }).lean())];
  }
  if (q.startsWith('select s.*, j.title as job_title, j.status as job_status from document_chat_sessions')) {
    const session = await DocumentChatSession.findOne({ id: toId(params[0]) }).lean();
    if (!session) return [[]];
    const job = session.active_job_id ? await DocumentJob.findOne({ id: session.active_job_id }).lean() : null;
    return [rows({ ...session, job_title: job?.title || null, job_status: job?.status || null })];
  }
  if (q.startsWith('select s.*, j.title as job_title, j.status as job_status,')) {
    const userId = q.includes('where s.user_id = ?') ? params[0] : null;
    return [await listChatSessionsWithJoins(userId)];
  }
  if (q.startsWith('insert into document_chat_sessions')) {
    return [await createRow(DocumentChatSession, 'document_chat_sessions', { user_id: toId(params[0]), active_job_id: toId(params[1]), title: params[2] || '새 문서 작업', status: 'ACTIVE' })];
  }
  if (q.startsWith('update document_chat_sessions set active_job_id')) {
    await DocumentChatSession.updateOne({ id: toId(params[1]) }, { $set: { active_job_id: toId(params[0]), updated_at: new Date() } });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('update document_chat_sessions set updated_at = now(), active_job_id = coalesce')) {
    const set = { updated_at: new Date() };
    if (params[0] !== null && params[0] !== undefined) set.active_job_id = toId(params[0]);
    await DocumentChatSession.updateOne({ id: toId(params[1]) }, { $set: set });
    return [{ affectedRows: 1 }];
  }
  if (q.startsWith('select * from document_chat_messages where session_id = ?')) {
    return [await DocumentChatMessage.find({ session_id: toId(params[0]) }).sort({ id: 1 }).lean()];
  }
  if (q.startsWith('insert into document_chat_messages')) {
    return [await createRow(DocumentChatMessage, 'document_chat_messages', {
      session_id: toId(params[0]), job_id: toId(params[1]), role: params[2], message_text: params[3] || '', payload_json: typeof params[4] === 'string' ? JSON.parse(params[4] || '{}') : (params[4] || {}), action: params[5] || null, llm_model: params[6] || null
    })];
  }
  if (q.startsWith('delete from document_chat_messages')) {
    const result = await DocumentChatMessage.deleteMany({ session_id: toId(params[0]) });
    return [{ affectedRows: result.deletedCount || 0 }];
  }
  if (q.startsWith('delete from document_chat_sessions')) {
    const result = await DocumentChatSession.deleteMany({ id: toId(params[0]) });
    return [{ affectedRows: result.deletedCount || 0 }];
  }

  const error = new Error(`MongoDB 호환 레이어에 등록되지 않은 SQL입니다: ${String(sql).slice(0, 240)}`);
  error.code = 'UNSUPPORTED_SQL_FOR_MONGODB_ADAPTER';
  throw error;
}

async function getConnection() {
  await connectDb();
  return {
    query,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
}

module.exports = {
  connectDb,
  query,
  getConnection,
};
