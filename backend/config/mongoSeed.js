const {
  Counter,
  Role,
  User,
  StandardField,
  FieldAliasKeyword,
  ExcelTemplate,
  ExcelTemplateMapping,
} = require('../models');
const { ensureTemplateMappingJson } = require('../utils/templateAutoMapping');

async function nextSeq(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return counter.seq;
}

async function upsertBy(Model, collectionName, filter, data) {
  const existing = await Model.findOne(filter).lean();
  if (existing) {
    await Model.updateOne(filter, { $set: data });
    return existing.id;
  }
  const id = await nextSeq(collectionName);
  await Model.create({ id, ...data });
  return id;
}

const standardFields = [
  ['document_title', '문서명', 'HEADER', 'text', '문서 제목 또는 산출물 제목', 10],
  ['document_date', '작성일', 'HEADER', 'date', '문서 작성일 또는 기준일', 20],
  ['document_no', '문서번호', 'HEADER', 'text', '문서 번호, 견적 번호, 거래 번호', 30],
  ['project_name', '공사명', 'HEADER', 'text', '공사명 또는 프로젝트명', 40],
  ['site_name', '현장명', 'HEADER', 'text', '현장명', 50],
  ['department_name', '부서명', 'HEADER', 'text', '부서명', 60],
  ['requester_name', '요청자', 'HEADER', 'text', '요청자 또는 작성자', 70],
  ['vendor_name', '업체명', 'HEADER', 'text', '거래처, 공급업체, 시공업체 등', 80],
  ['comparison_basis', '비교기준', 'HEADER', 'text', '표준단가/견적단가/업체단가 등 비교 기준', 90],
  ['row_no', '순번', 'DETAIL', 'number', '행 번호', 100],
  ['item_name', '품목명', 'DETAIL', 'text', '품목, 자재, 장비, 작업 항목명', 110],
  ['base_spec', '기준 규격', 'DETAIL', 'text', '기준자료 또는 공통 기준 규격', 121],
  ['spec', '규격', 'DETAIL', 'text', '규격, 사양, 모델, 크기', 120],
  ['base_unit', '기준 단위', 'DETAIL', 'text', '기준자료 또는 공통 기준 단위', 131],
  ['unit', '단위', 'DETAIL', 'text', 'EA, 개, 식, m 등 단위', 130],
  ['quantity', '수량', 'DETAIL', 'number', '수량', 140],
  ['unit_price', '단가', 'DETAIL', 'amount', '단가', 150],
  ['calculated_unit_price', '계산 단가', 'DETAIL', 'amount', '계산에 사용한 업체별/기준 단가', 155],
  ['supply_amount', '공급가액', 'DETAIL', 'amount', '공급가액', 160],
  ['tax_amount', '세액', 'DETAIL', 'amount', '부가세, 세액', 170],
  ['amount', '금액', 'DETAIL', 'amount', '금액, 합계금액', 180],
  ['price_diff', '차이금액', 'DETAIL', 'amount', '비교 대상 간 차이 금액', 182],
  ['diff_rate', '대비율', 'DETAIL', 'text', '기준 대비율 또는 증감률', 183],
  ['delivery_date', '납기', 'DETAIL', 'date', '납기, 납품일, 예정일', 190],
  ['work_date', '작업일자', 'DETAIL', 'date', '작업일자', 200],
  ['work_content', '작업내용', 'DETAIL', 'text', '작업 내용', 210],
  ['worker_count', '투입인원', 'DETAIL', 'number', '작업 투입 인원', 220],
  ['equipment_name', '장비명', 'DETAIL', 'text', '장비명', 230],
  ['remark', '비고', 'DETAIL', 'text', '비고, 특이사항, 참고사항', 240],
  ['target_name', '비교대상명', 'TARGET', 'text', '업체명, 안, 현장, 부서 등 비교 대상명', 300],
  ['target_type', '비교대상유형', 'TARGET', 'text', '업체, 안, 현장, 부서 등 비교 대상 유형', 310],
  ['target_code', '업체코드', 'TARGET', 'text', '업체 또는 비교대상 코드', 311],
  ['business_no', '사업자번호', 'TARGET', 'text', '업체 사업자등록번호', 312],
  ['contact', '연락처', 'TARGET', 'text', '업체 연락처', 313],
  ['comparison_note', '비교메모', 'COMPARISON_FIELD', 'text', '비교 관련 메모', 320],
  ['rank', '순위', 'COMPARISON_FIELD', 'number', '업체별 가격 순위', 321],
  ['is_lowest', '최저 여부', 'COMPARISON_FIELD', 'text', '해당 업체가 최저가인지 여부', 322],
  ['is_highest', '최고 여부', 'COMPARISON_FIELD', 'text', '해당 업체가 최고가인지 여부', 323],
  ['request_quantity', '요청 수량', 'SUMMARY', 'number', '사용자가 요청한 기준 수량', 395],
  ['selected_vendor', '선택 업체', 'SUMMARY', 'text', '선택 또는 추천된 업체', 396],
  ['total_amount', '총액', 'SUMMARY', 'amount', '총액, 합계', 400],
  ['lowest_target', '최저 대상', 'SUMMARY', 'text', '비교 결과 최저가 또는 최저값 대상', 410],
  ['highest_target', '최고 대상', 'SUMMARY', 'text', '비교 결과 최고가 또는 최고값 대상', 420],
  ['average_price', '평균가격', 'SUMMARY', 'amount', '업체 단가 평균가격', 424],
  ['meeting_date', '회의일자', 'HEADER', 'date', '회의 일자', 245],
  ['attendees', '참석자', 'HEADER', 'text', '회의 참석자', 246],
  ['agenda', '안건', 'DETAIL', 'text', '회의 안건', 247],
  ['decision', '결정사항', 'DETAIL', 'text', '회의 결정사항', 248],
  ['action_item', '조치사항', 'DETAIL', 'text', '후속 조치사항', 249],
  ['owner', '담당자', 'DETAIL', 'text', '조치 담당자', 250],
  ['due_date', '기한', 'DETAIL', 'date', '조치 기한', 251],
  ['recipient', '수신', 'HEADER', 'text', '공문 수신처', 252],
  ['reference', '참조', 'HEADER', 'text', '공문 참조처', 253],
  ['sender', '발신', 'HEADER', 'text', '공문 발신처', 254],
  ['body', '본문', 'DETAIL', 'text', '공문 또는 보고서 본문', 255],
  ['content', '내용', 'DETAIL', 'text', '문서 내용', 256],
  ['summary', '요약', 'SUMMARY', 'text', '보고서 요약', 257],
  ['report_purpose', '보고목적', 'SUMMARY', 'text', '보고서 작성 목적', 2571],
  ['issue_summary', '주요 이슈 및 확인사항', 'SUMMARY', 'text', '보고서 주요 확인사항', 2572],
  ['action_plan', '후속 조치 및 관리계획', 'SUMMARY', 'text', '보고서 후속 조치 계획', 2573],
  ['footer_note', '하단 메모', 'SUMMARY', 'text', '보고서 참고 및 결재 요청 문구', 2574],
  ['meeting_title', '회의록 제목', 'HEADER', 'text', '회의록 제목', 2575],
  ['meeting_place', '회의장소', 'HEADER', 'text', '회의 장소', 2576],
  ['section', '구분', 'DETAIL', 'text', '보고서 섹션 또는 구분', 258],
  ['opinion', '검토의견', 'SUMMARY', 'text', '보고서 검토 의견', 259],
  ['manufacturer', '제조사', 'DETAIL', 'text', '제조사', 260],
  ['model_name', '모델명', 'DETAIL', 'text', '모델명', 261],
  ['supply_condition', '공급조건', 'DETAIL', 'text', '공급 조건', 262],
  ['discount_rate', '할인율', 'DETAIL', 'number', '할인율', 263],
  ['vat_amount', '부가세', 'DETAIL', 'amount', '부가세 금액', 264],
  ['install_cost', '설치비', 'DETAIL', 'amount', '설치 비용', 265],
  ['transport_cost', '운반비', 'DETAIL', 'amount', '운반 비용', 266],
  ['review_status', '확인상태', 'REVIEW', 'text', '정상, 확인 필요 등 상태', 500],
  ['review_message', '확인내용', 'REVIEW', 'text', '확인 필요 사유', 510],
];

