const LAYOUT_REGISTRY = [
  {
    layoutType: 'VENDOR_COMPARISON_REVIEW_FORM',
    designId: 'VENDOR_COMPARE_REVIEW_FORM_V1',
    name: '업체별 단가 비교 검토보고서',
    documentKind: '비교검토보고서',
    title: '업체별 단가 비교 검토보고서',
    family: 'COMPARE_REPORT',
    scoreBase: 94,
    keywords: ['업체별', '단가 비교', '단가비교', '비교 검토보고서', '검토보고서', '표준시장단가', '최저가', '최고가', '총괄 비교 결과', '문장형', '텍스트 전용', '서술형'],
    reason: '표가 없는 서술형 비교 문서의 핵심 비교 결과, 업체별 금액, 검토 의견, 확인 필요 사항을 보고서 형태로 정리합니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'PURPOSE', 'EXECUTIVE_SUMMARY', 'VENDOR_SUMMARY', 'KEY_FINDINGS', 'REVIEW_OPINION', 'ACTION_PLAN', 'APPROVAL_BOX'],
  },
  {
    layoutType: 'VENDOR_COMPARISON_TABLE',
    designId: 'VENDOR_COMPARE_V1',
    name: '업체별 단가 비교표',
    documentKind: '업체비교표',
    title: '업체별 단가 비교표',
    family: 'COMPARE_TABLE',
    scoreBase: 92,
    keywords: ['업체별', '회사별', '비교견적', '견적비교', '단가 비교', '단가비교', '가격비교', '최저가', '최고가', '견적서', '비교표', '업체 견적', '표준시장단가'],
    reason: '업체별 단가·금액을 비교하는 문서에 적합합니다. 원문이 문장형이면 업체명·금액·차이율을 문장 기반으로 추출해 표로 정리합니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'COMPARISON_TABLE', 'REVIEW_OPINION'],
  },
  {
    layoutType: 'ESTIMATE_REVIEW_FORM',
    designId: 'ESTIMATE_FORM_V1',
    name: '견적 검토서',
    documentKind: '견적검토서',
    title: '견적 검토서',
    family: 'ESTIMATE',
    scoreBase: 82,
    keywords: ['견적서', '견적', '공급가', '합계', '거래조건', '납기', '견적 검토'],
    reason: '견적 기본정보, 세부 내역, 합계, 검토 의견을 함께 정리하는 견적 검토 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'DETAIL_TABLE', 'COST_SUMMARY', 'REVIEW_OPINION'],
  },
  {
    layoutType: 'PRICE_SURVEY_TABLE',
    designId: 'PRICE_TABLE_V1',
    name: '단가 조사표',
    documentKind: '단가표',
    title: '단가 조사표',
    family: 'PRICE_TABLE',
    scoreBase: 80,
    keywords: ['단가표', '표준시장단가표', '공종단가표', '가격표', '단가 조사', '공종코드', '노무비율'],
    reason: '공종코드, 품명, 규격, 단위, 단가가 행/열 구조로 있는 자료를 정리하는 단가 조사 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'PRICE_TABLE', 'ATTACHMENT_NOTE'],
  },
  {
    layoutType: 'REPORT_FORM',
    designId: 'REPORT_FORM_V1',
    name: '업무 보고서',
    documentKind: '보고서',
    title: '업무 보고서',
    family: 'REPORT',
    scoreBase: 78,
    keywords: ['보고서', '보고', '검토', '현황', '요약', '분석', '결과'],
    reason: '보고 목적, 주요 검토 내용, 검토 결과, 후속 조치를 균형 있게 배치하는 서술형 보고서 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'PURPOSE', 'EXECUTIVE_SUMMARY', 'KEY_FINDINGS', 'REVIEW_OPINION', 'ACTION_PLAN', 'APPROVAL_BOX'],
  },
  {
    layoutType: 'REVIEW_OPINION_FORM',
    designId: 'REVIEW_OPINION_FORM_V1',
    name: '검토 의견서',
    documentKind: '검토의견서',
    title: '검토 의견서',
    family: 'REPORT',
    scoreBase: 74,
    keywords: ['검토의견', '검토', '의견', '확인', '적정', '부적정', '보완', '재확인'],
    reason: '검토 결과와 보완 필요사항을 핵심 위주로 정리하는 내부 검토용 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'KEY_FINDINGS', 'ISSUES', 'REVIEW_OPINION', 'ACTION_PLAN'],
  },
  {
    layoutType: 'INSPECTION_REPORT',
    designId: 'INSPECTION_REPORT_V1',
    name: '현장 점검 보고서',
    documentKind: '점검보고서',
    title: '현장 점검 보고서',
    family: 'INSPECTION',
    scoreBase: 72,
    keywords: ['현장 점검', '점검보고서', '안전점검', '감리 점검', '하자 점검', '시정조치', '현장 확인'],
    reason: '점검 개요, 주요 확인사항, 문제점, 조치 계획을 중심으로 정리하는 회사 보고서 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'INSPECTION_SUMMARY', 'KEY_FINDINGS', 'ISSUES', 'ACTION_PLAN', 'APPROVAL_BOX'],
  },
  {
    layoutType: 'MEETING_MINUTES',
    designId: 'MEETING_MINUTES_V1',
    name: '회의록',
    documentKind: '회의록',
    title: '회의록',
    family: 'MEETING',
    scoreBase: 76,
    keywords: ['회의록', '회의', '안건', '참석자', '결정사항', '조치사항', '담당자'],
    reason: '회의 개요, 안건, 결정사항, 후속 조치와 담당자를 분리해 관리하는 회의록 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'MEETING_INFO', 'AGENDA', 'DISCUSSION', 'DECISIONS', 'ACTION_ITEMS'],
  },
  {
    layoutType: 'OFFICIAL_LETTER',
    designId: 'OFFICIAL_LETTER_V1',
    name: '공문',
    documentKind: '공문',
    title: '공문',
    family: 'OFFICIAL',
    scoreBase: 74,
    keywords: ['공문', '수신', '참조', '시행', '발신', '회신', '제출', '붙임'],
    reason: '수신/참조/제목/본문/붙임 구조를 갖춘 대외·대내 공문 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'RECIPIENT_INFO', 'SUBJECT', 'BODY', 'ATTACHMENT_NOTE', 'SENDER'],
  },
  {
    layoutType: 'WORK_DAILY_REPORT',
    designId: 'WORK_DAILY_REPORT_V1',
    name: '작업일보',
    documentKind: '작업일보',
    title: '작업일보',
    family: 'WORK_LOG',
    scoreBase: 72,
    keywords: ['작업일보', '작업내용', '투입인원', '장비', '금일작업', '명일작업'],
    reason: '일일 작업내용, 인원, 장비, 특이사항을 정리하는 현장 업무 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'PROJECT_INFO', 'CURRENT_STATUS', 'DETAIL_TABLE', 'ISSUES', 'ACTION_PLAN'],
  },
  {
    layoutType: 'BASIC_TABLE',
    designId: 'BASIC_TABLE_V1',
    name: '기본 표 양식',
    documentKind: '일반표',
    title: '데이터 정리표',
    family: 'BASIC',
    scoreBase: 55,
    keywords: ['표', '목록', '내역', '데이터'],
    reason: '문서 유형이 불명확할 때 원본 데이터를 안전하게 편집하는 기본 표 양식입니다.',
    sections: ['DOCUMENT_HEADER', 'DETAIL_TABLE'],
  },
];

