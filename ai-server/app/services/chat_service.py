from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from app.services.llm_client import call_llm_json, get_llm_config


def _chat_llm_enabled() -> bool:
    raw = os.getenv("CHAT_LLM_ENABLED", "true")
    return raw.strip().lower() in {"1", "true", "y", "yes", "on"}


def _num(value: Any) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", str(value or ""))
    if not cleaned:
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _has_document(context: Optional[Dict[str, Any]]) -> bool:
    context = context or {}
    if context.get("hasDocument") is True or context.get("hasJob") is True:
        return True
    analysis = context.get("analysis") or {}
    table = context.get("table") or {}
    rows = table.get("rows") if isinstance(table, dict) else []
    doc_type = str(analysis.get("documentType") or analysis.get("document_type") or "").strip()
    if doc_type and doc_type not in {"대기", "문서 분석 대기", "미분석"}:
        return True
    return bool(rows)


def _detect_intent(message: str) -> str:
    text = (message or "").strip().lower()
    if re.search(r"(너는|넌).*(뭐|무엇|누구|하는|할 수)|뭐하는\s*(ai|에이아이)|기능|도와줄|할수있|할 수 있|소개", text, re.I):
        return "SELF_INTRO"
    if re.search(r"^(안녕|하이|hello|hi|반가워|ㅎㅇ)\b|안녕하세요", text, re.I):
        return "GREETING"
    # 양식 변경 요청은 단가비교·표 요청보다 먼저 판별한다
    if re.search(r"보고서\s*(형식|형태|양식|로|으로)?|회의록|공문|업무보고|검토보고|일보|점검표", text, re.I):
        return "FORMAT_REQUEST"
    # "비교표로", "비교견적서로" 같은 명시적 양식 요청도 FORMAT_REQUEST
    if re.search(r"비교표\s*(로|으로|형식|양식)|비교견적서|단가비교표|업체별\s*비교", text, re.I):
        return "FORMAT_REQUEST"
    if re.search(r"단가|비교|최저|가격|견적", text, re.I):
        return "PRICE_COMPARE"
    if re.search(r"이\s*문서|문서\s*(뭐|무슨|요약|내용)|뭐야|무슨\s*문서|내용|요약", text, re.I):
        return "DOCUMENT_QA"
    if re.search(r"확인|오류|문제|검토|이슈|누락", text, re.I):
        return "ISSUE_CHECK"
    if re.search(r"표|테이블|정리", text, re.I):
        return "TABLE_CREATE"
    if re.search(r"엑셀|xlsx|양식|산출", text, re.I):
        return "EXCEL_CREATE"
    return "GENERAL"


def _detect_target_format(message: str) -> str:
    text = (message or "").strip()
    if re.search(r"회의록", text, re.I):
        return "MEETING_MINUTES"
    if re.search(r"공문", text, re.I):
        return "OFFICIAL_LETTER"
    if re.search(r"비교표|비교견적서|업체별\s*비교|단가비교표", text, re.I):
        return "ESTIMATE_COMPARISON"
    if re.search(r"보고서|업무보고|검토보고", text, re.I):
        return "REPORT"
    if re.search(r"일보|작업일보|점검표", text, re.I):
        return "REPORT"
    return "REPORT"


