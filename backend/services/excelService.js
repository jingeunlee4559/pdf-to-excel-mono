const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function createExcelFile({ jobId, fileName, columns, rows }) {
  const resultDir = process.env.RESULT_DIR || 'storage/results';
  ensureDir(resultDir);
  const safeName = (fileName || `document_job_${jobId}.xlsx`).replace(/[\\/:*?"<>|]/g, '_');
  const storedName = `${Date.now()}_${safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`}`;
  const filePath = path.join(resultDir, storedName);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI 업무문서 자동화 시스템';
  const sheet = workbook.addWorksheet('문서분석결과');
  sheet.columns = (columns || []).map((col) => ({ header: col.label || col.key, key: col.key, width: 18 }));
  (rows || []).forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  await workbook.xlsx.writeFile(filePath);
  return { fileName: safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`, filePath };
}

module.exports = { createExcelFile };
