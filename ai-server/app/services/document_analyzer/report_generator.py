from __future__ import annotations

import logging
from typing import Any, Dict

from app.services.llm_client import call_llm_json, get_llm_config

logger = logging.getLogger("app.document_analyzer.report_generator")

_REPORT_KEYWORDS = [
    "검토보고서", "검토 보고서", "내부 보고", "업무보고서", "회사 보고서",
    "보고서 형식", "보고서로 작성", "보고서로 정리", "보고서 형태",
    "내부 검토", "결재용", "검토보고", "보고서 작성", "업무보고",
    "보고서처럼", "보고서 느낌", "회사 내부 검토",
]


def user_wants_narrative_report(user_request: str) -> bool:
    if not user_request:
        return False
    return any(kw in user_request for kw in _REPORT_KEYWORDS)


def _build_report_prompt(user_request: str, combined_text: str, analysis: Dict[str, Any]) -> str:
    cfg = get_llm_config()
    max_chars = min(cfg.context_chars, 8000)
    text_part = combined_text[:max_chars]
    doc_type = str(analysis.get("documentType") or "업무 문서")
    summary = str(analysis.get("summary") or "")

    return f"""
너는 건설·전기 공사 전문 업무 보고서 작성 AI다.
반드시 JSON 객체 1개만 반환한다. 마크다운/코드블록 금지.

[사용자 보고서 작성 요청]
{user_request}

[AI가 분석한 문서 유형]
{doc_type}

[AI 파서 분석 요약]
{summary}

[원문 전체 텍스트 (일부)]
{text_part}

[보고서 섹션별 작성 지침]
overview      : 문서명, 발행 기관/업체, 주요 내용을 2~4문장으로 서술.
background    : 이 문서를 검토하게 된 배경과 검토 목적을 2~4문장으로 서술.
current_status: 날짜·금액·업체·공종명이 있으면 반드시 포함하여 3~6문장으로 서술.
key_issues    : 검토 과정에서 발견된 주요 문제점과 불확실 사항을 3~5문장으로 서술.
cost_schedule_impact: 금액은 원 단위(예: 12,500,000원), 일정은 YYYY.MM.DD 형식. 없으면 "확인 필요".
department_actions: 담당부서별로 구분하여 서술. 원문에 담당부서 없으면 "(확인 필요)" 표시.
risks         : 공사 지연, 예산 초과, 안전, 법적 이슈 등 리스크 항목을 서술.
overall_opinion: 분석 결론과 권고 방향을 3~5문장으로. "~합니다", "~됩니다" 등 결재용 문체 사용.

[반환 JSON 스키마]
{{
  "report_title": "원문 기반 보고서 제목 (예: ○○ 공사 검토보고서)",
  "sections": {{
    "overview": "문서 개요 (2~4문장)",
    "background": "검토 배경 및 목적 (2~4문장)",
    "current_status": "주요 현황 (3~6문장. 날짜·금액·업체·공종명 포함)",
    "key_issues": "핵심 쟁점 (3~5문장)",
    "cost_schedule_impact": "비용 및 일정 영향 (금액은 원 단위, 일정은 YYYY.MM.DD)",
    "department_actions": "부서별 조치 필요사항 (담당부서별 구분 서술)",
    "risks": "리스크 및 확인 필요사항",
    "overall_opinion": "종합 검토의견 (3~5문장)"
  }},
  "follow_up_actions": [
    {{"department": "담당부서", "action": "조치내용", "due_date": "목표기한 또는 확인 필요"}}
  ]
}}

[엄격 규칙]
1. 원문에 없는 날짜·금액·업체명·담당자를 절대 만들지 않는다.
2. 확인되지 않은 정보는 "확인 필요" 또는 "추가 검토 필요"로 표시한다.
3. 문체는 "~합니다", "~됩니다", "~검토됩니다" 등 회사 내부 결재용 보고서 문체를 사용한다.
4. 원문에서 확인된 사실과 검토 의견을 명확히 구분하여 작성한다.
5. 사용자가 요청한 섹션 구조를 최대한 반영한다.
6. 원문에 데이터가 없는 섹션은 "원문에서 확인되지 않았습니다. 추가 검토 필요."로 표시한다.
7. follow_up_actions는 원문에 근거가 있는 항목만 추출하고, 최소 1개 이상 작성한다.
8. 보고서는 실무자가 결재 라인에 그대로 올릴 수 있는 수준의 공식 문체로 작성한다.
""".strip()


async def generate_narrative_report(
    user_request: str,
    combined_text: str,
    analysis: Dict[str, Any],
) -> Dict[str, Any]:
    cfg = get_llm_config()
    if not cfg.enabled or not combined_text.strip():
        return {}
    prompt = _build_report_prompt(user_request, combined_text, analysis)
    try:
        result = await call_llm_json(prompt, cfg)
        if not isinstance(result, dict):
            return {}
        logger.info(f"[ReportGen] 보고서 생성 완료 title={result.get('report_title', '')!r}")
        return result
    except Exception as exc:
        logger.error(f"[ReportGen] 보고서 생성 실패: {exc}")
        return {"_error": str(exc)[:200]}
