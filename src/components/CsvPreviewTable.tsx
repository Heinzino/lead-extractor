type Props = {
  headers: string[];
  rows: string[][];
  totalRows: number;
};

export default function CsvPreviewTable({ headers, rows, totalRows }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-500">
        Preview · first {rows.length} of {totalRows} row{totalRows === 1 ? '' : 's'}
      </p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto max-h-72 overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={`${header}-${i}`}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-600 whitespace-nowrap border-b border-gray-200"
                  title={header}
                >
                  <span className="block max-w-[240px] truncate">{header || '—'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-gray-100 last:border-b-0">
                {headers.map((_, colIdx) => {
                  const cell = row[colIdx] ?? '';
                  return (
                    <td
                      key={colIdx}
                      className="px-3 py-2 text-gray-700 align-top"
                      title={cell}
                    >
                      {cell
                        ? <span className="block max-w-[240px] truncate">{cell}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
