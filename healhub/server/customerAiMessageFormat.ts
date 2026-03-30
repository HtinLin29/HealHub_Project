/**
 * Light cleanup for customer assistant replies: typography + USD → Baht.
 * Deliberately does not apply owner-only ID spellings.
 */
export function formatCustomerAiReply(text: string): string {
  let s = text;
  s = s.replace(/[\u201C\u201D\u201E\u2033\u2036\u00AB\u00BB]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u2032\u2035]/g, "'");
  s = s.replace(/\$\s*(\d+(?:\.\d{2})?)\b/g, '฿$1');
  return s;
}
