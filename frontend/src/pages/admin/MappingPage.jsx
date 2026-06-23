import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Eye, MousePointer2, RefreshCw, Save, Search, Sparkles, Table2, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  getTemplateMappingsApi,
  getTemplatePreviewApi,
  listStandardFieldsApi,
  listTemplatesApi,
  saveTemplateMappingsApi
} from '../../api/templateApi.js';

const GROUP_LABEL = {
  HEADER: '상단 정보',
  DETAIL: '상세 표',
  SUMMARY: '요약 정보',
  TARGET: '비교 대상',
  COMPARISON_FIELD: '비교 항목',
  REVIEW: '검토 정보',
  ETC: '기타'
};

const MAPPING_TYPE_LABEL = {
  SINGLE_CELL: '단일 셀',
  REPEAT_COLUMN: '반복 컬럼',
  REPEAT_ROW: '반복 행',
  COMPANY_GROUP_COLUMN: '업체 반복 컬럼'
};

const DEFAULT_MAPPING_MODES = [
  { value: 'SINGLE_CELL', label: '단일 셀', help: '제목, 작성일처럼 한 번만 들어가는 값' },
  { value: 'REPEAT_COLUMN', label: '반복 컬럼', help: '한 컬럼에 여러 행으로 반복 입력되는 값' }
];

const COMPARISON_MAPPING_MODES = [
  { value: 'SINGLE_CELL', label: '단일 셀', help: '견적일자, 작성자, 기타사항처럼 한 번만 입력' },
  { value: 'REPEAT_ROW', label: '반복 행', help: 'NO, 품목처럼 행 방향으로 반복' },
  { value: 'COMPANY_GROUP_COLUMN', label: '업체 반복', help: 'A/B/C업체처럼 가로 방향으로 반복되는 컬럼 묶음' }
];

