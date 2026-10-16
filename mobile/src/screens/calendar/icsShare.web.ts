/**
 * Web: download the .ics. Every desktop calendar (Outlook, Apple Calendar)
 * opens it on double-click, and Google Calendar imports it.
 */
export async function saveIcs(text: string, filename: string, _dialogTitle: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
