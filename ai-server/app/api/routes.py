from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services.document_analyzer import analyze_uploads
from app.services.excel_preview import build_excel_preview
from app.services.chat_service import answer_chat
from app.services.storage_service import save_upload_file
from app.services.template_designer import design_template
from app.services.excel_generator import generate_excel, make_template_skeleton, build_design_candidates

router = APIRouter()


class ChatRequest(BaseModel):
    message: str = Field(..., description="사용자 채팅 메시지")
    context: Optional[dict] = Field(default_factory=dict, description="현재 분석 결과/표/이슈 컨텍스트")


class TemplateDesignRequest(BaseModel):
    user_request: str = ""
    analysis: dict = Field(default_factory=dict)
    columns: List[dict] = Field(default_factory=list)
    rows: List[dict] = Field(default_factory=list)
    standard_fields: List[dict] = Field(default_factory=list)
    layout_registry: List[dict] = Field(default_factory=list)


class ExcelPreviewRequest(BaseModel):
    file_path: str = Field(..., description="ai-server에 저장된 엑셀 파일 경로")
    sheet_name: Optional[str] = None
    max_rows: int = 80
    max_cols: int = 26


class ExcelGenerateRequest(BaseModel):
    job_id: Optional[int] = None
    file_name: Optional[str] = None
    output_mode: str = "FREE_FORM"
    template: Optional[dict] = None
    mappings: List[dict] = Field(default_factory=list)
    mapping_json: dict = Field(default_factory=dict)
    columns: List[dict] = Field(default_factory=list)
    rows: List[dict] = Field(default_factory=list)
    job: dict = Field(default_factory=dict)
    author_name: str = ""
    template_layout_mode: str = "COMPACT_VENDOR_GROUPS"
    design_id: Optional[str] = None


class TemplateSkeletonRequest(BaseModel):
    design: dict = Field(default_factory=dict)
    file_name: Optional[str] = None


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


@router.post("/template/design")
async def template_design(payload: TemplateDesignRequest):
    return await design_template(payload.dict())


@router.post("/template/design-candidates")
async def template_design_candidates(payload: TemplateDesignRequest):
    return build_design_candidates(payload.dict())


@router.post("/template/skeleton")
async def template_skeleton(payload: TemplateSkeletonRequest):
    try:
        return make_template_skeleton(payload.dict())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI 양식 골격 생성 실패: {exc}") from exc


@router.post("/excel/generate")
async def excel_generate(payload: ExcelGenerateRequest):
    try:
        return generate_excel(payload.dict())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"openpyxl 엑셀 생성 실패: {exc}") from exc


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
