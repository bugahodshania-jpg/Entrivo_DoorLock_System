export function saveLoginNotice(storage, reason) {
  const message = typeof reason === 'string' ? reason.trim() : '';
  if (message) storage.setItem('entrivo_login_notice', message);
  else storage.removeItem('entrivo_login_notice');
}
