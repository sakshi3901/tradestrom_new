export function isGmail(email = "") {
  return /^[^\s@]+@(gmail|googlemail)\.com$/i.test(String(email).trim());
}
