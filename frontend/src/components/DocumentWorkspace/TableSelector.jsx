export function TableSelector({ tables, selectedIndex, onSelect }) {
  if (!Array.isArray(tables) || tables.length <= 1) return null;

  return (
    <div className="mb-4 rounded-3xl border border-brand-100 bg-brand-50/80 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black text-brand-700">추출된 표 선택</p>
          <p className="mt-1 text-xs font-bold text-slate-500">이미지 표가 여러 개면 페이지/표 단위로 나누어 저장됩니다. 선택한 표만 수정·엑셀 생성 대상입니다.</p>
        </div>
        <select
          value={selectedIndex}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-[260px] rounded-2xl border border-brand-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        >
          {tables.map((item, index) => {
            const page = item.page || item.tableJson?.page;
            const rowCount = item.rowCount ?? (item.rows || []).length;
            const title = item.tableName || `표 ${index + 1}`;
            return (
              <option key={item.id || `${index}-${title}`} value={index}>
                {index + 1}. {page ? `${page}페이지 · ` : ''}{title} · {rowCount}행
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}
