/**
 * 불필요한 등록 템플릿 정리 스크립트
 * 실행: node backend/scripts/cleanupTemplates.js
 *
 * 유지: 비교견적서_양식, 업체별_제품가격_조사현황표 (및 시스템 시드 템플릿)
 * 삭제: AI 생성 템플릿 및 중복 불필요 템플릿
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const KEEP_NAMES = ['비교견적서_양식', '업체별_제품가격_조사현황표'];

const SYSTEM_CODES = [
  'NORMAL_TABLE_V1', 'COMPARISON_MATRIX_V1', 'WORK_LOG_TABLE_V1',
  'ESTIMATE_FORM_V1', 'UNIT_PRICE_TABLE_V1', 'BUSINESS_REPORT_V1',
  'MEETING_MINUTES_V1', 'OFFICIAL_LETTER_V1',
];

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/prototypeversion3';
  await mongoose.connect(uri);
  console.log('MongoDB 연결됨:', uri);

  const db = mongoose.connection.db;
  const templateCol = db.collection('excel_templates');
  const recCol = db.collection('document_template_recommendations');

  // 전체 활성 템플릿 목록
  const all = await templateCol.find({ active_yn: 'Y' }).toArray();
  console.log(`\n전체 활성 템플릿 수: ${all.length}개`);
  all.forEach((t) => console.log(`  - [id:${t.id}] [${t.template_code}] ${t.template_name}`));

  // 삭제 대상: 시스템 코드 아니고, 유지 이름도 아닌 것
  const toDeactivate = all.filter(
    (t) =>
      !SYSTEM_CODES.includes(t.template_code) &&
      !KEEP_NAMES.some((keep) => t.template_name === keep || t.template_name?.includes(keep)),
  );

  if (toDeactivate.length) {
    console.log(`\n삭제 대상 excel_templates ${toDeactivate.length}개:`);
    toDeactivate.forEach((t) => console.log(`  × [id:${t.id}] ${t.template_name}`));

    const oids = toDeactivate.map((t) => t._id);
    const r1 = await templateCol.updateMany(
      { _id: { $in: oids } },
      { $set: { active_yn: 'N', updated_at: new Date() } },
    );
    console.log(`  → ${r1.modifiedCount}개 비활성화 완료`);
  } else {
    console.log('\nexcel_templates: 삭제 대상 없음');
  }

  // document_template_recommendations 전체 삭제
  const recCount = await recCol.countDocuments({});
  if (recCount > 0) {
    console.log(`\ndocument_template_recommendations ${recCount}개 삭제 중...`);
    const r2 = await recCol.deleteMany({});
    console.log(`  → ${r2.deletedCount}개 삭제 완료`);
  } else {
    console.log('\ndocument_template_recommendations: 이미 비어있음');
  }

  // 결과 확인
  const remaining = await templateCol
    .find({ active_yn: 'Y', template_code: { $nin: SYSTEM_CODES } })
    .toArray();
  console.log(`\n최종 남은 사용자 템플릿 (${remaining.length}개):`);
  remaining.forEach((t) => console.log(`  ✓ [id:${t.id}] ${t.template_name}`));

  await mongoose.disconnect();
  console.log('\n완료.');
}

run().catch((err) => {
  console.error('오류:', err);
  process.exit(1);
});
