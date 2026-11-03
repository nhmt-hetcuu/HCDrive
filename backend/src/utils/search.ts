// Case- and accent-insensitive key for name search, so "de thi" finds "Đề thi".
// SQLite's LIKE only folds ASCII case, so names are matched in JavaScript with this instead.
export function searchKey(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}
