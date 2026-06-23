require('dotenv').config();
const { mongoose } = require('../models');
const { seedMongo } = require('../config/mongoSeed');

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/prototypeversion3';
  await mongoose.connect(uri, {
    autoIndex: process.env.MONGO_AUTO_INDEX !== 'false',
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
  });
  await seedMongo();
  console.log('[seedMongo] MongoDB 초기 데이터 생성/보강 완료');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('[seedMongo] failed:', error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
