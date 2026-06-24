import { formatMoney, cleanTableColumnLabel } from './utils.js';

export function Select({ label, value, onChange, options, disabled, highlight }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black text-slate-400">{label}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-2xl px-4 py-3 text-sm font-black outline-none ${highlight ? 'border-2 border-brand-500 bg-brand-50 text-brand-700' : 'border border-slate-200 bg-white text-slate-800 focus:border-brand-500'} disabled:bg-slate-100 disabled:text-slate-400`}
      >
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}

export function Input({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-brand-500"
      />
    </label>
  );
}

export function ActionButton({ label, tone, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mt-5 rounded-2xl px-4 py-3 text-sm font-black disabled:bg-slate-200 disabled:text-slate-400 ${tone === 'blue' ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-glow hover:from-brand-600 hover:to-brand-500' : 'border border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
    >
      {label}
    </button>
  );
}

export function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm font-black ${active ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-glow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  );
}

export function Badge({ tone, children }) {
  const cls = tone === 'blue'
    ? 'bg-brand-50 text-brand-700 border-brand-100'
    : tone === 'green'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : tone === 'amber'
    ? 'bg-amber-50 text-amber-700 border-amber-100'
    : 'bg-slate-100 text-slate-500 border-slate-200';
  return <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black ${cls}`}>{children}</span>;
}

export function Metric({ label, value, tone }) {
  const color = tone === 'blue' ? 'text-brand-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-950';
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 text-center">
      <p className="text-xs font-black text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}

export function InfoCard({ icon, title, value, desc, warning }) {
  return (
    <div className={`rounded-3xl border p-4 ${warning ? 'border-amber-100 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-lg">{icon}</div>
      <p className={`mt-3 text-xs font-black ${warning ? 'text-amber-600' : 'text-slate-400'}`}>{title}</p>
      <p className={`mt-1 text-base font-black ${warning ? 'text-amber-800' : 'text-slate-950'}`}>{value}</p>
      <p className={`mt-1 text-sm leading-5 ${warning ? 'text-amber-700' : 'text-slate-500'}`}>{desc}</p>
    </div>
  );
}

export function TemplateCell({ children, className = '', colSpan, rowSpan, align = 'center' }) {
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={`border border-slate-700 px-2 py-2 align-middle ${align === 'left' ? 'text-left' : 'text-center'} ${className}`}
    >
      {children}
    </td>
  );
}

export function EditableTemplateCell({ value = '', onChange, className = '', colSpan, rowSpan, align = 'center', money = false, disabled = false, placeholder = '' }) {
  const displayValue = money ? formatMoney(value) : String(value ?? '');
  return (
    <TemplateCell colSpan={colSpan} rowSpan={rowSpan} align={align} className={`p-0 ${className}`}>
      <input
        value={displayValue}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled || !onChange}
        placeholder={placeholder}
        className={`h-full min-h-[34px] w-full border-0 bg-transparent px-2 py-2 text-[11px] font-black outline-none focus:bg-brand-50 focus:ring-2 focus:ring-inset focus:ring-brand-400 ${align === 'left' ? 'text-left' : 'text-center'} disabled:cursor-default disabled:text-slate-900`}
      />
    </TemplateCell>
  );
}

export function ReportSection({ number, title, value, onChange, disabled, placeholder = '' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-slate-900">{number}. {title}</p>
      <textarea
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        rows={4}
        placeholder={placeholder}
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold leading-6 text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400 disabled:bg-white"
      />
    </div>
  );
}