const aliases = [
  ['document_title', '문서명', 'CONTAINS', 10], ['document_title', '제목', 'CONTAINS', 20], ['document_title', '자료명', 'CONTAINS', 30], ['document_title', '산출물명', 'CONTAINS', 40],
  ['document_date', '작성일', 'CONTAINS', 10], ['document_date', '일자', 'CONTAINS', 20], ['document_date', '날짜', 'CONTAINS', 30], ['document_date', '기준일', 'CONTAINS', 40], ['document_date', '거래일자', 'CONTAINS', 50], ['document_date', '견적일자', 'CONTAINS', 60],
  ['document_no', '문서번호', 'CONTAINS', 10], ['document_no', '견적번호', 'CONTAINS', 20], ['document_no', '거래번호', 'CONTAINS', 30], ['document_no', '번호', 'CONTAINS', 40],
  ['project_name', '공사명', 'CONTAINS', 10], ['project_name', '프로젝트명', 'CONTAINS', 20], ['project_name', '사업명', 'CONTAINS', 30],
  ['site_name', '현장명', 'CONTAINS', 10], ['site_name', '현장', 'CONTAINS', 20], ['site_name', '공사현장', 'CONTAINS', 30],
  ['vendor_name', '업체명', 'CONTAINS', 10], ['vendor_name', '업체', 'CONTAINS', 20], ['vendor_name', '거래처', 'CONTAINS', 30], ['vendor_name', '공급업체', 'CONTAINS', 40], ['vendor_name', '시공업체', 'CONTAINS', 50], ['vendor_name', '상호', 'CONTAINS', 60], ['vendor_name', '회사명', 'CONTAINS', 70],
  ['item_name', '품목명', 'CONTAINS', 10], ['item_name', '품목', 'CONTAINS', 20], ['item_name', '자재명', 'CONTAINS', 30], ['item_name', '자재', 'CONTAINS', 40], ['item_name', '장비명', 'CONTAINS', 50], ['item_name', '내역명', 'CONTAINS', 60], ['item_name', '공종명', 'CONTAINS', 70], ['item_name', '작업명', 'CONTAINS', 80],
  ['spec', '규격', 'CONTAINS', 10], ['spec', '사양', 'CONTAINS', 20], ['spec', '모델', 'CONTAINS', 30], ['spec', '크기', 'CONTAINS', 40], ['spec', '규격명', 'CONTAINS', 50],
  ['unit', '단위', 'CONTAINS', 10], ['unit', 'UOM', 'CONTAINS', 20],
  ['quantity', '수량', 'EXACT', 5], ['quantity', '수량', 'CONTAINS', 10], ['quantity', '물량', 'CONTAINS', 20], ['quantity', '개수', 'CONTAINS', 30],
  ['unit_price', '단가', 'EXACT', 5], ['unit_price', '단가', 'CONTAINS', 10], ['unit_price', '견적단가', 'CONTAINS', 20], ['unit_price', '단위금액', 'CONTAINS', 30],
  ['amount', '금액', 'EXACT', 5], ['amount', '금액', 'CONTAINS', 10], ['amount', '합계금액', 'CONTAINS', 20], ['amount', '총금액', 'CONTAINS', 30], ['amount', '계', 'EXACT', 40], ['amount', '소계', 'CONTAINS', 50],
  ['supply_amount', '공급가액', 'CONTAINS', 10], ['supply_amount', '공급액', 'CONTAINS', 20], ['supply_amount', '공급금액', 'CONTAINS', 30],
  ['tax_amount', '세액', 'CONTAINS', 10], ['tax_amount', '부가세', 'CONTAINS', 20], ['tax_amount', 'VAT', 'CONTAINS', 30],
  ['delivery_date', '납기', 'CONTAINS', 10], ['delivery_date', '납품일', 'CONTAINS', 20], ['delivery_date', '예정일', 'CONTAINS', 30], ['delivery_date', '납품예정일', 'CONTAINS', 40],
  ['work_date', '작업일자', 'CONTAINS', 10], ['work_date', '작업일', 'CONTAINS', 20], ['work_date', '근무일', 'CONTAINS', 30],
  ['work_content', '작업내용', 'CONTAINS', 10], ['work_content', '작업 사항', 'CONTAINS', 20], ['work_content', '공사내용', 'CONTAINS', 30], ['work_content', '업무내용', 'CONTAINS', 40],
  ['worker_count', '투입인원', 'CONTAINS', 10], ['worker_count', '인원', 'CONTAINS', 20], ['worker_count', '작업인원', 'CONTAINS', 30], ['worker_count', '노무자', 'CONTAINS', 40],
  ['equipment_name', '장비명', 'CONTAINS', 10], ['equipment_name', '장비', 'CONTAINS', 20], ['equipment_name', '투입장비', 'CONTAINS', 30],
  ['remark', '비고', 'CONTAINS', 10], ['remark', '특이사항', 'CONTAINS', 20], ['remark', '참고사항', 'CONTAINS', 30], ['remark', '메모', 'CONTAINS', 40],
  ['target_name', '비교대상', 'CONTAINS', 10], ['target_name', '대상명', 'CONTAINS', 20], ['target_name', '업체명', 'CONTAINS', 30], ['target_name', '회사명', 'CONTAINS', 40], ['target_name', '공급처', 'CONTAINS', 50], ['target_name', 'A안', 'CONTAINS', 60], ['target_name', 'B안', 'CONTAINS', 70],
  ['target_type', '비교유형', 'CONTAINS', 10], ['target_type', '대상유형', 'CONTAINS', 20],
  ['total_amount', '총액', 'CONTAINS', 10], ['total_amount', '합계', 'CONTAINS', 20], ['total_amount', '총금액', 'CONTAINS', 30], ['total_amount', '총 합계', 'CONTAINS', 40],
  ['comparison_basis', '비교기준', 'CONTAINS', 10], ['request_quantity', '요청수량', 'CONTAINS', 10], ['request_quantity', '기준수량', 'CONTAINS', 20],
  ['selected_vendor', '선택업체', 'CONTAINS', 10], ['selected_vendor', '업체선정', 'CONTAINS', 20], ['base_spec', '기준규격', 'CONTAINS', 10], ['base_unit', '기준단위', 'CONTAINS', 10],
  ['calculated_unit_price', '계산단가', 'CONTAINS', 10], ['price_diff', '차이금액', 'CONTAINS', 10], ['price_diff', '차액', 'CONTAINS', 20], ['diff_rate', '대비율', 'CONTAINS', 10],
  ['rank', '순위', 'CONTAINS', 10], ['is_lowest', '최저여부', 'CONTAINS', 10], ['is_highest', '최고여부', 'CONTAINS', 10], ['average_price', '평균가격', 'CONTAINS', 10],
  ['target_code', '업체코드', 'CONTAINS', 10], ['business_no', '사업자번호', 'CONTAINS', 10], ['contact', '연락처', 'CONTAINS', 10],
  ['report_purpose', '보고목적', 'CONTAINS', 10], ['report_purpose', '보고 목적', 'CONTAINS', 20],
  ['issue_summary', '확인사항', 'CONTAINS', 10], ['issue_summary', '주요 이슈', 'CONTAINS', 20], ['issue_summary', '검토의견', 'CONTAINS', 30],
  ['action_plan', '조치계획', 'CONTAINS', 10], ['action_plan', '후속조치', 'CONTAINS', 20], ['action_plan', '관리계획', 'CONTAINS', 30],
  ['footer_note', '하단메모', 'CONTAINS', 10], ['meeting_title', '회의록 제목', 'CONTAINS', 10], ['meeting_place', '회의장소', 'CONTAINS', 10],
];