def _fallback_answer(message: str, context: Optional[Dict[str, Any]] = None, llm_error: str = "") -> Dict[str, Any]:
    context = context or {}
    msg = (message or "").strip()
    intent = _detect_intent(msg)
    has_document = _has_document(context)
    analysis = context.get("analysis") or {}
    table = context.get("table") or {}
    rows = table.get("rows") or []
    issues = context.get("issues") or []

    base = {
        "llmUsed": False,
        "llmFallback": bool(llm_error),
        "llmError": llm_error,
        "model": "rule-chat-fallback" if llm_error else "rule-chat",
    }

    if intent == "FORMAT_REQUEST":
        target_format = _detect_target_format(msg)
        format_labels = {
            "REPORT": "보고서",
            "MEETING_MINUTES": "회의록",
            "OFFICIAL_LETTER": "공문",
            "ESTIMATE_COMPARISON": "비교견적서",
        }
        label = format_labels.get(target_format, "보고서")
        return {
            **base,
            "answer": f"{label} 형식으로 엑셀을 생성합니다.",
            "intent": "FORMAT_REQUEST",
            "needsFile": not has_document,
            "action": "GENERATE_EXCEL" if has_document else "REQUEST_FILE",
            "targetFormat": target_format,
            "recommendedTab": "excel",
            "quickReplies": ["다운로드", "다른 형식은?", "비교표로 만들어줘"],
        }

    if intent in {"GREETING", "SELF_INTRO"}:
        answer = (
            "안녕하세요. 저는 문서를 엑셀화하기 위한 AI 작업 채팅입니다. "
            "PDF·엑셀·문서 파일을 기준으로 문서 유형 확인, 표 추출, 단가 비교, 금액/단위 검증, 확인 필요 항목 정리를 도와드립니다."
        )
        if has_document:
            answer += " 현재 분석된 문서 기준으로도 바로 질문할 수 있습니다."
        return {
            **base,
            "answer": answer,
            "intent": intent,
            "needsFile": False,
            "action": "NONE",
            "recommendedTab": None,
            "quickReplies": ["이 문서 뭐야?", "단가만 비교해줘", "확인 필요한 부분만 보여줘"],
        }

    if intent == "DOCUMENT_QA":
        if has_document:
            doc_type = analysis.get("documentType") or analysis.get("document_type") or "업무 문서"
            summary = analysis.get("summary") or "분석 요약이 없습니다."
            answer = f"현재 문서는 {doc_type}로 보입니다. {summary}"
            if issues:
                answer += f" 확인 필요 항목은 {len(issues)}건입니다."
            return {
                **base,
                "answer": answer,
                "intent": "DOCUMENT_QA",
                "needsFile": False,
                "action": "SHOW_ANALYSIS",
                "recommendedTab": "analysis",
                "quickReplies": ["표로 만들어줘", "단가만 비교해줘", "확인 필요한 부분만 보여줘"],
            }
        return {
            **base,
            "answer": "아직 분석된 문서가 없습니다. PDF나 엑셀 파일을 첨부한 뒤 분석을 실행하면 문서 유형과 핵심 내용을 답변할 수 있습니다.",
            "intent": "DOCUMENT_QA",
            "needsFile": True,
            "action": "REQUEST_FILE",
            "recommendedTab": None,
            "quickReplies": ["파일 첨부", "분석 실행"],
        }

    if intent == "PRICE_COMPARE":
        if not rows:
            return {
                **base,
                "answer": "비교할 표 데이터가 아직 없습니다. 파일을 첨부하고 분석을 실행하면 품목별 단가를 비교할 수 있습니다. 단위가 다른 항목은 환산 기준 확인 후 비교합니다.",
                "intent": "PRICE_COMPARE",
                "needsFile": True,
                "action": "REQUEST_FILE",
                "recommendedTab": None,
                "quickReplies": ["파일 첨부", "표로 만들어줘"],
            }
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for row in rows:
            item = str(row.get("item_name") or row.get("품목명") or "").strip()
            if item:
                grouped.setdefault(item, []).append(row)
        lines: List[str] = []
        for item, item_rows in list(grouped.items())[:8]:
            valid = []
            for row in item_rows:
                unit_price = _num(row.get("unit_price") or row.get("단가"))
                unit = str(row.get("unit_normalized") or row.get("unit") or "").strip()
                vendor = str(row.get("vendor_name") or row.get("업체명") or "업체 미상").strip()
                if unit_price > 0:
                    valid.append((unit_price, vendor, unit))
            if not valid:
                continue
            units = {unit for _, _, unit in valid if unit}
            if len(units) >= 2:
                lines.append(f"- {item}: 단위가 달라 직접 비교 전 환산 기준 확인 필요({', '.join(sorted(units))}).")
            else:
                best = min(valid, key=lambda x: x[0])
                lines.append(f"- {item}: 최저 단가 {best[1]} / {best[0]:,.0f}원/{best[2] or '단위 미상'}")
        return {
            **base,
            "answer": "단가 비교 결과입니다.\n" + ("\n".join(lines) if lines else "단가 값이 부족해서 최저가를 확정할 수 없습니다."),
            "intent": "PRICE_COMPARE",
            "needsFile": False,
            "action": "SHOW_TABLE",
            "recommendedTab": "table",
            "quickReplies": ["금액 다시 확인", "확인 필요한 부분만 보여줘", "엑셀 미리보기 보여줘"],
        }

    if intent == "ISSUE_CHECK":
        if issues:
            issue_lines = "\n".join([f"- {issue.get('message', '확인 필요')}" for issue in issues[:8]])
            answer = f"현재 확인 필요한 항목은 {len(issues)}건입니다.\n{issue_lines}"
        else:
            answer = "현재 확인 필요 항목은 없습니다. 다만 문서가 아직 분석되지 않았다면 파일 분석 후 정확히 확인할 수 있습니다."
        return {
            **base,
            "answer": answer,
            "intent": "ISSUE_CHECK",
            "needsFile": not has_document,
            "action": "SHOW_ANALYSIS" if has_document else "REQUEST_FILE",
            "recommendedTab": "analysis" if has_document else None,
            "quickReplies": ["단가만 비교해줘", "표로 만들어줘"],
        }

    return {
        **base,
        "answer": ("요청을 확인했습니다. 현재 분석된 문서와 표 기준으로 이어서 처리할 수 있습니다." if has_document else "요청을 확인했습니다. 문서 파일을 첨부하면 표 추출, 단가 비교, 금액 검증, 엑셀 생성 흐름으로 도와드릴 수 있습니다."),
        "intent": intent,
        "needsFile": not has_document,
        "action": "NONE",
        "recommendedTab": "analysis" if has_document else None,
        "quickReplies": ["이 문서 뭐야?", "단가만 비교해줘", "확인 필요한 부분만 보여줘"],
    }


