import { useState, useRef, useCallback } from 'react';

function getContrastColor(hexColor) {
  if (!hexColor || hexColor === '#ffffff' || hexColor === '#FFFFFF') return null;
  try {
    const hex = hexColor.replace('#', '');
    if (hex.length !== 6) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.45 ? '#ffffff' : '#0f172a';
  } catch { return null; }
}

function getCellLetter(address) { return address.match(/^([A-Z]+)/)?.[1] || ''; }
function getCellRow(address) { return parseInt(address.match(/([0-9]+)$/)?.[1]) || 0; }

export function ExcelTemplateOriginalGrid({
  preview, onCellEdit, onRemoveRow, onRemoveColumn,
  onMergePreview, onSplitPreview, onColumnWidthChange, onRowHeightChange,
  selectedInsertCol,
}) {
  const [editingCell, setEditingCell] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState(new Set());
  // 드래그 리사이즈 상태
  const [colWidths, setColWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const dragRef = useRef(null);

  const columns = Array.isArray(preview?.columns) ? preview.columns : [];
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];

  if (!columns.length || !rows.length) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm font-black text-slate-400">원본 엑셀 미리보기 데이터가 없습니다.</div>;
  }

  const visibleColumns = columns.filter(c => !c.hidden);
  const visibleColLetters = visibleColumns.map(c => c.letter);
  const hiddenColLetters = new Set(columns.filter(c => c.hidden).map(c => c.letter));

  const getVisibleColSpan = (cell) => {
    const startLetter = cell.columnLetter || getCellLetter(cell.address);
    const startIndex = columns.findIndex((c) => c.letter === startLetter);
    const rawSpan = cell.colSpan && cell.colSpan > 1 ? cell.colSpan : 1;
    if (startIndex < 0 || rawSpan <= 1) return rawSpan;
    let visibleCount = 0;
    for (let i = startIndex; i < Math.min(columns.length, startIndex + rawSpan); i += 1) {
      if (!columns[i]?.hidden) visibleCount += 1;
    }
    return Math.max(1, visibleCount);
  };

  // ── 셀 선택 ────────────────────────────────────────────────
  const handleCellClick = (cell) => {
    if (cell.isMergedHidden) return;
    if (selectMode) {
      setSelectedCells(prev => {
        const next = new Set(prev);
        if (next.has(cell.address)) next.delete(cell.address);
        else next.add(cell.address);
        return next;
      });
      return;
    }
    if (!onCellEdit) return;
    setEditingCell({ address: cell.address, value: cell.text || '' });
  };

  const handleCommit = () => {
    if (!editingCell) return;
    onCellEdit(editingCell.address, editingCell.value);
    setEditingCell(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCommit(); }
    if (e.key === 'Escape') setEditingCell(null);
  };

  // ── 병합 ───────────────────────────────────────────────────
  const canMerge = () => {
    if (selectedCells.size < 2) return false;
    const addrs = [...selectedCells];
    const letters = addrs.map(getCellLetter);
    const rowNums = addrs.map(getCellRow);
    const minCI = Math.min(...letters.map(l => visibleColLetters.indexOf(l)));
    const maxCI = Math.max(...letters.map(l => visibleColLetters.indexOf(l)));
    const minRow = Math.min(...rowNums);
    const maxRow = Math.max(...rowNums);
    if (minCI < 0 || maxCI < 0) return false;
    for (let r = minRow; r <= maxRow; r++) {
      for (let ci = minCI; ci <= maxCI; ci++) {
        if (!selectedCells.has(`${visibleColLetters[ci]}${r}`)) return false;
      }
    }
    return true;
  };

  const handleMerge = () => {
    if (!canMerge() || !onMergePreview) return;
    const addrs = [...selectedCells];
    const letters = addrs.map(getCellLetter);
    const rowNums = addrs.map(getCellRow);
    const minCI = Math.min(...letters.map(l => visibleColLetters.indexOf(l)));
    const maxCI = Math.max(...letters.map(l => visibleColLetters.indexOf(l)));
    const minRow = Math.min(...rowNums);
    const maxRow = Math.max(...rowNums);
    const topLeftAddr = `${visibleColLetters[minCI]}${minRow}`;
    onMergePreview(topLeftAddr, maxRow - minRow + 1, maxCI - minCI + 1, addrs);
    setSelectedCells(new Set());
  };

  const getSelectedCellData = () => {
    if (selectedCells.size !== 1) return null;
    const addr = [...selectedCells][0];
    for (const row of rows) {
      const found = (row.cells || []).find(c => c.address === addr);
      if (found) return found;
    }
    return null;
  };

  const canSplit = () => {
    const cell = getSelectedCellData();
    return cell && ((cell.rowSpan > 1) || (cell.colSpan > 1));
  };

  const handleSplit = () => {
    if (!canSplit() || !onSplitPreview) return;
    onSplitPreview([...selectedCells][0]);
    setSelectedCells(new Set());
  };

  // ── 컬럼 너비 드래그 리사이즈 ──────────────────────────────
  const startColResize = useCallback((e, letter, currentWidth) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = currentWidth || 80;
    const onMove = (me) => {
      const newW = Math.max(30, startW + (me.clientX - startX));
      setColWidths(prev => ({ ...prev, [letter]: newW }));
    };
    const onUp = (me) => {
      const newW = Math.max(30, startW + (me.clientX - startX));
      setColWidths(prev => ({ ...prev, [letter]: newW }));
      if (onColumnWidthChange) onColumnWidthChange(letter, newW);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onColumnWidthChange]);

  // ── 행 높이 드래그 리사이즈 ────────────────────────────────
  const startRowResize = useCallback((e, rowNumber, currentHeight) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = currentHeight || 26;
    const onMove = (me) => {
      const newH = Math.max(16, startH + (me.clientY - startY));
      setRowHeights(prev => ({ ...prev, [rowNumber]: newH }));
    };
    const onUp = (me) => {
      const newH = Math.max(16, startH + (me.clientY - startY));
      setRowHeights(prev => ({ ...prev, [rowNumber]: newH }));
      if (onRowHeightChange) onRowHeightChange(rowNumber, newH);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onRowHeightChange]);

  const hasTools = onRemoveRow || onRemoveColumn || onMergePreview || onSplitPreview;

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
      {/* 병합/분리 툴바 */}
      {hasTools && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 px-1">
          {(onMergePreview || onSplitPreview) && (
            <button
              type="button"
              onClick={() => { setSelectMode(s => !s); setSelectedCells(new Set()); setEditingCell(null); }}
              className={`rounded-2xl px-3 py-1.5 text-xs font-black transition-all ${selectMode ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100'}`}
            >
              {selectMode ? '✓ 선택 모드' : '셀 선택 모드'}
            </button>
          )}
          {selectMode && (
            <>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-600">{selectedCells.size}개 선택됨</span>
              {onMergePreview && (
                <button type="button" disabled={!canMerge()} onClick={handleMerge}
                  className="rounded-2xl bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-700 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed">
                  병합
                </button>
              )}
              {onSplitPreview && (
                <button type="button" disabled={!canSplit()} onClick={handleSplit}
                  className="rounded-2xl bg-rose-100 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-200 disabled:opacity-40 disabled:cursor-not-allowed">
                  분리
                </button>
              )}
              <button type="button" onClick={() => setSelectedCells(new Set())}
                className="rounded-2xl bg-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-300">
                선택 취소
              </button>
            </>
          )}
          {selectMode && <span className="text-[11px] text-slate-400">셀 클릭하여 범위 선택 후 병합/분리</span>}
        </div>
      )}

      <div className="scroll-thin max-h-[56vh] overflow-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="inline-block min-w-full p-1.5">
          <table className="border-collapse bg-white text-xs" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 52 }} />
              {visibleColumns.map((col) => (
                <col
                  key={col.letter}
                  style={{ width: colWidths[col.letter] || col.widthPx || 80 }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border border-slate-200 bg-slate-100 text-slate-400" style={{ height: 26 }} />
                {visibleColumns.map((col) => (
                  <th
                    key={col.letter}
                    className="group sticky top-0 z-10 border border-slate-200 bg-slate-100 text-center font-black text-slate-500 cursor-default select-none"
                    style={{ height: 26, position: 'relative' }}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-[10px]">{col.letter}</span>
                      {onRemoveColumn && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onRemoveColumn(col.letter); }}
                          className="flex h-3.5 w-3.5 items-center justify-center rounded bg-red-100 text-[9px] font-black text-red-500 hover:bg-red-200 leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                          title={`${col.letter} 컬럼 삭제`}
                        >×</button>
                      )}
                    </div>
                    {/* 컬럼 너비 드래그 핸들 */}
                    <div
                      onMouseDown={(e) => startColResize(e, col.letter, colWidths[col.letter] || col.widthPx || 80)}
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 15 }}
                      className="hover:bg-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="드래그하여 너비 조절"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.hidden) return null;
                const rh = rowHeights[row.rowNumber] || row.heightPx || 26;
                return (
                  <tr key={row.rowNumber} style={{ height: rh }} className="group">
                    <th
                      className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-1 text-center font-black text-slate-400 select-none"
                      style={{ minWidth: 52, position: 'relative' }}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        <span className="text-[10px]">{row.rowNumber}</span>
                        {onRemoveRow && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onRemoveRow(row.rowNumber); }}
                            className="flex h-3.5 w-3.5 items-center justify-center rounded bg-red-100 text-[9px] font-black text-red-500 hover:bg-red-200 leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                            title="행 삭제"
                          >×</button>
                        )}
                      </div>
                      {/* 행 높이 드래그 핸들 */}
                      <div
                        onMouseDown={(e) => startRowResize(e, row.rowNumber, rh)}
                        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, cursor: 'row-resize', zIndex: 15 }}
                        className="hover:bg-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="드래그하여 높이 조절"
                      />
                    </th>
                    {(row.cells || []).map((cell) => {
                      const cellLetter = cell.columnLetter || getCellLetter(cell.address);
                      if (cell.isColumnHidden || hiddenColLetters.has(cellLetter)) return null;
                      if (cell.isMergedHidden) return null;
                      const s = cell.style || {};
                      const isEditing = editingCell?.address === cell.address;
                      const isSelected = selectedCells.has(cell.address);
                      const bg = s.backgroundColor || '#ffffff';
                      const autoColor = getContrastColor(bg);
                      const textColor = autoColor !== null ? autoColor : (s.color || '#0f172a');
                      const cellStyle = {
                        backgroundColor: bg,
                        color: textColor,
                        fontWeight: s.fontWeight || 500,
                        fontStyle: s.italic ? 'italic' : 'normal',
                        textDecoration: s.underline ? 'underline' : 'none',
                        fontFamily: s.fontFamily || "'Pretendard', system-ui, sans-serif",
                        fontSize: `${Math.max(9, s.fontSize || 11)}px`,
                        textAlign: s.textAlign || 'center',
                        verticalAlign: s.verticalAlign || 'middle',
                        borderTop: isEditing ? '2px solid #6366f1' : isSelected ? '2px solid #f59e0b' : (s.borderTop || '1px solid #e2e8f0'),
                        borderRight: isEditing ? '2px solid #6366f1' : isSelected ? '2px solid #f59e0b' : (s.borderRight || '1px solid #e2e8f0'),
                        borderBottom: isEditing ? '2px solid #6366f1' : isSelected ? '2px solid #f59e0b' : (s.borderBottom || '1px solid #e2e8f0'),
                        borderLeft: isEditing ? '2px solid #6366f1' : isSelected ? '2px solid #f59e0b' : (s.borderLeft || '1px solid #e2e8f0'),
                        whiteSpace: s.whiteSpace || 'nowrap',
                        overflow: 'hidden',
                        cursor: selectMode ? 'pointer' : (onCellEdit ? 'text' : undefined),
                        padding: 0,
                        boxShadow: isSelected ? 'inset 0 0 0 2px #f59e0b' : undefined,
                      };
                      return (
                        <td
                          key={cell.address}
                          rowSpan={cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined}
                          colSpan={getVisibleColSpan(cell) > 1 ? getVisibleColSpan(cell) : undefined}
                          title={!selectMode && onCellEdit ? `${cell.address} — 클릭하여 편집` : `${cell.address}: ${cell.text || ''}`}
                          style={cellStyle}
                          onClick={() => !isEditing && handleCellClick(cell)}
                        >
                          {isEditing ? (
                            <input autoFocus value={editingCell.value}
                              onChange={(e) => setEditingCell((p) => ({ ...p, value: e.target.value }))}
                              onBlur={handleCommit} onKeyDown={handleKeyDown}
                              style={{ width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none', font: 'inherit', color: 'inherit', textAlign: s.textAlign || 'center', padding: '0 6px' }}
                            />
                          ) : (
                            <span className={s.whiteSpace === 'normal' ? 'block break-words leading-snug px-1.5 py-0.5' : 'block truncate px-1.5 py-0.5'}>{cell.text}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
        {Array.isArray(preview.mergedCells) && preview.mergedCells.length > 0 && (
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">병합 셀 {preview.mergedCells.length}개 반영</span>
        )}
        <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">원본 행/열 높이·너비 반영 | 헤더 경계 드래그로 크기 조절</span>
      </div>
    </div>
  );
}