function normalizeLayoutForRenderer(layoutType = '') {
  const layout = String(layoutType || '').toUpperCase();
  if (layout === 'VENDOR_COMPARISON_TABLE') return 'AI_GENERATED_DYNAMIC_VENDOR_TABLE';
  if (layout === 'PRICE_SURVEY_TABLE') return 'PRICE_TABLE';
  if (layout === 'ESTIMATE_REVIEW_FORM') return 'ESTIMATE_FORM';
  if (['VENDOR_COMPARISON_REVIEW_FORM', 'INSPECTION_REPORT', 'REVIEW_OPINION_FORM', 'WORK_DAILY_REPORT'].includes(layout)) return 'REPORT_FORM';
  return layout || 'BASIC_TABLE';
}

function hasMeaningfulContext(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/대기|아직 분석된 문서|문서 분석 대기|파일 분석 후/i.test(raw)) return false;
  return raw.length >= 8;
}

function compact(text = '') {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}

function includesAny(text = '', patterns = []) {
  const raw = String(text || '').toLowerCase();
  const packed = compact(text);
  return patterns.some((pattern) => {
    const token = String(pattern || '').toLowerCase();
    return raw.includes(token) || packed.includes(token.replace(/\s+/g, ''));
  });
}

function familyOf(layoutType = '') {
  return (LAYOUT_REGISTRY.find((item) => item.layoutType === layoutType) || {}).family || 'BASIC';
}


