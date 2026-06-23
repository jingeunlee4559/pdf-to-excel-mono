# MySQL → MongoDB 전환 적용 안내

## 1. 적용 범위

이번 패치는 백엔드의 MySQL 연결부를 MongoDB/Mongoose 기반으로 교체합니다.
프론트엔드 API 경로와 AI 서버 호출 방식은 유지합니다.

변경된 핵심 파일:

- `config/db.js`: MySQL pool 대신 MongoDB 연결 및 기존 `pool.query()` 호환 레이어 제공
- `models/index.js`: Mongoose 모델 정의
- `config/mongoSeed.js`: 권한, 테스트 계정, 표준필드, 별칭, 기본 템플릿 seed
- `scripts/seedMongo.js`: seed 수동 실행 스크립트
- `server.js`: 서버 시작 전 MongoDB 연결
- `.env`: `MONGO_URI` 기준 환경변수로 변경
- `package.json`: `mongoose` 의존성 추가, `mysql2` 제거

## 2. 설치

MongoDB Community Server 또는 MongoDB Atlas 중 하나를 준비합니다.
로컬 개발 기준 기본 접속 문자열은 아래와 같습니다.

```env
MONGO_URI=mongodb://127.0.0.1:27017/prototypeversion3
```

패키지를 다시 설치합니다.

```bash
cd backend
npm install
```

## 3. 초기 데이터 생성

서버 시작 시 `MONGO_AUTO_SEED=true`이면 자동으로 seed가 실행됩니다.
수동으로 실행하려면 아래 명령을 사용합니다.

```bash
npm run seed
```

테스트 계정:

- 시스템관리자: `admin / 1234`
- 일반사용자: `user / 1234`

## 4. 실행

```bash
npm run dev
```

정상 실행 시 콘솔에 MongoDB 연결 문자열이 표시됩니다.

## 5. 주의사항

- 기존 MySQL 데이터 자동 이관 기능은 포함하지 않았습니다.
- 기존 MySQL의 업무 데이터까지 옮기려면 별도 마이그레이션 스크립트가 필요합니다.
- 현재 패치는 기존 컨트롤러의 `pool.query()` 호출을 최대한 유지하기 위해 MongoDB 호환 레이어를 둔 방식입니다.
- 운영 단계에서는 호환 레이어를 제거하고 Repository/Service 구조로 정리하는 것을 권장합니다.
