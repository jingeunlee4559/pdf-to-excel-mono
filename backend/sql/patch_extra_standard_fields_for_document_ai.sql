-- =========================================================
-- AI 문서분석 추가 표준 필드 패치
-- 목적:
--   1) 표 데이터/엑셀 미리보기에서 어떤 컬럼이 들어갔는지 명확히 표시
--   2) 표준시장단가/업체 단가 비교/사용자 요청 수량 계산 컬럼 추가
--   3) 기존 DB에 중복 실행해도 안전하게 적용
-- =========================================================

INSERT INTO standard_fields
(field_key, field_label, field_group, data_type, description, sort_order)
VALUES
('source_file', '원본파일', 'HEADER', 'text', '행 또는 데이터가 추출된 원본 파일명', 15),
('source_page', '원본페이지', 'HEADER', 'number', '행 또는 데이터가 추출된 원본 페이지 번호', 16),
('construction_code', '공종코드', 'DETAIL', 'text', '공종, 품셈, 단가표의 코드', 105),
('category', '분류', 'DETAIL', 'text', '공종 또는 품목의 상위 분류', 106),
('standard_unit_price', '기준/표준 단가', 'DETAIL', 'amount', '표준시장단가, 기준단가 등 기준 가격', 151),
('vendor_unit_price', '업체 견적단가', 'DETAIL', 'amount', '업체 견적서에서 추출한 단가', 152),
('lowest_vendor', '최저 업체', 'SUMMARY', 'text', '비교 결과 최저 단가 업체', 411),
('lowest_unit_price', '최저 단가', 'SUMMARY', 'amount', '비교 결과 최저 단가', 412),
('requested_quantity', '요청 수량', 'DETAIL', 'number', '사용자가 채팅에서 지정한 계산 기준 수량', 153),
('calculation_unit_price', '계산 적용 단가', 'DETAIL', 'amount', '수량 계산에 사용한 원문 근거 단가', 154),
('calculated_amount', '요청수량 산출금액', 'DETAIL', 'amount', '계산 적용 단가와 요청 수량을 곱한 금액', 181),
('labor_ratio', '노무비율', 'DETAIL', 'number', '표준시장단가 또는 단가표의 노무비율', 250),
('calculation_note', '계산근거', 'REVIEW', 'text', '수량/단가 계산 또는 비교 산출 근거', 520),
('special_note', '기타사항', 'SUMMARY', 'text', '자사 양식 기타사항 영역에 들어갈 내용', 430),
('final_opinion', '최종의견', 'SUMMARY', 'text', '검토자 최종 의견 또는 비교 결과 의견', 440)
ON DUPLICATE KEY UPDATE
  field_label = VALUES(field_label),
  field_group = VALUES(field_group),
  data_type = VALUES(data_type),
  description = VALUES(description),
  active_yn = 'Y',
  sort_order = VALUES(sort_order);

INSERT INTO field_alias_keywords
(field_key, alias_keyword, match_type, priority)
SELECT seed.field_key, seed.alias_keyword, seed.match_type, seed.priority
FROM (
SELECT 'source_file', '원본파일', 'CONTAINS', 10
UNION ALL
SELECT 'source_file', '파일명', 'CONTAINS', 20
UNION ALL
SELECT 'source_page', '페이지', 'CONTAINS', 10
UNION ALL
SELECT 'construction_code', '공종코드', 'CONTAINS', 10
UNION ALL
SELECT 'construction_code', '코드', 'CONTAINS', 20
UNION ALL
SELECT 'category', '분류', 'CONTAINS', 10
UNION ALL
SELECT 'category', '구분', 'CONTAINS', 20
UNION ALL
SELECT 'standard_unit_price', '표준시장단가', 'CONTAINS', 5
UNION ALL
SELECT 'standard_unit_price', '기준단가', 'CONTAINS', 10
UNION ALL
SELECT 'standard_unit_price', '표준단가', 'CONTAINS', 20
UNION ALL
SELECT 'vendor_unit_price', '업체 견적단가', 'CONTAINS', 10
UNION ALL
SELECT 'vendor_unit_price', '견적단가', 'CONTAINS', 20
UNION ALL
SELECT 'vendor_unit_price', '업체단가', 'CONTAINS', 30
UNION ALL
SELECT 'lowest_vendor', '최저 업체', 'CONTAINS', 10
UNION ALL
SELECT 'lowest_vendor', '최저대상', 'CONTAINS', 20
UNION ALL
SELECT 'lowest_unit_price', '최저 단가', 'CONTAINS', 10
UNION ALL
SELECT 'requested_quantity', '요청 수량', 'CONTAINS', 10
UNION ALL
SELECT 'requested_quantity', '기준 수량', 'CONTAINS', 20
UNION ALL
SELECT 'calculation_unit_price', '계산 적용 단가', 'CONTAINS', 10
UNION ALL
SELECT 'calculated_amount', '요청수량 산출금액', 'CONTAINS', 10
UNION ALL
SELECT 'calculated_amount', '산출금액', 'CONTAINS', 20
UNION ALL
SELECT 'labor_ratio', '노무비율', 'CONTAINS', 10
UNION ALL
SELECT 'calculation_note', '계산근거', 'CONTAINS', 10
UNION ALL
SELECT 'special_note', '기타사항', 'CONTAINS', 10
UNION ALL
SELECT 'final_opinion', '최종의견', 'CONTAINS', 10
) AS seed(field_key, alias_keyword, match_type, priority)
WHERE NOT EXISTS (
  SELECT 1
  FROM field_alias_keywords existing
  WHERE existing.field_key = seed.field_key
    AND existing.alias_keyword = seed.alias_keyword
);
