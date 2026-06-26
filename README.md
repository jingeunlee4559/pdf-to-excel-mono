# AI 업무문서 자동화 시스템

> 건설·전기 공사업무의 PDF/Excel 문서를 업로드하면,  
> AI가 내용을 분석하고 **회사 내부 양식에 맞는 Excel 파일**로 자동 생성해주는 업무 자동화 시스템

---

## 목차

1. [프로젝트 소개](#1-프로젝트-소개)
2. [주요 기능](#2-주요-기능)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [기술 스택](#4-기술-스택)
5. [실행 방법](#5-실행-방법)
6. [환경변수 설정](#6-환경변수-설정)
7. [사용 흐름](#7-사용-흐름)
8. [사용 예시](#8-사용-예시)
9. [핵심 개발 포인트](#9-핵심-개발-포인트)

---

## 1. 프로젝트 소개

공사팀·감리팀·관리팀에서 반복적으로 수행하는 **문서 분석 → 단가 비교 → 견적 정리 → 엑셀 양식 작성** 업무를 자동화합니다.

기존에는 PDF나 Excel 문서를 직접 확인하고, 필요한 데이터를 복사하여 회사 양식에 맞게 재입력해야 했습니다.  
이 시스템은 **문서 업로드 → AI 분석 → 표 생성 → 자사 양식 매핑 → Excel 다운로드** 전 과정을 하나의 화면에서 처리합니다.

---

## 2. 주요 기능

### 📄 문서 업로드 및 분석

- PDF, Excel 등 업무 문서 업로드
- 문서 텍스트 및 표 데이터 자동 추출
- AI 기반 문서 내용 요약 및 구조화
- 분석 결과를 채팅 화면에서 실시간 확인

### 💬 AI 채팅 기반 문서 생성

- 자연어 요청으로 원하는 표 즉시 생성
- 업체별 단가 비교표, 견적 비교표, 보고서 형식 정리 등 지원
- 품목명·규격·수량·업체명·단가 등 핵심 정보를 자동으로 표 구조로 변환

### 🔍 엑셀 미리보기 및 직접 수정

- 생성된 표를 브라우저에서 Excel 형태로 미리보기
- 행 추가, 컬럼 추가, 셀 직접 수정 가능
- 수정 후 저장 및 재생성 지원

### 🛠️ 관리자 양식 템플릿 관리

- 회사 업무 양식 Excel 파일 등록
- 양식별 셀 매핑 설정 (품목명, 단가, 수량 등 항목 위치 지정)
- 등록된 양식은 모든 사용자가 공통으로 사용

### 🏢 자사 양식 자동 적용

- 관리자가 등록한 양식 템플릿 기반으로 셀 자동 매핑
- 비교견적서, 업체별 제품가격 조사현황표 등 업무 양식 지원
- 업체 수에 따른 컬럼 동적 생성
- 평균가격·최저가 업체·업체선정 등 계산 필드 자동 반영

### 📥 Excel 다운로드

- AI 생성 표 다운로드
- 자사 양식 적용 결과 다운로드
- 업무 보고 및 내부 제출용 Excel 파일 생성

---

## 3. 시스템 아키텍처

| 서비스 | 기술 | 포트 |
|--------|------|:----:|
| Frontend | React + Vite | 3000 |
| Backend | Node.js + Express | 8080 |
| AI Server | Python + FastAPI | 8000 |
| Database | MongoDB | 27017 |

**서비스 간 통신 흐름**

| 구간 | 방식 |
|------|------|
| 사용자 ↔ Frontend | 브라우저 |
| Frontend ↔ Backend | REST API |
| Backend ↔ MongoDB | Mongoose |
| Backend ↔ AI Server | 내부 HTTP |

**AI Server 처리 내역**

| 역할 | 라이브러리 |
|------|-----------|
| PDF 파싱 | PyMuPDF, pdfplumber |
| 문서 분석 | OpenAI |
| Excel 생성 | openpyxl |

---

## 4. 기술 스택

| 영역 | 기술 |
|------|------|
| **Frontend** | React, Vite, JavaScript, Tailwind CSS |
| **Backend** | Node.js, Express |
| **AI Server** | Python, FastAPI |
| **Database** | MongoDB |
| **Excel 처리** | openpyxl, ExcelJS |
| **문서 파싱** | PyMuPDF, pdfplumber |
| **AI 연동** | OpenAI |

---

## 5. 실행 방법

> 세 개의 서버를 모두 실행해야 정상 동작합니다.

### 0) MongoDB 설정

> MongoDB가 로컬에 설치되어 있어야 합니다.

- [MongoDB Community Server 다운로드](https://www.mongodb.com/try/download/community)
- 설치 후 MongoDB 서비스가 실행 중인지 확인 (`mongod`)

초기 데이터(양식, 기준자료 등)를 DB에 삽입합니다.

```bash
cd backend
npm install
npm run seed
```

### 1) Frontend

```bash
cd frontend
npm install
npm run dev
```

> 실행 주소: `http://localhost:3000`

### 2) Backend

```bash
cd backend
node server.js
```

> 개발 모드 (파일 변경 시 자동 재시작): `npm run dev`  
> 실행 주소: `http://localhost:8080`

### 3) AI Server

```bash
cd ai-server
python -m venv venv
```

가상환경 활성화

```bash
# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

패키지 설치 및 서버 실행

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

> 실행 주소: `http://127.0.0.1:8000`

---

## 6. 환경변수 설정

### `backend/.env`

```env
PORT=8080
FRONTEND_ORIGIN=http://localhost:3000
AI_SERVER_URL=http://127.0.0.1:8000
MONGODB_URI=mongodb://127.0.0.1:27017/prototypeversion3
JWT_SECRET=your_jwt_secret
```

### `ai-server/.env`

```env
LLM_ENABLED=true
LLM_PROVIDER=openai
LLM_TIMEOUT_SECONDS=120

PDF_TEXT_ENGINE=pymupdf
PDF_EXTRACT_TABLES=true

OCR_ENABLED=false
```

---

## 7. 사용 흐름

### 관리자 사전 설정

> 사용자가 양식을 사용하기 전에 관리자가 먼저 설정해야 합니다.

1. 회사 업무 양식 Excel 파일 등록
2. 양식별 셀 매핑 설정 (품목명 → B열, 단가 → C열, 수량 → D열 등)
3. 등록 완료 → 전체 사용자에게 양식 공개

### 사용자 업무 흐름

1. 문서 업로드 (PDF / Excel)
2. 백엔드에서 작업 생성 → MongoDB에 저장
3. AI 서버에서 문서 분석
4. 분석 결과를 표 구조 JSON으로 변환
5. 채팅으로 원하는 양식 요청
6. 엑셀 미리보기 생성
7. 직접 수정 또는 저장
8. 관리자가 등록한 자사 양식 적용
9. Excel 파일 다운로드

---

## 8. 사용 예시

**요청 예시**

```
에이건설, 비테크건설, 씨엔씨종합건설, 이엔지건설 4개 업체를
P.P마대(만들기), 톤마대(쌓기) 각각 수량 40개, 50개로
단가 비교해서 표로 보여줘.
```

**생성 결과**

| 품목명 | 규격 | 수량 | 에이건설 | 비테크건설 | 씨엔씨종합건설 | 이엔지건설 | 최저가 업체 | 평균가격 |
|--------|------|-----:|----------|------------|----------------|------------|-------------|----------|
| P.P마대(만들기) | 0.024㎥ | 40 | — | — | — | — | 자동 계산 | 자동 계산 |
| 톤마대(쌓기) | 0.7㎥ | 50 | — | — | — | — | 자동 계산 | 자동 계산 |

---

## 9. 핵심 개발 포인트

- **자연어 → 표 구조 변환**: OpenAI를 통해 자유로운 요청을 정형화된 JSON 표로 변환
- **동적 컬럼 생성**: 업체 수에 따라 Excel 컬럼을 자동으로 생성
- **관리자 셀 매핑 처리**: 등록된 양식의 셀 위치에 맞게 데이터 자동 배치
- **미리보기 일관성**: 브라우저 Excel 미리보기와 실제 다운로드 결과 일치 보장
- **복합 분석 흐름**: 문서 분석 결과 + 채팅 요청을 함께 반영하는 통합 자동화 파이프라인

---

> 이 프로젝트는 단순 문서 요약 도구가 아닙니다.  
> 실제 현장 업무에서 사용하는 문서를 AI가 분석하고, 관리자가 등록한 회사 양식에 맞게 재구성하여  
> **반복적인 엑셀 작업을 자동화**하는 것을 목표로 합니다.
```
