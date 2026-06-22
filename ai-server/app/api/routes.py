from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services.document_analyzer import analyze_uploads
from app.services.excel_preview import build_excel_preview
from app.services.chat_service import answer_chat
from app.services.storage_service import save_upload_file

router = APIRouter()


class ChatRequest(BaseModel):
    message: str = Field(..., description="사용자 채팅 메시지")
    context: Optional[dict] = Field(default_factory=dict, description="현재 분석 결과/표/이슈 컨텍스트")


class ExcelPreviewRequest(BaseModel):
    file_path: str = Field(..., description="ai-server에 저장된 엑셀 파일 경로")
    sheet_name: Optional[str] = None
    max_rows: int = 80
    max_cols: int = 26


@router.post("/chat")
async def chat(payload: ChatRequest):
    return await answer_chat(message=payload.message, context=payload.context or {})


@router.post("/analyze")
async def analyze(
    files: List[UploadFile] = File(...),
    user_request: str = Form("문서를 분석해서 표로 만들어줘"),
    output_mode: str = Form("FREE_FORM"),
    template_id: Optional[str] = Form(None),
):
    return await analyze_uploads(files=files, user_request=user_request, output_mode=output_mode, template_id=template_id)


@router.post("/storage/upload")
async def upload_to_ai_storage(
    file: UploadFile = File(...),
    upload_type: str = Form("documents"),
):
    return await save_upload_file(file, upload_type=upload_type)


@router.post("/excel/preview")
async def excel_preview(payload: ExcelPreviewRequest):
    try:
        return build_excel_preview(
            file_path=payload.file_path,
            sheet_name=payload.sheet_name,
            max_rows=payload.max_rows,
            max_cols=payload.max_cols,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"엑셀 미리보기 생성 실패: {exc}") from exc
