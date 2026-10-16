/**
 * Hand a .ics file to the phone's share sheet, where "Calendar", "Outlook" or
 * "Google Calendar" picks it up.
 *
 * `expo-file-system/legacy`, deliberately — the same choice and the same
 * reason as media/recorder.native.ts: v19's default export is the new
 * object API, and the string-writing helpers live on the legacy surface.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/** @returns false when this device has no share sheet. */
export async function saveIcs(text: string, filename: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'interprova.ics';
  const uri = `${FileSystem.cacheDirectory}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle });
  return true;
}