def _build_chat_prompt(message: str, context: Optional[Dict[str, Any]]) -> str:
    context = context or {}
    intent_hint = _detect_intent(message)
    has_document = _has_document(context)
    table = context.get("table") or {}
    analysis = context.get("analysis") if has_document else None
    compact_context = {
        "hasDocument": has_document,
        "documentState": context.get("documentState") or ("ANALYZED" if has_document else "NO_ANALYZED_DOCUMENT"),
        "intentHint": intent_hint,
        "analysis": analysis or None,
        "table": {
            "tableName": table.get("tableName"),
            "tableType": table.get("tableType"),
            "columns": table.get("columns") or [],
            "rows": (table.get("rows") or [])[:80],
        } if has_document or table.get("rows") else None,
        "issues": (context.get("issues") or [])[:50] if has_document else [],
        "selectedTemplate": context.get("selectedTemplate") or None,
        "outputMode": context.get("outputMode") or None,
    }
    context_json = json.dumps(compact_context, ensure_ascii=False, default=str)
    return f"""
너는 건설/전기/설비 문서 엑셀화 시스템의 AI 작업 채팅이다.
사용자에게 한국어로 짧고 정확하게 답한다.
반드시 JSON 객체 1개만 반환한다. 마크다운 코드블록 금지.

[사용자 메시지]
{message}

[현재 화면/문서 분석 컨텍스트]
{context_json}

[가장 중요한 답변 규칙]
1. intentHint가 GREETING 또는 SELF_INTRO이면 문서가 없어도 파일 첨부 요청만 반복하지 말고, 네 역할과 가능한 작업을 자연스럽게 설명한다.
2. hasDocument=false일 때도 일반 인사/자기소개/기능 질문에는 답변한다.
3. hasDocument=false이고 사용자가 특정 문서 내용, 단가 비교, 표 추출을 요구하면 "아직 분석된 문서가 없음"을 알리고 파일 첨부/분석 실행을 요청한다.
4. hasDocument=true일 때만 analysis/table/issues에 근거해 문서 유형, 표, 단가, 이슈를 답한다.
5. 원문/표/컨텍스트에 없는 업체명, 금액, 단가, 문서명을 새로 만들지 않는다.
6. "단가만 비교해줘"는 table.rows 기준으로 품목별 단가를 비교한다. 단위가 다르면 최저가를 확정하지 말고 환산 기준 확인 필요라고 답한다.
7. 같은 문장을 반복하지 말고 사용자 질문 의도에 맞게 답한다.
8. 답변은 2~8줄로 실무자가 바로 이해할 수 있게 작성한다.
9. 현재 날짜/시간 정보가 컨텍스트에 없으면 날짜를 말하지 않는다. 사용자가 날짜를 묻지 않았으면 절대 "오늘은 YYYY년" 같은 문장을 쓰지 않는다.

[반환 JSON 스키마]
{{
  "answer": "사용자에게 보여줄 답변 (엑셀 생성을 실제로 했다는 거짓 표현 금지 - 실제로 생성하는 건 프론트엔드가 한다)",
  "intent": "GREETING|SELF_INTRO|DOCUMENT_QA|PRICE_COMPARE|ISSUE_CHECK|TABLE_CREATE|EXCEL_CREATE|FORMAT_REQUEST|GENERAL",
  "needsFile": false,
  "action": "NONE|REQUEST_FILE|SHOW_ANALYSIS|SHOW_TABLE|SHOW_EXCEL|RUN_ANALYSIS|GENERATE_EXCEL",
  "targetFormat": "REPORT|MEETING_MINUTES|OFFICIAL_LETTER|ESTIMATE_COMPARISON|null",
  "recommendedTab": "analysis|table|excel|source|null",
  "quickReplies": ["후속 질문 1", "후속 질문 2"]
}}

[추가 규칙]
10. "보고서 형식으로", "회의록으로", "공문으로" 같은 양식 변경 요청이면 intent=FORMAT_REQUEST, action=GENERATE_EXCEL, targetFormat에 REPORT/MEETING_MINUTES/OFFICIAL_LETTER 중 하나를 넣어라.
11. action=GENERATE_EXCEL이라도 answer에서 "생성했습니다", "만들었습니다"를 쓰지 말고 "생성합니다"라고 써라. 실제 생성은 프론트에서 한다.
""".strip()