function inferUserOutputIntent(text = '') {
  const raw = String(text || '');
  const wantsReport = includesAny(raw, [
    '보고서 형식', '보고서 형태', '보고서로', '업무보고서', '업무 보고서', '검토보고서', '검토 보고서',
    '보고서', '보고 형식', '보고 형태', '서술형', '문장형', '본문형', '핵심 내용', '보고용'
  ]);
  const wantsTable = includesAny(raw, [
    '표로', '표 형태', '표 형식', '표 양식', '표만', '비교표', '단가표', '조사표',
    '테이블', '그리드', '엑셀 표', '표 정리', '표 만들어', '표 생성'
  ]);

  // 사용자가 보고서와 표를 같이 언급했더라도, "표로/비교표/단가표"처럼 표 산출을 직접 지시한 경우만 TABLE로 본다.
  // 단순히 원문/분석 결과에 "표"라는 단어가 들어간 것 때문에 보고서 요청이 표 후보로 밀리지 않게 한다.
  if (wantsTable && !wantsReport) return 'TABLE';
  if (wantsTable && /표로|비교표|단가표|조사표|테이블|그리드|엑셀\s*표|표\s*(정리|생성|만들)/i.test(raw)) return 'TABLE';
  if (wantsReport) return 'REPORT';
  return 'AUTO';
}

const TABLE_ONLY_LAYOUTS = new Set(['VENDOR_COMPARISON_TABLE', 'PRICE_SURVEY_TABLE', 'BASIC_TABLE']);
const REPORT_COMPATIBLE_LAYOUTS = new Set([
  'REPORT_FORM',
  'REVIEW_OPINION_FORM',
  'INSPECTION_REPORT',
  'VENDOR_COMPARISON_REVIEW_FORM',
]);
const TABLE_COMPATIBLE_LAYOUTS = new Set([
  'VENDOR_COMPARISON_TABLE',
  'PRICE_SURVEY_TABLE',
  'BASIC_TABLE',
]);

function isLayoutAllowedForIntent(layoutType = '', intent = 'AUTO', text = '') {
  const layout = String(layoutType || '').toUpperCase();
  const ctx = analyzeContext(text);

  if (intent === 'REPORT') {
    // 보고서 요청에서는 표 전용 후보를 후보군에서 제외한다.
    if (TABLE_ONLY_LAYOUTS.has(layout)) return false;
    if (REPORT_COMPATIBLE_LAYOUTS.has(layout)) return true;
    if (layout === 'MEETING_MINUTES') return ctx.hasMeeting;
    if (layout === 'OFFICIAL_LETTER') return ctx.hasOfficial;
    if (layout === 'WORK_DAILY_REPORT') return includesAny(text, ['작업일보', '작업내용', '금일작업', '명일작업']);
    return false;
  }

  if (intent === 'TABLE') {
    // 표 요청에서는 보고서/공문/회의록 후보를 섞지 않는다.
    return TABLE_COMPATIBLE_LAYOUTS.has(layout) || layout === 'ESTIMATE_REVIEW_FORM';
  }

  return true;
}

function analyzeContext(text = '') {
  const raw = String(text || '');
  const upper = raw.toUpperCase();
  const hasMeeting = upper.includes('MEETING') || includesAny(raw, ['회의록', '회의', '안건', '참석자', '결정사항']);
  const hasOfficial = upper.includes('OFFICIAL') || includesAny(raw, ['공문', '수신', '참조', '시행', '발신', '회신']);
  const hasCompare = includesAny(raw, ['업체별', '회사별', '업체 견적', '견적 수준', '비교견적', '견적비교', '단가 비교', '단가비교', '가격비교', '비교 결과', '최저가', '최고가']);
  const hasUnitPrice = includesAny(raw, ['표준시장단가', '공종코드', '단가', '견적금액', '총 견적금액']);
  const hasReport = includesAny(raw, ['보고서', '검토보고서', '보고', 'report', '서술형', '문장형', '텍스트 전용', '검토 의견']);
  const hasRealTable = includesAny(raw, ['표 후보', '비교표', '표 구조', 'row', 'column', '행', '열', '컬럼']);
  const hasInspection = includesAny(raw, ['현장 점검', '점검보고서', '안전점검', '감리 점검', '하자 점검', '시정조치']);
  const userIntent = inferUserOutputIntent(raw);
  return { raw, upper, hasMeeting, hasOfficial, hasCompare, hasUnitPrice, hasReport, hasRealTable, hasInspection, userIntent };
}

