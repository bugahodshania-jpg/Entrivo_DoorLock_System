export const registrationDraftKey = 'entrivo_public_register_draft';
export const verifiedRfidKey = 'entrivo_verified_rfid_uid';

export function clearRegistrationSession(storage) {
  try {
    storage.removeItem(registrationDraftKey);
    storage.removeItem(verifiedRfidKey);
  } catch {
    // Registration can still run when browser storage is unavailable.
  }
}

export function clearRegistrationOutsidePage(path, storage) {
  if (path !== '/register') clearRegistrationSession(storage);
}

export function registrationResumeAction(storage, displayedUid) {
  try {
    const uid = storage.getItem(verifiedRfidKey);
    if (!uid) return 'verify';
    const draft = JSON.parse(storage.getItem(registrationDraftKey) || 'null');
    if (uid !== displayedUid || draft?.form?.rfid_uid !== uid) return 'reload';
    return null;
  } catch {
    return 'verify';
  }
}