def _guard_bad_repeated_answer(result: Dict[str, Any], message: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """로컬 모델이 빈 문서 상태나 학습 데이터에 끌려가 부정확한 답을 할 때 보정한다."""
    intent = _detect_intent(message)
    msg = str(message or "")
    answer = str(result.get("answer") or "")
    if intent in {"GREETING", "SELF_INTRO"} and re.search(r"분석할 문서|분석된 문서|파일을 첨부|분석을 실행", answer):
        corrected = _fallback_answer(message, context)
        corrected["llmUsed"] = False
        corrected["llmFallback"] = True
        corrected["llmError"] = "LLM 답변이 일반 질문 의도와 맞지 않아 보정했습니다."
        corrected["model"] = "rule-chat-guard"
        return corrected

    # 사용자가 날짜를 묻지 않았는데 모델이 임의 날짜를 말하면 제거한다.
    asked_date = re.search(r"오늘|날짜|몇\s*일|date", msg, re.I)
    if not asked_date and re.search(r"오늘은\s*[0-9]{4}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일", answer):
        corrected = _fallback_answer(message, context)
        corrected["llmUsed"] = False
        corrected["llmFallback"] = True
        corrected["llmError"] = "LLM이 제공되지 않은 현재 날짜를 임의 생성하여 보정했습니다."
        corrected["model"] = "rule-chat-date-guard"
        return corrected
    return result


async def answer_chat(message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    msg = (message or "").strip()
    if not msg:
        return _fallback_answer("", context)

    if not _chat_llm_enabled():
        return _fallback_answer(msg, context, "CHAT_LLM_ENABLED=false")

    cfg = get_llm_config()
    if not cfg.enabled:
        return _fallback_answer(msg, context, "LLM_ENABLED=false")

    try:
        prompt = _build_chat_prompt(msg, context)
        result = await call_llm_json(prompt, cfg)
        answer = str(result.get("answer") or "").strip()
        if not answer:
            raise RuntimeError("LLM 응답 JSON에 answer가 없습니다.")
        chat_result = {
            "answer": answer,
            "intent": result.get("intent") or _detect_intent(msg),
            "needsFile": bool(result.get("needsFile", False)),
            "action": result.get("action") or "NONE",
            "recommendedTab": result.get("recommendedTab") or None,
            "quickReplies": result.get("quickReplies") if isinstance(result.get("quickReplies"), list) else ["이 문서 뭐야?", "단가만 비교해줘"],
            "llmUsed": True,
            "llmFallback": False,
            "model": f"gemini:{cfg.model}",
            "llmMeta": result.get("_llm", {}),
        }
        return _guard_bad_repeated_answer(chat_result, msg, context)
    except Exception as exc:
        return _fallback_answer(msg, context, str(exc))
