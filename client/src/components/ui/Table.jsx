export function Table({ columns, rows, keyFn, emptyState, className = '', fixed = false }) {
  if (!rows || rows.length === 0) return <>{emptyState}</>;

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className={`min-w-full divide-y divide-slate-200 text-sm ${fixed ? 'table-fixed' : ''}`}>
        <thead>
          <tr className="bg-slate-50/90 border-b border-slate-200">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap ${
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                    ? 'text-center'
                    : 'text-left'
                } ${col.className || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, index) => (
            <tr
              key={keyFn ? keyFn(row) : row.id || index}
              className="hover:bg-sky-50/30 transition-colors duration-150"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-4 py-3 align-middle text-slate-800 ${
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                  } ${col.className || ''}`}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