const systemTemplates = [

  {
    template_name: '견적서 양식 v1', template_code: 'ESTIMATE_FORM_V1', template_type: 'ESTIMATE', file_path: '/storage/templates/estimate_form_v1.xlsx', original_file_name: 'estimate_form_v1.xlsx', default_sheet_name: '견적서', description: '일반 견적서 엑셀 산출 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'ESTIMATE', sheetName: '견적서', layout: 'ESTIMATE_FORM', aiGenerated: true, locked: true }, { template_type: 'ESTIMATE', template_name: '견적서 양식 v1' }),
  },
  {
    template_name: '단가표 양식 v1', template_code: 'UNIT_PRICE_TABLE_V1', template_type: 'UNIT_PRICE_TABLE', file_path: '/storage/templates/unit_price_table_v1.xlsx', original_file_name: 'unit_price_table_v1.xlsx', default_sheet_name: '단가표', description: '단가표, 표준단가표, 가격표 엑셀 산출 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'UNIT_PRICE_TABLE', sheetName: '단가표', layout: 'PRICE_TABLE', aiGenerated: true, locked: true }, { template_type: 'UNIT_PRICE_TABLE', template_name: '단가표 양식 v1' }),
  },
  {
    template_name: '보고서 양식 v1', template_code: 'BUSINESS_REPORT_V1', template_type: 'REPORT', file_path: '/storage/templates/business_report_v1.xlsx', original_file_name: 'business_report_v1.xlsx', default_sheet_name: '보고서', description: '요약과 상세표가 있는 보고서 엑셀 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'REPORT', sheetName: '보고서', layout: 'SECTION_REPORT', aiGenerated: true, locked: true }, { template_type: 'REPORT', template_name: '보고서 양식 v1' }),
  },
  {
    template_name: '회의록 양식 v1', template_code: 'MEETING_MINUTES_V1', template_type: 'MEETING_MINUTES', file_path: '/storage/templates/meeting_minutes_v1.xlsx', original_file_name: 'meeting_minutes_v1.xlsx', default_sheet_name: '회의록', description: '회의 안건, 결정사항, 조치사항 정리 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'MEETING_MINUTES', sheetName: '회의록', layout: 'MEETING_ACTION_TABLE', aiGenerated: true, locked: true }, { template_type: 'MEETING_MINUTES', template_name: '회의록 양식 v1' }),
  },
  {
    template_name: '공문 양식 v1', template_code: 'OFFICIAL_LETTER_V1', template_type: 'OFFICIAL_LETTER', file_path: '/storage/templates/official_letter_v1.xlsx', original_file_name: 'official_letter_v1.xlsx', default_sheet_name: '공문', description: '수신, 참조, 제목, 본문 구조의 공문 엑셀 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'OFFICIAL_LETTER', sheetName: '공문', layout: 'OFFICIAL_LETTER', aiGenerated: true, locked: true }, { template_type: 'OFFICIAL_LETTER', template_name: '공문 양식 v1' }),
  },
  {
    template_name: '일반내역표 v1', template_code: 'NORMAL_TABLE_V1', template_type: 'NORMAL_TABLE', file_path: '/storage/templates/normal_table_v1.xlsx', original_file_name: 'normal_table_v1.xlsx', default_sheet_name: '일반내역표', description: '견적서, 거래명세서, 자재 내역서 등 일반 행 반복 표 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'NORMAL_TABLE', sheetName: '일반내역표', locked: true }, { template_type: 'NORMAL_TABLE', template_name: '일반내역표 v1' }),
  },
  {
    template_name: '비교표 v1', template_code: 'COMPARISON_MATRIX_V1', template_type: 'COMPARISON_MATRIX', file_path: '/storage/templates/comparison_matrix_v1.xlsx', original_file_name: 'comparison_matrix_v1.xlsx', default_sheet_name: '비교표', description: '업체별 단가 비교, 견적 비교, 장비 비교 등 비교 대상 컬럼이 동적으로 늘어나는 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'COMPARISON_MATRIX', sheetName: '비교표', locked: true }, { template_type: 'COMPARISON_MATRIX', template_name: '비교표 v1' }),
  },
  {
    template_name: '작업일보표 v1', template_code: 'WORK_LOG_TABLE_V1', template_type: 'WORK_LOG_TABLE', file_path: '/storage/templates/work_log_table_v1.xlsx', original_file_name: 'work_log_table_v1.xlsx', default_sheet_name: '작업일보', description: '현장 작업일보, 작업내용, 투입인원, 장비 사용 내역을 정리하는 양식',
    mapping_json: ensureTemplateMappingJson({ template_type: 'WORK_LOG_TABLE', sheetName: '작업일보', locked: true }, { template_type: 'WORK_LOG_TABLE', template_name: '작업일보표 v1' }),
  },
];