const fallbackFields = [
  { fieldKey: 'document_title', fieldLabel: '문서명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', isRequired: false },
  { fieldKey: 'document_date', fieldLabel: '작성일', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', isRequired: false },
  { fieldKey: 'site_name', fieldLabel: '현장명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', isRequired: false },
  { fieldKey: 'vendor_name', fieldLabel: '업체명', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'item_name', fieldLabel: '품목명', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: true },
  { fieldKey: 'spec', fieldLabel: '규격', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'quantity', fieldLabel: '수량', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'unit_price', fieldLabel: '단가', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'amount', fieldLabel: '금액', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: true },
  { fieldKey: 'remark', fieldLabel: '비고', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'total_amount', fieldLabel: '총액', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', isRequired: false }
];

const comparisonEstimateFields = [
  { fieldKey: 'document_title', fieldLabel: '문서명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: 'A2:N2 병합 제목 영역' },
  { fieldKey: 'document_date', fieldLabel: '견적일자', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'date', isRequired: true, guide: 'I4:J4 병합 날짜 영역' },
  { fieldKey: 'requester_name', fieldLabel: '작성자', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: 'M4:N4 병합 작성자 영역' },
  { fieldKey: 'document_no', fieldLabel: '문서번호', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '문서 고유번호' },
  { fieldKey: 'project_name', fieldLabel: '공사명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '공사/프로젝트명' },
  { fieldKey: 'site_name', fieldLabel: '현장명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '현장명' },
  { fieldKey: 'department_name', fieldLabel: '부서명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '작성 부서' },
  { fieldKey: 'comparison_basis', fieldLabel: '비교기준', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '표준단가/견적단가 등' },
  { fieldKey: 'request_quantity', fieldLabel: '요청 수량', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', dataType: 'number', isRequired: false, guide: '사용자가 말한 기준 수량' },
  { fieldKey: 'selected_vendor', fieldLabel: '선택 업체', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '선택/추천 업체' },
  { fieldKey: 'lowest_target', fieldLabel: '최저 대상', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '최저가 업체/대상' },
  { fieldKey: 'highest_target', fieldLabel: '최고 대상', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '최고가 업체/대상' },
  { fieldKey: 'special_note', fieldLabel: '기타사항', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: 'C24:N25 내용 영역' },
  { fieldKey: 'final_opinion', fieldLabel: '최종의견', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: 'C27:N27 병합 의견 영역' },
  { fieldKey: 'review_status', fieldLabel: '확인상태', fieldGroup: 'REVIEW', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '정상/확인필요' },
  { fieldKey: 'review_message', fieldLabel: '확인내용', fieldGroup: 'REVIEW', defaultMappingType: 'SINGLE_CELL', dataType: 'text', isRequired: false, guide: '검토 메시지' },

  { fieldKey: 'row_no', fieldLabel: '순번', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'number', isRequired: false, guide: 'A7:A22' },
  { fieldKey: 'construction_code', fieldLabel: '공종코드', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: false, guide: '공종/품목 코드' },
  { fieldKey: 'item_name', fieldLabel: '품목명', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: true, guide: 'B7:B22' },
  { fieldKey: 'base_spec', fieldLabel: '기준 규격', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: false, guide: '기준자료 규격' },
  { fieldKey: 'base_unit', fieldLabel: '기준 단위', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: false, guide: '기준자료 단위' },
  { fieldKey: 'standard_unit_price', fieldLabel: '기준/표준단가', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'amount', isRequired: false, guide: '표준시장단가 등' },
  { fieldKey: 'quantity', fieldLabel: '요청 수량', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'number', isRequired: false, guide: '사용자 요청 수량' },
  { fieldKey: 'calculated_unit_price', fieldLabel: '계산 단가', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'amount', isRequired: false, guide: '계산에 사용한 단가' },
  { fieldKey: 'calculated_amount', fieldLabel: '산출금액', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'amount', isRequired: false, guide: '단가 × 수량' },
  { fieldKey: 'price_diff', fieldLabel: '차이금액', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'amount', isRequired: false, guide: '비교 차액' },
  { fieldKey: 'diff_rate', fieldLabel: '대비율', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: false, guide: '증감/대비율' },
  { fieldKey: 'source_file', fieldLabel: '원본파일', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: false, guide: '근거 파일명' },
  { fieldKey: 'source_page', fieldLabel: '근거페이지', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'number', isRequired: false, guide: '근거 페이지' },
  { fieldKey: 'remark', fieldLabel: '비고', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_ROW', dataType: 'text', isRequired: false, guide: '비고/주의사항' },

  { fieldKey: 'target_name', fieldLabel: '업체명', fieldGroup: 'TARGET', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: true, guide: 'C5:F5, G5:J5, K5:N5' },
  { fieldKey: 'target_type', fieldLabel: '비교대상유형', fieldGroup: 'TARGET', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: '업체/기준자료/표준단가 등' },
  { fieldKey: 'rank', fieldLabel: '순위', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'number', isRequired: false, guide: '업체별 순위' },
  { fieldKey: 'spec', fieldLabel: '업체별 규격', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: 'C/G/K열' },
  { fieldKey: 'unit', fieldLabel: '업체별 단위', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: '업체별 단위' },
  { fieldKey: 'quantity', fieldLabel: '업체별 수량', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'number', isRequired: false, guide: 'D/H/L열' },
  { fieldKey: 'unit_price', fieldLabel: '업체별 단가', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'amount', isRequired: false, guide: 'E/I/M열' },
  { fieldKey: 'amount', fieldLabel: '업체별 금액', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'amount', isRequired: true, guide: 'F/J/N열' },
  { fieldKey: 'supply_amount', fieldLabel: '공급가액', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'amount', isRequired: false, guide: '업체별 공급가액' },
  { fieldKey: 'tax_amount', fieldLabel: '세액', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'amount', isRequired: false, guide: '업체별 세액' },
  { fieldKey: 'price_diff', fieldLabel: '차이금액', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'amount', isRequired: false, guide: '업체별 차이금액' },
  { fieldKey: 'diff_rate', fieldLabel: '대비율', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: '업체별 대비율' },
  { fieldKey: 'is_lowest', fieldLabel: '최저 여부', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: '최저가 여부' },
  { fieldKey: 'is_highest', fieldLabel: '최고 여부', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: '최고가 여부' },
  { fieldKey: 'comparison_note', fieldLabel: '비교메모', fieldGroup: 'COMPARISON_FIELD', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'text', isRequired: false, guide: '업체별 비교 메모' },
  { fieldKey: 'total_amount', fieldLabel: '업체별 합계', fieldGroup: 'SUMMARY', defaultMappingType: 'COMPANY_GROUP_COLUMN', dataType: 'amount', isRequired: false, guide: 'F23/J23/N23' }
];

const productPriceSurveyFields = comparisonEstimateFields.map((field) => ({
  ...field,
  // 사용자가 요청한 기준: 업체별 제품가격 조사현황표도 비교견적서와 같은 표준필드 세트를 사용한다.
  // 실제 셀 위치/프리셋은 productPriceSurveyPreset에서 템플릿 구조에 맞게 따로 잡는다.
  guide: field.guide || '비교견적서 기준 표준필드'
}));
const productPriceSurveyPreset = [
  { fieldKey: 'document_title', fieldLabel: '문서명', mappingType: 'SINGLE_CELL', sheetName: '', cellAddress: 'A1', mergedRange: 'A1:L1', isRequired: false },
  { fieldKey: 'row_no', fieldLabel: '번호', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'A', startRow: 5, endRow: 19, maxRows: 15, isRequired: false },
  { fieldKey: 'item_name', fieldLabel: '제품명', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'B', startRow: 5, endRow: 19, maxRows: 15, isRequired: true },
  { fieldKey: 'spec', fieldLabel: '규격', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'C', startRow: 5, endRow: 19, maxRows: 15, isRequired: false },
  { fieldKey: 'unit', fieldLabel: '단위', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'D', startRow: 5, endRow: 19, maxRows: 15, isRequired: false },
  { fieldKey: 'average_price', fieldLabel: '평균가격', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'J', startRow: 5, endRow: 19, maxRows: 15, isRequired: false },
  { fieldKey: 'selected_vendor', fieldLabel: '업체선정', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'K', startRow: 5, endRow: 19, maxRows: 15, isRequired: false },
  { fieldKey: 'remark', fieldLabel: '비고', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'L', startRow: 5, endRow: 19, maxRows: 15, isRequired: false },

  { fieldKey: 'target_name', fieldLabel: '업체명', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['E', 'F', 'G', 'H', 'I'], groupRanges: ['E4:E4', 'F4:F4', 'G4:G4', 'H4:H4', 'I4:I4'], startRow: 4, endRow: 4, groupWidth: 1, isRequired: true },
  { fieldKey: 'unit_price', fieldLabel: '업체별 단가', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['E', 'F', 'G', 'H', 'I'], startRow: 5, endRow: 19, maxRows: 15, groupWidth: 1, isRequired: true }
];

const comparisonPreset = [
  { fieldKey: 'document_title', fieldLabel: '문서명', mappingType: 'SINGLE_CELL', sheetName: '', cellAddress: 'A2', mergedRange: 'A2:N2', isRequired: false },
  { fieldKey: 'document_date', fieldLabel: '견적일자', mappingType: 'SINGLE_CELL', sheetName: '', cellAddress: 'I4', mergedRange: 'I4:J4', isRequired: true },
  { fieldKey: 'requester_name', fieldLabel: '작성자', mappingType: 'SINGLE_CELL', sheetName: '', cellAddress: 'M4', mergedRange: 'M4:N4', isRequired: false },
  { fieldKey: 'special_note', fieldLabel: '기타사항', mappingType: 'SINGLE_CELL', sheetName: '', cellAddress: 'C24', mergedRange: 'C24:N25', ranges: ['C24:F25', 'G24:J25', 'K24:N25'], isRequired: false },
  { fieldKey: 'final_opinion', fieldLabel: '최종의견', mappingType: 'SINGLE_CELL', sheetName: '', cellAddress: 'C27', mergedRange: 'C27:N27', isRequired: false },

  { fieldKey: 'row_no', fieldLabel: '순번', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'A', startRow: 7, endRow: 22, maxRows: 16, isRequired: false },
  { fieldKey: 'item_name', fieldLabel: '품목명', mappingType: 'REPEAT_ROW', sheetName: '', columnLetter: 'B', startRow: 7, endRow: 22, maxRows: 16, isRequired: true },

  { fieldKey: 'target_name', fieldLabel: '업체명', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['C', 'G', 'K'], groupRanges: ['C5:F5', 'G5:J5', 'K5:N5'], startRow: 5, endRow: 5, groupWidth: 4, isRequired: true },
  { fieldKey: 'spec', fieldLabel: '업체별 규격', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['C', 'G', 'K'], startRow: 7, endRow: 22, maxRows: 16, groupWidth: 4, isRequired: false },
  { fieldKey: 'quantity', fieldLabel: '업체별 수량', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['D', 'H', 'L'], startRow: 7, endRow: 22, maxRows: 16, groupWidth: 4, isRequired: false },
  { fieldKey: 'unit_price', fieldLabel: '업체별 단가', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['E', 'I', 'M'], startRow: 7, endRow: 22, maxRows: 16, groupWidth: 4, isRequired: false },
  { fieldKey: 'amount', fieldLabel: '업체별 금액', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['F', 'J', 'N'], startRow: 7, endRow: 22, maxRows: 16, groupWidth: 4, isRequired: true },
  { fieldKey: 'total_amount', fieldLabel: '업체별 합계', mappingType: 'COMPANY_GROUP_COLUMN', sheetName: '', columnLetters: ['F', 'J', 'N'], startRow: 23, endRow: 23, maxRows: 1, groupWidth: 4, isRequired: false }
];

function normalizeFields(data) {
  const list = data?.fields || data?.standardFields || data?.data?.fields || [];
  return (Array.isArray(list) && list.length ? list : fallbackFields).map((field) => ({
    fieldKey: field.fieldKey || field.field_key,
    fieldLabel: field.fieldLabel || field.field_label || field.fieldName || field.field_name,
    fieldGroup: field.fieldGroup || field.field_group || 'ETC',
    dataType: field.dataType || field.data_type || 'text',
    defaultMappingType: field.defaultMappingType || field.default_mapping_type || (['HEADER', 'SUMMARY'].includes(field.fieldGroup || field.field_group) ? 'SINGLE_CELL' : 'REPEAT_COLUMN'),
    isRequired: Boolean(field.isRequired ?? field.is_required),
    guide: field.guide || field.description || ''
  })).filter((field) => field.fieldKey);
}

function isComparisonEstimateTemplate(template) {
  const text = [template?.templateName, template?.originalFileName, template?.templateCode, template?.templateType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return text.includes('비교') || text.includes('견적') || text.includes('comparison') || text.includes('estimate') || text.includes('quote');
}

function isProductPriceSurveyTemplate(template) {
  const text = [template?.templateName, template?.originalFileName, template?.templateCode, template?.templateType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    text.includes('업체별') ||
    text.includes('제품가격') ||
    text.includes('제품각력') ||
    text.includes('조사현황') ||
    text.includes('표준현황') ||
    text.includes('표준현황표') ||
    text.includes('가격조사') ||
    text.includes('price survey') ||
    text.includes('vendor price') ||
    text.includes('product price')
  );
}

function colToNumber(letter = '') {
  return String(letter).toUpperCase().split('').reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
}

function parseCellAddress(address = '') {
  const match = String(address).match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return { col: colToNumber(match[1]), row: Number(match[2]), columnLetter: match[1].toUpperCase() };
}

function isAddressInRange(address, range) {
  const [start, end = start] = String(range || '').split(':');
  const a = parseCellAddress(address);
  const s = parseCellAddress(start);
  const e = parseCellAddress(end);
  if (!a || !s || !e) return false;
  return a.row >= Math.min(s.row, e.row) && a.row <= Math.max(s.row, e.row) && a.col >= Math.min(s.col, e.col) && a.col <= Math.max(s.col, e.col);
}

function withSheetName(mapping, sheetName) {
  return { ...mapping, sheetName: sheetName || mapping.sheetName || '' };
}

function makeManualMapping({ selectedField, mappingType, cell, sheetName, isComparisonTemplate, isProductPriceTemplate }) {
  const base = {
    fieldKey: selectedField.fieldKey,
    fieldLabel: selectedField.fieldLabel,
    mappingType,
    sheetName,
    isRequired: selectedField.isRequired || false
  };

  if (mappingType === 'SINGLE_CELL') {
    return {
      ...base,
      cellAddress: cell.address,
      mergedRange: cell.mergedRange || null
    };
  }

  if (mappingType === 'REPEAT_ROW') {
    return {
      ...base,
      columnLetter: cell.columnLetter,
      startRow: cell.row,
      endRow: isComparisonTemplate ? 22 : null,
      maxRows: isComparisonTemplate ? Math.max(1, 22 - Number(cell.row || 7) + 1) : 30,
      repeatDirection: 'DOWN'
    };
  }

  if (mappingType === 'COMPANY_GROUP_COLUMN') {
    const presetSource = isProductPriceTemplate ? productPriceSurveyPreset : comparisonPreset;
    const preset = presetSource.find((item) => item.fieldKey === selectedField.fieldKey);
    if (preset?.columnLetters || preset?.groupRanges) {
      return withSheetName(preset, sheetName);
    }
    return {
      ...base,
      columnLetter: cell.columnLetter,
      columnLetters: [cell.columnLetter],
      startRow: cell.row,
      endRow: isComparisonTemplate ? 22 : null,
      maxRows: isComparisonTemplate ? Math.max(1, 22 - Number(cell.row || 7) + 1) : 30,
      groupWidth: 4,
      repeatDirection: 'DOWN_AND_RIGHT'
    };
  }

  return {
    ...base,
    columnLetter: cell.columnLetter,
    startRow: cell.row,
    maxRows: 30,
    repeatDirection: 'DOWN'
  };
}

function getMappingDisplay(mapping) {
  if (!mapping) return '';
  if (mapping.cellAddress) return mapping.mergedRange || mapping.cellAddress;
  if (Array.isArray(mapping.groupRanges) && mapping.groupRanges.length) return mapping.groupRanges.join(', ');
  if (Array.isArray(mapping.columnLetters) && mapping.columnLetters.length) return `${mapping.columnLetters.join('/')}열`;
  if (mapping.columnLetter) return `${mapping.columnLetter}열`;
  return '매핑됨';
}

export default function MappingPage() {
  const [searchParams] = useSearchParams();
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(searchParams.get('templateId') || '');
  const [sheetName, setSheetName] = useState('');
  const [preview, setPreview] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [fields, setFields] = useState(fallbackFields);
  const [mappingType, setMappingType] = useState('SINGLE_CELL');
  const [selectedFieldKey, setSelectedFieldKey] = useState('');
  const [mappings, setMappings] = useState([]);
  const [zoom, setZoom] = useState(100);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selectedTemplate = useMemo(() => templates.find((item) => String(item.id || item.templateId) === String(selectedTemplateId)), [templates, selectedTemplateId]);
  const isComparisonTemplate = useMemo(() => isComparisonEstimateTemplate(selectedTemplate), [selectedTemplate]);
  const isProductPriceTemplate = useMemo(() => isProductPriceSurveyTemplate(selectedTemplate), [selectedTemplate]);
  const isVendorRepeatTemplate = isComparisonTemplate || isProductPriceTemplate;
  const mappingModes = useMemo(() => (isVendorRepeatTemplate ? COMPARISON_MAPPING_MODES : DEFAULT_MAPPING_MODES), [isVendorRepeatTemplate]);
  const effectiveFields = useMemo(() => {
    if (isProductPriceTemplate) return productPriceSurveyFields;
    if (isComparisonTemplate) return comparisonEstimateFields;
    return fields;
  }, [fields, isComparisonTemplate, isProductPriceTemplate]);
  const selectedField = useMemo(() => effectiveFields.find((field) => field.fieldKey === selectedFieldKey), [effectiveFields, selectedFieldKey]);
  const mappingMap = useMemo(() => Object.fromEntries(mappings.map((item) => [item.fieldKey, item])), [mappings]);
  const mappingCounts = useMemo(() => mappings.reduce((acc, item) => { const key = item.mappingType || 'ETC'; acc[key] = (acc[key] || 0) + 1; return acc; }, {}), [mappings]);

  const visibleFields = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return effectiveFields
      .filter((field) => field.defaultMappingType === mappingType)
      .filter((field) => !q || `${field.fieldLabel} ${field.fieldKey} ${field.guide || ''}`.toLowerCase().includes(q));
  }, [effectiveFields, mappingType, keyword]);

  const groupedFields = useMemo(() => {
    return visibleFields.reduce((acc, field) => {
      const key = field.fieldGroup || 'ETC';
      if (!acc[key]) acc[key] = [];
      acc[key].push(field);
      return acc;
    }, {});
  }, [visibleFields]);

  const loadTemplates = async () => {
    const data = await listTemplatesApi();
    const list = data.templates || [];
    setTemplates(list);
    if (!selectedTemplateId && list.length) setSelectedTemplateId(String(list[0].id || list[0].templateId));
  };

  const loadFields = async () => {
    try {
      const data = await listStandardFieldsApi({ mappingType: mappingType === 'REPEAT_ROW' ? 'REPEAT_COLUMN' : mappingType });
      const normalized = normalizeFields(data);
      setFields(normalized);
    } catch {
      setFields(fallbackFields);
    }
  };

  const loadMappings = async (templateId) => {
    try {
      const data = await getTemplateMappingsApi(templateId);
      setMappings(Array.isArray(data.mappings) ? data.mappings : []);
      if (data.sheetName && !sheetName) setSheetName(data.sheetName);
    } catch {
      setMappings([]);
    }
  };

  const loadPreview = async (templateId, nextSheetName = '') => {
    if (!templateId) return;
    setMessage('');
    try {
      setLoading(true);
      const data = await getTemplatePreviewApi(templateId, { sheetName: nextSheetName || undefined, maxRows: 80, maxCols: 30 });
      setPreview(data.preview || null);
      setSheetNames(data.sheetNames || data.sheet_names || []);
      setSheetName(data.preview?.sheetName || nextSheetName || data.sheetNames?.[0] || '');
    } catch (error) {
      setPreview(null);
      setMessage(error.response?.data?.message || error.response?.data?.detail || '엑셀 미리보기를 불러오지 못했습니다. ai-server에 파일이 저장되어 있는지 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  const loadPage = async () => {
    try {
      setLoading(true);
      await loadTemplates();
      await loadFields();
    } catch (error) {
      setMessage(error.response?.data?.message || '매핑 페이지 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    loadFields();
  }, [mappingType]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    loadMappings(selectedTemplateId);
    loadPreview(selectedTemplateId, sheetName);
  }, [selectedTemplateId]);

  useEffect(() => {
    if (!mappingModes.some((mode) => mode.value === mappingType)) {
      setMappingType(mappingModes[0]?.value || 'SINGLE_CELL');
    }
  }, [mappingModes, mappingType]);

  useEffect(() => {
    if (!visibleFields.length) {
      setSelectedFieldKey('');
      return;
    }
    if (!visibleFields.some((field) => field.fieldKey === selectedFieldKey)) {
      setSelectedFieldKey(visibleFields[0].fieldKey);
    }
  }, [visibleFields, selectedFieldKey]);

  const handleSheetChange = (value) => {
    setSheetName(value);
    loadPreview(selectedTemplateId, value);
  };

  const handleCellClick = (cell) => {
    if (!selectedField) {
      setMessage('먼저 왼쪽에서 표준 필드를 선택하세요.');
      return;
    }

    const next = makeManualMapping({
      selectedField,
      mappingType,
      cell,
      sheetName: preview?.sheetName || sheetName,
      isComparisonTemplate,
      isProductPriceTemplate
    });

    setMappings((prev) => [...prev.filter((item) => item.fieldKey !== selectedField.fieldKey), next]);
    setMessage(`${selectedField.fieldLabel} 필드를 ${MAPPING_TYPE_LABEL[mappingType] || mappingType} 방식으로 ${getMappingDisplay(next)}에 연결했습니다.`);
  };

  const applyTemplatePreset = () => {
    const currentSheetName = preview?.sheetName || sheetName;
    const presetSource = isProductPriceTemplate ? productPriceSurveyPreset : comparisonPreset;
    const presetMappings = presetSource.map((item) => withSheetName(item, currentSheetName));
    const presetKeys = new Set(presetMappings.map((item) => item.fieldKey));
    setMappings((prev) => [...prev.filter((item) => !presetKeys.has(item.fieldKey)), ...presetMappings]);
    setMappingType('COMPANY_GROUP_COLUMN');
    setSelectedFieldKey('target_name');
    setMessage(isProductPriceTemplate
      ? '업체별 제품가격 조사현황표 기본 매핑을 적용했습니다. 제품 행은 아래로 반복되고, 업체 1~5 단가 컬럼은 업체 반복 컬럼으로 저장됩니다.'
      : '비교 견적서 기본 매핑을 적용했습니다. NO/품목은 반복 행, 업체별 규격·수량·단가·금액은 업체 반복 컬럼으로 저장됩니다.');
  };

  const removeMapping = (fieldKey) => {
    setMappings((prev) => prev.filter((item) => item.fieldKey !== fieldKey));
    setMessage('선택한 매핑을 삭제했습니다. 저장 버튼을 눌러야 DB에 반영됩니다.');
  };

  const removeMappingsByType = (type) => {
    setMappings((prev) => prev.filter((item) => item.mappingType !== type));
    setMessage(`${MAPPING_TYPE_LABEL[type] || type} 매핑을 삭제했습니다. 저장 버튼을 눌러야 DB에 반영됩니다.`);
  };

  const clearAllMappings = () => {
    setMappings([]);
    setMessage('전체 매핑을 삭제했습니다. 저장 버튼을 눌러야 DB에 반영됩니다.');
  };

  const saveMappings = async () => {
    if (!selectedTemplateId) return;
    try {
      setSaving(true);
      await saveTemplateMappingsApi(selectedTemplateId, {
        sheetName: preview?.sheetName || sheetName,
        templateKind: isProductPriceTemplate ? 'PRODUCT_PRICE_SURVEY' : (isComparisonTemplate ? 'COMPARISON_ESTIMATE' : 'GENERAL'),
        mappings
      });
      setMessage('매핑이 저장되었습니다.');
    } catch (error) {
      setMessage(error.response?.data?.message || '매핑 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-card md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">엑셀 템플릿 매핑 설정</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">ai-server에 저장된 실제 엑셀 양식을 미리보기로 보면서 셀을 클릭해 표준 필드를 연결합니다.</p>
            {selectedTemplate && (
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-black">
                <span className="text-slate-950">{selectedTemplate.templateName}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">{selectedTemplate.originalFileName || '파일명 없음'}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-100">ai-server 저장</span>
                {isComparisonTemplate && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700 ring-1 ring-sky-100">비교 견적서 구조</span>}
                {isProductPriceTemplate && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700 ring-1 ring-violet-100">업체 반복 가격조사 구조</span>}
              </div>
            )}
          </div>

          <div className="grid w-full gap-2 xl:w-[620px]">
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100">
              <option value="">템플릿 선택</option>
              {templates.map((item) => <option key={item.id || item.templateId} value={item.id || item.templateId}>{item.templateName}</option>)}
            </select>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => loadPreview(selectedTemplateId, sheetName)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-50"><RefreshCw size={15} /> 새로고침</button>
              {isVendorRepeatTemplate && <button onClick={applyTemplatePreset} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-sky-50 px-4 text-xs font-black text-sky-700 ring-1 ring-sky-100 hover:bg-sky-100"><Sparkles size={15} /> {isProductPriceTemplate ? '업체가격조사 프리셋' : '비교견적서 프리셋'}</button>}
              <button onClick={saveMappings} disabled={saving || !mappings.length} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300"><Save size={15} /> {saving ? '저장 중...' : '매핑 저장'}</button>
            </div>
          </div>
        </div>

        {message && (
          <div className={`mt-5 rounded-2xl px-4 py-3 text-sm font-bold ${message.includes('못했습니다') || message.includes('오류') ? 'border border-rose-100 bg-rose-50 text-rose-700' : 'border border-brand-100 bg-brand-50 text-brand-700'}`}>
            {message}
          </div>
        )}

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black text-slate-900">등록된 매핑 {mappings.length}개</p>
              <p className="mt-1 text-xs font-bold text-slate-500">어떤 필드가 어느 셀/열에 연결됐는지 확인하고 개별 삭제할 수 있습니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {mappingModes.map((mode) => (
                <button key={mode.value} type="button" onClick={() => removeMappingsByType(mode.value)} disabled={!mappingCounts[mode.value]} className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-600 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                  {mode.label} {mappingCounts[mode.value] || 0}개 삭제
                </button>
              ))}
              <button type="button" onClick={clearAllMappings} disabled={!mappings.length} className="inline-flex items-center gap-1 rounded-2xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 disabled:opacity-40"><Trash2 size={14} /> 전체 삭제</button>
            </div>
          </div>
          <div className="scroll-thin mt-3 flex gap-2 overflow-x-auto pb-1">
            {mappings.map((mapping) => (
              <span key={mapping.fieldKey} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                <span className="text-brand-700">{mapping.fieldLabel || mapping.fieldKey}</span>
                <span className="text-slate-400">{MAPPING_TYPE_LABEL[mapping.mappingType] || mapping.mappingType}</span>
                <span className="text-emerald-700">{getMappingDisplay(mapping)}</span>
                <button type="button" onClick={() => removeMapping(mapping.fieldKey)} className="rounded-full p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X size={13} /></button>
              </span>
            ))}
            {!mappings.length && <span className="rounded-full bg-white px-3 py-2 text-xs font-bold text-slate-400 ring-1 ring-slate-200">아직 등록된 매핑 없음</span>}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-card xl:sticky xl:top-[88px] xl:max-h-[calc(100vh-110px)] xl:overflow-y-auto scroll-thin">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">표준 필드</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">필드를 선택한 뒤 엑셀 셀을 클릭하세요.</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-black text-brand-700 ring-1 ring-brand-100">{visibleFields.length}개</span>
          </div>

          {isVendorRepeatTemplate && (
            <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-bold leading-5 text-sky-800">
              이 양식은 단순한 반복 컬럼이 아니라 <b>품목 행 반복</b>과 <b>업체별 가로 컬럼 반복</b>이 같이 있는 구조입니다.
              {isProductPriceTemplate && <span className="mt-1 block">표준 필드는 비교견적서와 같은 세트를 사용하고, 업체 1~5 단가 영역만 이 양식 위치에 맞게 <b>업체 반복</b>으로 매핑하세요.</span>}
            </div>
          )}

          <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 grid gap-2 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200" style={{ gridTemplateColumns: `repeat(${mappingModes.length}, minmax(0, 1fr))` }}>
              {mappingModes.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setMappingType(mode.value)}
                  title={mode.help}
                  className={`min-h-[44px] rounded-xl px-2 text-xs font-black leading-4 transition sm:text-sm ${mappingType === mode.value ? 'bg-brand-500 text-white shadow-glow' : 'text-slate-500 hover:bg-brand-50 hover:text-brand-700'}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 focus-within:border-brand-500">
              <Search size={16} className="text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="필드명 검색" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-slate-400" />
            </label>
            <p className="mt-3 text-[11px] font-bold leading-5 text-slate-500">{mappingModes.find((mode) => mode.value === mappingType)?.help}</p>
          </div>

          <div className="mt-5 space-y-5">
            {Object.entries(groupedFields).map(([group, list]) => (
              <div key={group}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-black text-slate-950">{GROUP_LABEL[group] || group}</p>
                  <p className="text-xs font-black text-slate-400">{list.length}개</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-2">
                  {list.map((field) => {
                    const selected = selectedFieldKey === field.fieldKey;
                    const mapped = mappingMap[field.fieldKey];
                    return (
                      <button
                        type="button"
                        key={field.fieldKey}
                        onClick={() => setSelectedFieldKey(field.fieldKey)}
                        className={`min-h-[104px] rounded-[20px] border p-3 text-left transition ${selected ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-100' : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">{field.fieldLabel}</p>
                            <p className="mt-1 truncate text-[11px] font-bold text-slate-400">{field.fieldKey}</p>
                          </div>
                          {mapped && <Check size={16} className="shrink-0 text-emerald-600" />}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{field.fieldGroup}</span>
                          {field.isRequired && <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-600">필수</span>}
                          {mapped && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{getMappingDisplay(mapped)}</span>}
                        </div>
                        {field.guide && <p className="mt-2 truncate text-[11px] font-bold text-slate-400">권장: {field.guide}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-card">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Eye size={17} className="text-brand-600" />
              <h3 className="text-base font-black text-slate-950">엑셀 미리보기</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={sheetName} onChange={(e) => handleSheetChange(e.target.value)} className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-brand-500">
                {sheetNames.length ? sheetNames.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">Sheet</option>}
              </select>
              <div className="flex h-10 items-center overflow-hidden rounded-2xl bg-slate-100">
                <button onClick={() => setZoom((z) => Math.max(50, z - 10))} className="flex h-10 w-10 items-center justify-center text-slate-600"><ZoomOut size={16} /></button>
                <span className="w-16 text-center text-sm font-black text-slate-800">{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(180, z + 10))} className="flex h-10 w-10 items-center justify-center text-slate-600"><ZoomIn size={16} /></button>
              </div>
              <span className="inline-flex h-10 items-center gap-2 rounded-2xl bg-brand-50 px-4 text-xs font-black text-brand-700 ring-1 ring-brand-100"><MousePointer2 size={15} /> 셀 클릭</span>
            </div>
          </div>

          <div className="p-5">
            {loading && <div className="flex min-h-[520px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm font-black text-slate-400">엑셀 미리보기를 불러오는 중입니다.</div>}
            {!loading && !preview && <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 text-center"><Table2 className="text-slate-400" size={34} /><p className="mt-3 text-sm font-black text-slate-600">템플릿을 선택하면 실제 엑셀 미리보기가 표시됩니다.</p><p className="mt-1 text-xs font-semibold text-slate-400">파일은 ai-server 저장소 기준으로 조회합니다.</p></div>}
            {!loading && preview && <ExcelPreviewGrid preview={preview} zoom={zoom} onCellClick={handleCellClick} mappings={mappings} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function ExcelPreviewGrid({ preview, zoom, onCellClick, mappings }) {
  const mappedRules = useMemo(() => mappings || [], [mappings]);

  const scale = zoom / 100;
  const columns = preview.columns || [];
  const rows = preview.rows || [];

  const isMappedCell = (cell) => {
    return mappedRules.some((mapping) => {
      if (mapping.cellAddress && cell.address === mapping.cellAddress) return true;
      if (mapping.mergedRange && (cell.mergedRange === mapping.mergedRange || isAddressInRange(cell.address, mapping.mergedRange))) return true;
      if (Array.isArray(mapping.ranges) && mapping.ranges.some((range) => isAddressInRange(cell.address, range))) return true;
      if (Array.isArray(mapping.groupRanges) && mapping.groupRanges.some((range) => cell.mergedRange === range || isAddressInRange(cell.address, range))) return true;

      const mappingColumns = Array.isArray(mapping.columnLetters) && mapping.columnLetters.length
        ? mapping.columnLetters
        : mapping.columnLetter
          ? [mapping.columnLetter]
          : [];
      if (!mappingColumns.includes(cell.columnLetter)) return false;

      const startRow = Number(mapping.startRow || 1);
      const endRow = mapping.endRow ? Number(mapping.endRow) : null;
      const rowNumber = Number(cell.row || 0);
      if (rowNumber < startRow) return false;
      if (endRow && rowNumber > endRow) return false;
      return true;
    });
  };

  const getCellTextClass = (cell) => {
    const whiteSpace = cell.style?.whiteSpace || 'nowrap';
    if (whiteSpace === 'normal') {
      return 'block break-words leading-snug';
    }
    return 'block truncate';
  };

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-100 p-3">
      <div className="max-h-[68vh] overflow-auto rounded-2xl bg-white shadow-inner scroll-thin">
        <div className="inline-block min-w-full p-2" style={{ transformOrigin: 'top left' }}>
          <table className="border-collapse bg-white text-xs" style={{ fontSize: `${12 * scale}px` }}>
            <colgroup>
              <col style={{ width: 46 * scale }} />
              {columns.map((col) => (
                <col
                  key={col.letter}
                  style={{
                    width: (col.widthPx || 80) * scale,
                    display: col.hidden ? 'none' : undefined
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border border-slate-300 bg-slate-200 text-slate-500" style={{ height: 28 * scale }} />
                {columns.map((col) => (
                  <th
                    key={col.letter}
                    className="sticky top-0 z-10 border border-slate-300 bg-slate-200 text-center font-black text-slate-600"
                    style={{ height: 28 * scale, display: col.hidden ? 'none' : undefined }}
                  >
                    {col.letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.hidden) return null;
                return (
                  <tr key={row.rowNumber} style={{ height: (row.heightPx || 28) * scale }}>
                    <th className="sticky left-0 z-10 border border-slate-300 bg-slate-200 px-2 text-center font-black text-slate-500">
                      {row.rowNumber}
                    </th>
                    {(row.cells || []).map((cell) => {
                      if (cell.isMergedHidden) return null;
                      const mapped = isMappedCell(cell);
                      const style = cell.style || {};
                      return (
                        <td
                          key={cell.address}
                          rowSpan={cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined}
                          colSpan={cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined}
                          onClick={() => onCellClick(cell)}
                          title={`${cell.address}${cell.mergedRange ? ` (${cell.mergedRange})` : ''} ${cell.text || ''}`}
                          className={`cursor-pointer overflow-hidden px-2 py-1 align-middle transition hover:relative hover:z-10 hover:ring-2 hover:ring-brand-500 ${mapped ? 'ring-2 ring-emerald-500' : ''}`}
                          style={{
                            backgroundColor: mapped ? '#ecfdf5' : style.backgroundColor || '#ffffff',
                            color: style.color || '#0f172a',
                            fontWeight: style.fontWeight || 500,
                            fontStyle: style.italic ? 'italic' : 'normal',
                            textDecoration: style.underline ? 'underline' : 'none',
                            fontFamily: style.fontFamily || undefined,
                            fontSize: `${Math.max(9, (style.fontSize || 11) * scale)}px`,
                            textAlign: style.textAlign || 'center',
                            verticalAlign: style.verticalAlign || 'middle',
                            borderTop: style.borderTop || '1px solid #e2e8f0',
                            borderRight: style.borderRight || '1px solid #e2e8f0',
                            borderBottom: style.borderBottom || '1px solid #e2e8f0',
                            borderLeft: style.borderLeft || '1px solid #e2e8f0',
                            whiteSpace: style.whiteSpace || 'nowrap',
                            minWidth: 50 * scale,
                            maxWidth: cell.colSpan && cell.colSpan > 1 ? 520 * scale : 260 * scale
                          }}
                        >
                          {mapped && (
                            <span className="mb-1 inline-flex max-w-full rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[9px] font-black leading-none text-white">
                              {mappedRules.filter((mapping) => {
                                if (mapping.cellAddress && cell.address === mapping.cellAddress) return true;
                                if (mapping.mergedRange && (cell.mergedRange === mapping.mergedRange || isAddressInRange(cell.address, mapping.mergedRange))) return true;
                                if (Array.isArray(mapping.groupRanges) && mapping.groupRanges.some((range) => cell.mergedRange === range || isAddressInRange(cell.address, range))) return true;
                                const cols = Array.isArray(mapping.columnLetters) ? mapping.columnLetters : (mapping.columnLetter ? [mapping.columnLetter] : []);
                                return cols.includes(cell.columnLetter) && Number(cell.row || 0) >= Number(mapping.startRow || 1) && (!mapping.endRow || Number(cell.row || 0) <= Number(mapping.endRow));
                              }).slice(0, 1).map((m) => m.fieldLabel || m.fieldKey).join(', ')}
                            </span>
                          )}
                          <span className={getCellTextClass(cell)}>{cell.text}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {Array.isArray(preview.mergedCells) && preview.mergedCells.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">병합 셀 {preview.mergedCells.length}개 반영</span>
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">원본 행/열 높이·너비 반영</span>
        </div>
      )}
    </div>
  );
}
