import { DesignReportPreview } from './DesignReportPreview.jsx';

export function DesignSummaryPreview({ table, issues, design, updateCell, removeRow, disabled, updateColumnLabel, removeColumn }) {
  return <DesignReportPreview table={table} issues={issues} design={design} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />;
}