function inferMainLayoutType(text = '', explicitIntent = 'AUTO', userRequest = '') {
  const ctx = analyzeContext(text);
  const requestText = String(userRequest || '');

  if (ctx.hasMeeting && includesAny(requestText || text, ['회의록', '회의록 형식'])) return 'MEETING_MINUTES';
  if (ctx.hasOfficial && includesAny(requestText || text, ['공문', '공문 형식'])) return 'OFFICIAL_LETTER';

  if (explicitIntent === 'REPORT') {
    if (ctx.hasInspection && includesAny(requestText, ['점검 보고서', '현장 점검 보고서'])) return 'INSPECTION_REPORT';
    if (ctx.hasCompare && includesAny(requestText, ['비교 검토보고서', '업체별 단가 비교 검토보고서'])) return 'VENDOR_COMPARISON_REVIEW_FORM';
    return 'REPORT_FORM';
  }

  if (explicitIntent === 'TABLE') {
    if (ctx.hasCompare) return 'VENDOR_COMPARISON_TABLE';
    if (ctx.hasUnitPrice || includesAny(text, ['단가표', '표준시장단가표', '공종단가표', '노무비율'])) return 'PRICE_SURVEY_TABLE';
    return 'BASIC_TABLE';
  }

  if (ctx.hasCompare && ctx.hasUnitPrice) {
    return ctx.hasReport || !ctx.hasRealTable ? 'VENDOR_COMPARISON_REVIEW_FORM' : 'VENDOR_COMPARISON_TABLE';
  }
  if (ctx.hasCompare) return ctx.hasRealTable ? 'VENDOR_COMPARISON_TABLE' : 'VENDOR_COMPARISON_REVIEW_FORM';
  if (includesAny(text, ['단가표', '표준시장단가표', '공종단가표', '노무비율'])) return 'PRICE_SURVEY_TABLE';
  if (ctx.hasInspection) return 'INSPECTION_REPORT';
  if (ctx.hasReport) return 'REPORT_FORM';
  return 'BASIC_TABLE';
}

function matchedKeywordCount(layout, text = '') {
  return (layout.keywords || []).filter((keyword) => includesAny(text, [keyword])).length;
}

function explicitIntentScore(layoutType = '', ctx = {}, intent = 'AUTO', mainType = '') {
  if (intent === 'REPORT') {
    const map = {
      REPORT_FORM: mainType === 'REPORT_FORM' ? 88 : 82,
      REVIEW_OPINION_FORM: 80,
      INSPECTION_REPORT: ctx.hasInspection ? 86 : 58,
      VENDOR_COMPARISON_REVIEW_FORM: mainType === 'VENDOR_COMPARISON_REVIEW_FORM' ? 88 : (ctx.hasCompare ? 74 : 56),
      MEETING_MINUTES: ctx.hasMeeting ? 82 : 20,
      OFFICIAL_LETTER: ctx.hasOfficial ? 82 : 20,
      WORK_DAILY_REPORT: 54,
    };
    return map[layoutType] ?? 18;
  }

  if (intent === 'TABLE') {
    const map = {
      VENDOR_COMPARISON_TABLE: ctx.hasCompare ? 88 : 64,
      PRICE_SURVEY_TABLE: ctx.hasUnitPrice ? 82 : 62,
      BASIC_TABLE: 66,
      ESTIMATE_REVIEW_FORM: 60,
    };
    return map[layoutType] ?? 18;
  }

  return null;
}

function compareScores(layoutType = '', ctx = {}, mainType = '', explicitIntent = 'AUTO') {
  const explicitScore = explicitIntentScore(layoutType, ctx, explicitIntent, mainType);
  if (explicitScore !== null) return explicitScore;

  if (mainType === 'VENDOR_COMPARISON_TABLE') {
    const map = {
      VENDOR_COMPARISON_TABLE: 88,
      VENDOR_COMPARISON_REVIEW_FORM: 76,
      ESTIMATE_REVIEW_FORM: 70,
      PRICE_SURVEY_TABLE: 68,
      REPORT_FORM: 58,
      REVIEW_OPINION_FORM: 54,
      BASIC_TABLE: 52,
    };
    return map[layoutType] ?? 22;
  }
  if (mainType === 'VENDOR_COMPARISON_REVIEW_FORM') {
    const map = {
      VENDOR_COMPARISON_REVIEW_FORM: 88,
      REPORT_FORM: 78,
      REVIEW_OPINION_FORM: 74,
      VENDOR_COMPARISON_TABLE: 64,
      ESTIMATE_REVIEW_FORM: 62,
      PRICE_SURVEY_TABLE: 58,
      BASIC_TABLE: 48,
    };
    return map[layoutType] ?? 22;
  }
  return null;
}

