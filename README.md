# AI 업무문서 자동화 시스템

건설·전기 공사업무에서 사용하는 PDF, Excel, 견적서, 단가표, 보고서 등의 문서를 업로드하면
AI가 내용을 분석하고 표 구조로 변환한 뒤, 회사 내부 양식에 맞는 Excel 문서로 자동 생성하는 업무문서 자동화 시스템입니다.

## 1. 프로젝트 개요

본 프로젝트는 공사팀, 감리팀, 관리팀에서 반복적으로 수행하는 문서 분석, 단가 비교, 견적 정리, 엑셀 양식 작성 업무를 줄이기 위해 개발되었습니다.

기존에는 사용자가 PDF나 Excel 문서를 직접 확인하고, 필요한 데이터를 복사하여 회사 양식에 맞게 다시 입력해야 했습니다.
이 시스템은 문서 업로드부터 AI 분석, 표 생성, 자사 양식 매핑, Excel 다운로드까지의 과정을 하나의 화면에서 처리할 수 있도록 구성했습니다.

## 2. 주요 기능

### 문서 업로드 및 분석

* PDF, Excel 등 업무 문서 업로드
* 문서 텍스트 및 표 데이터 추출
* AI 기반 문서 내용 요약 및 구조화
* 분석 결과를 채팅 화면에서 확인 가능

### AI 채팅 기반 문서 생성

* 사용자의 자연어 요청을 기반으로 표 생성
* 예: 업체별 단가 비교표, 견적 비교표, 보고서 형식 정리
* 품목명, 규격, 수량, 업체명, 단가 등 주요 정보를 추출하여 표로 구성

### 엑셀 미리보기 및 직접 수정

* 생성된 표를 브라우저에서 엑셀 형태로 미리보기
* 행 추가, 컬럼 추가, 셀 수정 가능
* 수정 후 저장 및 재생성 가능

### 자사 양식 적용

* 등록된 회사 양식에 맞춰 데이터 자동 입력
* 비교견적서, 업체별 제품가격 조사현황표 등 업무 양식 지원
* 업체 수에 따라 컬럼 동적 생성
* 평균가격, 최저가 업체, 업체선정 등 계산 필드 자동 반영

### Excel 다운로드

* AI 생성 표 다운로드
* 자사 양식 적용 결과 다운로드
* 업무 보고 및 내부 제출용 Excel 파일 생성

## 3. 시스템 구성

```text
prototypeversion3
├─ src/              # React 프론트엔드
├─ backend/          # Node.js / Express 백엔드
├─ ai-server/        # Python / FastAPI AI 분석 서버
└─ README.md
```

## 4. 기술 스택

| 영역        | 기술                      |
| --------- | ----------------------- |
| Frontend  | React, Vite, JavaScript |
| Backend   | Node.js, Express        |
| AI Server | Python, FastAPI         |
| Database  | MongoDB                 |
| Excel 처리  | openpyxl                |
| 문서 처리     | PDF/Excel Parser        |
| AI 연동     | LLM 기반 문서 분석 및 구조화      |

## 5. 실행 방법

### 1) 프론트엔드 실행

```bash
cd src
npm install
npm run dev
```

기본 실행 주소:

```text
http://localhost:3000
```

### 2) 백엔드 실행

```bash
cd backend
npm install
node server.js
```

기본 실행 주소:

```text
http://localhost:8080
```

### 3) AI 서버 실행

```bash
cd ai-server
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

기본 실행 주소:

```text
http://127.0.0.1:8000
```

## 6. 환경변수 예시

### backend/.env

```env
PORT=8080
FRONTEND_ORIGIN=http://localhost:3000
AI_SERVER_URL=http://127.0.0.1:8000
MONGODB_URI=mongodb://127.0.0.1:27017/prototypeversion3
JWT_SECRET=your_jwt_secret
```

### ai-server/.env

```env
LLM_ENABLED=true
LLM_PROVIDER=gemini
LLM_TIMEOUT_SECONDS=120

PDF_TEXT_ENGINE=pymupdf
PDF_EXTRACT_TABLES=true

OCR_ENABLED=false
```

AI 모델이나 API 제공자는 프로젝트 설정에 맞게 변경할 수 있습니다.

## 7. 사용 흐름

```text
1. 사용자가 문서 업로드
2. 백엔드에서 작업 생성
3. AI 서버에서 문서 분석
4. 분석 결과를 표 구조로 변환
5. 사용자가 채팅으로 원하는 양식 요청
6. 엑셀 미리보기 생성
7. 사용자가 직접 수정 또는 저장
8. 자사 양식 적용
9. Excel 파일 다운로드
```

## 8. 예시 요청

```text
에이건설, 비테크건설, 씨엔씨종합건설, 이엔지건설 4개 업체를
P.P마대(만들기), 톤마대(쌓기) 각각 수량 40개, 50개로
단가 비교해서 표로 보여줘.
```

생성 결과 예시:

| 품목명        | 규격     | 수량 | 업체별 단가    | 최저가 업체    |  평균가격 |
| ---------- | ------ | -: | --------- | --------- | ----: |
| P.P마대(만들기) | 0.024㎥ | 40 | 업체별 단가 비교 | 최저가 자동 계산 | 자동 계산 |
| 톤마대(쌓기)    | 0.7㎥   | 50 | 업체별 단가 비교 | 최저가 자동 계산 | 자동 계산 |

## 9. 핵심 개발 포인트

* 자연어 요청을 표 구조 JSON으로 변환
* 업체 수에 따른 동적 Excel 컬럼 생성
* 회사 등록 양식에 맞춘 셀 매핑 처리
* 브라우저 Excel 미리보기와 실제 Excel 다운로드 결과 일치
* 문서 분석 결과와 채팅 요청을 함께 반영하는 업무 자동화 흐름 구현

## 10. 향후 개선 예정

* 자사 양식 등록 및 매핑 UI 고도화
* 다양한 업무 문서 유형 추가
* 문서별 검증 규칙 강화
* 단가표, 견적서, 보고서 기준자료 연동
* 사용자별 작업 이력 관리
* AI 분석 정확도 및 처리 속도 개선

## 11. 프로젝트 목적

이 프로젝트는 단순 문서 요약 도구가 아니라,
실제 회사 업무에서 사용하는 문서를 AI가 분석하고 회사 양식에 맞게 재구성하여
반복적인 엑셀 작성 업무를 줄이는 것을 목표로 합니다.