async function seedMongo() {
  const adminRoleId = await upsertBy(Role, 'roles', { role_code: 'SYSTEM_ADMIN' }, {
    role_code: 'SYSTEM_ADMIN', role_name: '시스템 관리자', description: '사용자 관리, 등록 양식 등록, 템플릿 매핑 관리 권한', active_yn: 'Y',
  });
  const userRoleId = await upsertBy(Role, 'roles', { role_code: 'GENERAL_USER' }, {
    role_code: 'GENERAL_USER', role_name: '일반 사용자', description: '문서 업로드, 문서 분석, 표 생성, 엑셀 다운로드 권한', active_yn: 'Y',
  });

  await upsertBy(User, 'users', { login_id: 'admin' }, {
    role_id: adminRoleId,
    login_id: 'admin',
    password_hash: '$2b$12$qtNUaPEO9yhWOmLn3bLMy.GnxpkGZkSSDhnldpUFGRoxucPtGRDT2',
    user_name: '시스템관리자',
    email: 'admin@example.com',
    department_name: '시스템관리',
    position_name: '관리자',
    status: 'ACTIVE',
  });
  await upsertBy(User, 'users', { login_id: 'user' }, {
    role_id: userRoleId,
    login_id: 'user',
    password_hash: '$2b$12$gLZOTebB2.HsdZZfZm0RA.oCiFkAxWpHiD.mfYa3enlyhrWV68H/i',
    user_name: '일반사용자',
    email: 'user@example.com',
    department_name: '공사팀',
    position_name: '사용자',
    status: 'ACTIVE',
  });

  for (const [field_key, field_label, field_group, data_type, description, sort_order] of standardFields) {
    await upsertBy(StandardField, 'standard_fields', { field_key }, { field_key, field_label, field_group, data_type, description, sort_order, active_yn: 'Y' });
  }

  for (const [field_key, alias_keyword, match_type, priority] of aliases) {
    await upsertBy(FieldAliasKeyword, 'field_alias_keywords', { field_key, alias_keyword }, { field_key, alias_keyword, match_type, priority, active_yn: 'Y' });
  }

  const admin = await User.findOne({ login_id: 'admin' }).lean();
  for (const template of systemTemplates) {
    const mappingJson = template.mapping_json;
    const templateId = await upsertBy(ExcelTemplate, 'excel_templates', { template_code: template.template_code }, {
      created_by: admin?.id || null,
      template_name: template.template_name,
      template_code: template.template_code,
      template_type: template.template_type,
      file_path: template.file_path,
      original_file_name: template.original_file_name,
      default_sheet_name: template.default_sheet_name,
      description: template.description,
      active_yn: 'Y',
    });
    const existingMapping = await ExcelTemplateMapping.findOne({ template_id: templateId, mapping_name: `${template.template_name} 기본 매핑` }).lean();
    if (!existingMapping) {
      await ExcelTemplateMapping.create({
        id: await nextSeq('excel_template_mappings'),
        template_id: templateId,
        created_by: admin?.id || null,
        mapping_name: `${template.template_name} 기본 매핑`,
        mapping_version: 'v1',
        mapping_json: mappingJson,
        active_yn: 'Y',
      });
    } else {
      const mergedMappingJson = ensureTemplateMappingJson(existingMapping.mapping_json || {}, template);
      await ExcelTemplateMapping.updateOne(
        { id: existingMapping.id },
        { $set: { mapping_json: mergedMappingJson, active_yn: 'Y', updated_at: new Date() } }
      );
    }
  }
}

module.exports = { seedMongo };