function scoreLayoutAgainstText(layout, text = '', mainType = '', explicitIntent = 'AUTO') {
  const ctx = analyzeContext(text);
  const layoutType = layout.layoutType;
  const matched = matchedKeywordCount(layout, text);
  const compareScore = compareScores(layoutType, ctx, mainType, explicitIntent);
  if (compareScore !== null) return Math.max(18, Math.min(90, compareScore + Math.min(2, matched)));

  let base = 32;
  const mainFamily = familyOf(mainType);
  const candFamily = familyOf(layoutType);
  if (mainType === layoutType) base = 86;
  else if (mainFamily === candFamily && mainFamily !== 'BASIC') base = 72;
  else if (matched >= 2) base = 56;
  else if (matched === 1) base = 44;

  if (ctx.hasInspection && layoutType === 'INSPECTION_REPORT') base = Math.max(base, 84);
  if (!ctx.hasInspection && layoutType === 'INSPECTION_REPORT') base = Math.min(base, 34);
  if (!ctx.hasMeeting && layoutType === 'MEETING_MINUTES') base = Math.min(base, 24);
  if (!ctx.hasOfficial && layoutType === 'OFFICIAL_LETTER') base = Math.min(base, 24);

  const score = Math.round(base + Math.min(4, matched));
  return Math.max(18, Math.min(90, score));
}

function buildReason(layout, score, text = '', mainType = '', explicitIntent = 'AUTO') {
  if (explicitIntent === 'REPORT' && TABLE_ONLY_LAYOUTS.has(layout.layoutType)) return `${layout.reason} 보고서 요청에서는 표 전용 후보로 제외됩니다.`;
  if (layout.layoutType === 'VENDOR_COMPARISON_TABLE' && mainType === 'VENDOR_COMPARISON_TABLE') {
    const suffix = analyzeContext(text).hasRealTable ? '' : ' 원문이 표가 아닌 문장형이면 문장 기반으로 업체명·금액·차이율을 추출합니다.';
    return `${layout.reason}${suffix}`;
  }
  if (score < 45) return `${layout.reason} 현재 문서와 직접 적합도는 낮습니다.`;
  return layout.reason;
}

function buildLayoutCandidates({ analysis = {}, table = {}, userRequest = '' } = {}) {
  const text = [
    analysis.documentType,
    analysis.document_type,
    analysis.purpose,
    analysis.summary,
    analysis.businessPurpose,
    analysis.business_purpose,
    table.tableName,
    table.table_name,
    table.tableType,
    table.table_type,
    ...(Array.isArray(table.columns) ? table.columns.map((c) => `${c.label || ''} ${c.key || ''}`) : []),
    userRequest,
  ].filter(Boolean).join(' ');
  if (!hasMeaningfulContext(text)) return [];

  const explicitIntent = inferUserOutputIntent(userRequest);
  const mainType = inferMainLayoutType(text, explicitIntent, userRequest);
  const scored = LAYOUT_REGISTRY
    .filter((layout) => isLayoutAllowedForIntent(layout.layoutType, explicitIntent, text))
    .map((layout) => {
      const score = scoreLayoutAgainstText(layout, text, mainType, explicitIntent);
      return {
        designId: layout.designId,
        name: layout.name,
        documentKind: layout.documentKind,
        layoutType: layout.layoutType,
        layout: normalizeLayoutForRenderer(layout.layoutType),
        title: layout.title,
        score,
        reason: buildReason(layout, score, text, mainType, explicitIntent),
        sections: layout.sections,
        sourceType: 'LAYOUT_REGISTRY',
        mainType,
        requestIntent: explicitIntent,
      };
    });

  const threshold = explicitIntent === 'AUTO' ? 55 : 50;
  const filtered = scored
    .filter((item) => item.layoutType === mainType || Number(item.score || 0) >= threshold)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return filtered.slice(0, 5);
}


module.exports = { LAYOUT_REGISTRY, normalizeLayoutForRenderer, buildLayoutCandidates, scoreLayoutAgainstText, inferUserOutputIntent, isLayoutAllowedForIntent };
