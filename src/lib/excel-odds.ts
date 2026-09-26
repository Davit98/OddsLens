export type OddsSheet = {
  name: string;
  rows: Array<Array<string | number | null>>;
};

export async function downloadOddsWorkbook(sheets: OddsSheet[], filename: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const ref = worksheet["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      worksheet["!cols"] = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => {
        const column = range.s.c + index;
        let width = 12;
        for (let row = range.s.r; row <= range.e.r; row += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          const length = cell?.v == null ? 0 : String(cell.v).length;
          if (length + 2 > width) width = length + 2;
        }
        return { wch: Math.min(width, 28) };
      });
      for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
        for (let column = range.s.c + 1; column <= range.e.c; column += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell && cell.t === "n") cell.z = "0.00";
        }
      }
      worksheet["!autofilter"] = { ref };
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }

  XLSX.writeFile(workbook, filename);
}
