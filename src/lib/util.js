export function uid(p) {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
export function pad(n) {
  return String(n).padStart(2, "0");
}

// Windows, OneDrive and Excel all choke on different characters; strip the
// union of them so a caption can be typed naturally on site.
export function safeFileName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|#%{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
