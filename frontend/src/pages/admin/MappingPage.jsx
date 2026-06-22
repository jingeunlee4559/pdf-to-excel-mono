import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Eye, MousePointer2, RefreshCw, Save, Search, Table2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  getTemplateMappingsApi,
  getTemplatePreviewApi,
  listStandardFieldsApi,
  listTemplatesApi,
  saveTemplateMappingsApi
} from '../../api/templateApi.js';

const GROUP_LABEL = {
  HEADER: '상단 정보',
  DETAIL: '상세 표',
  SUMMARY: '요약 정보',
  TARGET: '비교 대상',
  COMPARISON_FIELD: '비교 항목',
  REVIEW: '검토 정보',
  ETC: '기타'
};

const fallbackFields = [
  { fieldKey: 'document_title', fieldLabel: '문서명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', isRequired: false },
  { fieldKey: 'document_date', fieldLabel: '작성일', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', isRequired: false },
  { fieldKey: 'site_name', fieldLabel: '현장명', fieldGroup: 'HEADER', defaultMappingType: 'SINGLE_CELL', isRequired: false },
  { fieldKey: 'vendor_name', fieldLabel: '업체명', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'item_name', fieldLabel: '품목명', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: true },
  { fieldKey: 'spec', fieldLabel: '규격', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'quantity', fieldLabel: '수량', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'unit_price', fieldLabel: '단가', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'amount', fieldLabel: '금액', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: true },
  { fieldKey: 'remark', fieldLabel: '비고', fieldGroup: 'DETAIL', defaultMappingType: 'REPEAT_COLUMN', isRequired: false },
  { fieldKey: 'total_amount', fieldLabel: '총액', fieldGroup: 'SUMMARY', defaultMappingType: 'SINGLE_CELL', isRequired: false }
];

function normalizeFields(data) {
  const list = data?.fields || data?.standardFields || data?.data?.fields || [];
  return (Array.isArray(list) && list.length ? list : fallbackFields).map((field) => ({
    fieldKey: field.fieldKey || field.field_key,
    fieldLabel: field.fieldLabel || field.field_label || field.fieldName || field.field_name,
    fieldGroup: field.fieldGroup || field.field_group || 'ETC',
    dataType: field.dataType || field.data_type || 'text',
    defaultMappingType: field.defaultMappingType || field.default_mapping_type || (['HEADER', 'SUMMARY'].includes(field.fieldGroup || field.field_group) ? 'SINGLE_CELL' : 'REPEAT_COLUMN'),
    isRequired: Boolean(field.isRequired ?? field.is_required)
  })).filter((field) => field.fieldKey);
}

export default function MappingPage() {
  const [searchParams] = useSearchParams();
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(searchParams.get('templateId') || '');
  const [sheetName, setSheetName] = useState('');
  const [preview, setPreview] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [fields, setFields] = useState(fallbackFields);
  const [mappingType, setMappingType] = useState('SINGLE_CELL');
  const [selectedFieldKey, setSelectedFieldKey] = useState('');
  const [mappings, setMappings] = useState([]);
  const [zoom, setZoom] = useState(100);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selectedTemplate = useMemo(() => templates.find((item) => String(item.id || item.templateId) === String(selectedTemplateId)), [templates, selectedTemplateId]);
  const selectedField = useMemo(() => fields.find((field) => field.fieldKey === selectedFieldKey), [fields, selectedFieldKey]);
  const mappingMap = useMemo(() => Object.fromEntries(mappings.map((item) => [item.fieldKey, item])), [mappings]);

  const visibleFields = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return fields
      .filter((field) => field.defaultMappingType === mappingType)
      .filter((field) => !q || `${field.fieldLabel} ${field.fieldKey}`.toLowerCase().includes(q));
  }, [fields, mappingType, keyword]);

  const groupedFields = useMemo(() => {
    return visibleFields.reduce((acc, field) => {
      const key = field.fieldGroup || 'ETC';
      if (!acc[key]) acc[key] = [];
      acc[key].push(field);
      return acc;
    }, {});
  }, [visibleFields]);

  const loadTemplates = async () => {
    const data = await listTemplatesApi();
    const list = data.templates || [];
    setTemplates(list);
    if (!selectedTemplateId && list.length) setSelectedTemplateId(String(list[0].id || list[0].templateId));
  };

  const loadFields = async () => {
    try {
      const data = await listStandardFieldsApi({ mappingType });
      const normalized = normalizeFields(data);
      setFields(normalized);
      if (!selectedFieldKey || !normalized.some((field) => field.fieldKey === selectedFieldKey)) {
        setSelectedFieldKey(normalized[0]?.fieldKey || '');
      }
    } catch {
      const filtered = fallbackFields.filter((field) => field.defaultMappingType === mappingType);
      setFields(fallbackFields);
      setSelectedFieldKey(filtered[0]?.fieldKey || '');
    }
  };

  const loadMappings = async (templateId) => {
    try {
      const data = await getTemplateMappingsApi(templateId);
      setMappings(Array.isArray(data.mappings) ? data.mappings : []);
      if (data.sheetName && !sheetName) setSheetName(data.sheetName);
    } catch {
      setMappings([]);
    }
  };

  const loadPreview = async (templateId, nextSheetName = '') => {
    if (!templateId) return;
    setMessage('');
    try {
      setLoading(true);
      const data = await getTemplatePreviewApi(templateId, { sheetName: nextSheetName || undefined, maxRows: 80, maxCols: 30 });
      setPreview(data.preview || null);
      setSheetNames(data.sheetNames || data.sheet_names || []);
      setSheetName(data.preview?.sheetName || nextSheetName || data.sheetNames?.[0] || '');
    } catch (error) {
      setPreview(null);
      setMessage(error.response?.data?.message || error.response?.data?.detail || '엑셀 미리보기를 불러오지 못했습니다. ai-server에 파일이 저장되어 있는지 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  const loadPage = async () => {
    try {
      setLoading(true);
      await loadTemplates();
      await loadFields();
    } catch (error) {
      setMessage(error.response?.data?.message || '매핑 페이지 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  useEffect(() => {
    loadFields();
  }, [mappingType]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    loadMappings(selectedTemplateId);
    loadPreview(selectedTemplateId, sheetName);
  }, [selectedTemplateId]);

  const handleSheetChange = (value) => {
    setSheetName(value);
    loadPreview(selectedTemplateId, value);
  };

  const handleCellClick = (cell) => {
    if (!selectedField) {
      setMessage('먼저 왼쪽에서 표준 필드를 선택하세요.');
      return;
    }

    const next = {
      fieldKey: selectedField.fieldKey,
      fieldLabel: selectedField.fieldLabel,
      mappingType,
      sheetName: preview?.sheetName || sheetName,
      cellAddress: mappingType === 'SINGLE_CELL' ? cell.address : null,
      columnLetter: mappingType === 'REPEAT_COLUMN' ? cell.columnLetter : null,
      startRow: mappingType === 'REPEAT_COLUMN' ? cell.row : null,
      maxRows: mappingType === 'REPEAT_COLUMN' ? 30 : null,
      isRequired: selectedField.isRequired || false
    };

    setMappings((prev) => [...prev.filter((item) => item.fieldKey !== selectedField.fieldKey), next]);
    setMessage(`${selectedField.fieldLabel} 필드를 ${mappingType === 'SINGLE_CELL' ? cell.address : `${cell.columnLetter}열 ${cell.row}행부터`}에 연결했습니다.`);
  };

  const saveMappings = async () => {
    if (!selectedTemplateId) return;
    try {
      setSaving(true);
      await saveTemplateMappingsApi(selectedTemplateId, { sheetName: preview?.sheetName || sheetName, mappings });
      setMessage('매핑이 저장되었습니다.');
    } catch (error) {
      setMessage(error.response?.data?.message || '매핑 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-card md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">엑셀 템플릿 매핑 설정</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">ai-server에 저장된 실제 엑셀 양식을 미리보기로 보면서 셀을 클릭해 표준 필드를 연결합니다.</p>
            {selectedTemplate && (
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-black">
                <span className="text-slate-950">{selectedTemplate.templateName}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">{selectedTemplate.originalFileName || '파일명 없음'}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-100">ai-server 저장</span>
              </div>
            )}
          </div>

          <div className="grid w-full gap-2 xl:w-[520px]">
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100">
              <option value="">템플릿 선택</option>
              {templates.map((item) => <option key={item.id || item.templateId} value={item.id || item.templateId}>{item.templateName}</option>)}
            </select>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => loadPreview(selectedTemplateId, sheetName)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-50"><RefreshCw size={15} /> 새로고침</button>
              <button onClick={saveMappings} disabled={saving || !mappings.length} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300"><Save size={15} /> {saving ? '저장 중...' : '매핑 저장'}</button>
            </div>
          </div>
        </div>

        {message && (
          <div className={`mt-5 rounded-2xl px-4 py-3 text-sm font-bold ${message.includes('못했습니다') || message.includes('오류') ? 'border border-rose-100 bg-rose-50 text-rose-700' : 'border border-brand-100 bg-brand-50 text-brand-700'}`}>
            {message}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-card xl:sticky xl:top-[88px] xl:max-h-[calc(100vh-110px)] xl:overflow-y-auto scroll-thin">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">표준 필드</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">필드를 선택한 뒤 엑셀 셀을 클릭하세요.</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-black text-brand-700 ring-1 ring-brand-100">{visibleFields.length}개</span>
          </div>

          <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              <button onClick={() => setMappingType('SINGLE_CELL')} className={`h-11 rounded-xl text-sm font-black transition ${mappingType === 'SINGLE_CELL' ? 'bg-brand-500 text-white shadow-glow' : 'text-slate-500 hover:bg-brand-50 hover:text-brand-700'}`}>단일 셀</button>
              <button onClick={() => setMappingType('REPEAT_COLUMN')} className={`h-11 rounded-xl text-sm font-black transition ${mappingType === 'REPEAT_COLUMN' ? 'bg-brand-500 text-white shadow-glow' : 'text-slate-500 hover:bg-brand-50 hover:text-brand-700'}`}>반복 컬럼</button>
            </div>
            <label className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 focus-within:border-brand-500">
              <Search size={16} className="text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="필드명 검색" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-slate-400" />
            </label>
          </div>

          <div className="mt-5 space-y-5">
            {Object.entries(groupedFields).map(([group, list]) => (
              <div key={group}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-black text-slate-950">{GROUP_LABEL[group] || group}</p>
                  <p className="text-xs font-black text-slate-400">{list.length}개</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-2">
                  {list.map((field) => {
                    const selected = selectedFieldKey === field.fieldKey;
                    const mapped = mappingMap[field.fieldKey];
                    return (
                      <button
                        type="button"
                        key={field.fieldKey}
                        onClick={() => setSelectedFieldKey(field.fieldKey)}
                        className={`min-h-[92px] rounded-[20px] border p-3 text-left transition ${selected ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-100' : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">{field.fieldLabel}</p>
                            <p className="mt-1 truncate text-[11px] font-bold text-slate-400">{field.fieldKey}</p>
                          </div>
                          {mapped && <Check size={16} className="shrink-0 text-emerald-600" />}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{field.fieldGroup}</span>
                          {field.isRequired && <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-600">필수</span>}
                          {mapped && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{mapped.cellAddress || `${mapped.columnLetter}열`}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-card">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Eye size={17} className="text-brand-600" />
              <h3 className="text-base font-black text-slate-950">엑셀 미리보기</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={sheetName} onChange={(e) => handleSheetChange(e.target.value)} className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-brand-500">
                {sheetNames.length ? sheetNames.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">Sheet</option>}
              </select>
              <div className="flex h-10 items-center overflow-hidden rounded-2xl bg-slate-100">
                <button onClick={() => setZoom((z) => Math.max(50, z - 10))} className="flex h-10 w-10 items-center justify-center text-slate-600"><ZoomOut size={16} /></button>
                <span className="w-16 text-center text-sm font-black text-slate-800">{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(180, z + 10))} className="flex h-10 w-10 items-center justify-center text-slate-600"><ZoomIn size={16} /></button>
              </div>
              <span className="inline-flex h-10 items-center gap-2 rounded-2xl bg-brand-50 px-4 text-xs font-black text-brand-700 ring-1 ring-brand-100"><MousePointer2 size={15} /> 셀 클릭</span>
            </div>
          </div>

          <div className="p-5">
            {loading && <div className="flex min-h-[520px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm font-black text-slate-400">엑셀 미리보기를 불러오는 중입니다.</div>}
            {!loading && !preview && <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 text-center"><Table2 className="text-slate-400" size={34} /><p className="mt-3 text-sm font-black text-slate-600">템플릿을 선택하면 실제 엑셀 미리보기가 표시됩니다.</p><p className="mt-1 text-xs font-semibold text-slate-400">파일은 ai-server 저장소 기준으로 조회합니다.</p></div>}
            {!loading && preview && <ExcelPreviewGrid preview={preview} zoom={zoom} onCellClick={handleCellClick} mappings={mappings} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function ExcelPreviewGrid({ preview, zoom, onCellClick, mappings }) {
  const mappedAddresses = useMemo(() => {
    const addresses = new Set();
    for (const mapping of mappings) {
      if (mapping.cellAddress) addresses.add(mapping.cellAddress);
    }
    return addresses;
  }, [mappings]);

  const scale = zoom / 100;
  const columns = preview.columns || [];
  const rows = preview.rows || [];

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-100 p-3">
      <div className="max-h-[68vh] overflow-auto rounded-2xl bg-white shadow-inner scroll-thin">
        <div className="inline-block min-w-full p-2" style={{ transformOrigin: 'top left' }}>
          <table className="border-collapse bg-white text-xs" style={{ fontSize: `${12 * scale}px` }}>
            <colgroup>
              <col style={{ width: 46 * scale }} />
              {columns.map((col) => <col key={col.letter} style={{ width: (col.widthPx || 80) * scale }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border border-slate-300 bg-slate-200 text-slate-500" style={{ height: 28 * scale }} />
                {columns.map((col) => (
                  <th key={col.letter} className="sticky top-0 z-10 border border-slate-300 bg-slate-200 text-center font-black text-slate-600" style={{ height: 28 * scale }}>
                    {col.letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowNumber} style={{ height: (row.heightPx || 28) * scale }}>
                  <th className="sticky left-0 z-10 border border-slate-300 bg-slate-200 px-2 text-center font-black text-slate-500">{row.rowNumber}</th>
                  {(row.cells || []).map((cell) => {
                    const mapped = mappedAddresses.has(cell.address);
                    const style = cell.style || {};
                    return (
                      <td
                        key={cell.address}
                        onClick={() => onCellClick(cell)}
                        title={`${cell.address} ${cell.text || ''}`}
                        className={`cursor-pointer overflow-hidden px-2 py-1 align-middle transition hover:relative hover:z-10 hover:ring-2 hover:ring-brand-500 ${mapped ? 'ring-2 ring-emerald-500' : ''}`}
                        style={{
                          backgroundColor: mapped ? '#ecfdf5' : style.backgroundColor || '#ffffff',
                          color: style.color || '#0f172a',
                          fontWeight: style.fontWeight || 500,
                          fontSize: `${Math.max(9, (style.fontSize || 11) * scale)}px`,
                          textAlign: style.textAlign || 'center',
                          verticalAlign: style.verticalAlign || 'middle',
                          borderTop: style.borderTop || '1px solid #e2e8f0',
                          borderRight: style.borderRight || '1px solid #e2e8f0',
                          borderBottom: style.borderBottom || '1px solid #e2e8f0',
                          borderLeft: style.borderLeft || '1px solid #e2e8f0',
                          whiteSpace: style.whiteSpace || 'nowrap',
                          minWidth: 60 * scale,
                          maxWidth: 260 * scale
                        }}
                      >
                        <span className="block truncate">{cell.text}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
