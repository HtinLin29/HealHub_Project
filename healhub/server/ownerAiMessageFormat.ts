/**
 * Normalize Owner AI reply text: straight quotes + owner-preferred ID spellings.
 */
export function formatOwnerAiReply(text: string): string {
  let s = text;
  // Curly / typographic quotes → straight ASCII
  s = s.replace(/[\u201C\u201D\u201E\u2033\u2036\u00AB\u00BB]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u2032\u2035]/g, "'");

  // HealHub owner UIs use Thai Baht; model often prints $ for amounts
  s = s.replace(/\$\s*(\d+(?:\.\d{2})?)\b/g, '฿$1');

  // Prefer underscore + Id/ID style (owner convention)
  const idPairs: [RegExp, string][] = [
    [/\buserId\b/g, 'user_Id'],
    [/\borderId\b/g, 'Order_ID'],
    [/\brefundId\b/g, 'Refund_ID'],
    [/\bcustomerId\b/g, 'Customer_ID'],
    [/\bproductId\b/g, 'Product_ID'],
    [/\bpaymentId\b/g, 'Payment_ID'],
    [/\bshipmentId\b/g, 'Shipment_ID'],
    [/\bconversationId\b/g, 'Conversation_ID'],
    [/\bpatientId\b/g, 'Patient_ID'],
  ];
  for (const [re, rep] of idPairs) {
    s = s.replace(re, rep);
  }

  return s;
}
