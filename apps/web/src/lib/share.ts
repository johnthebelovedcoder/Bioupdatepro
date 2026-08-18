/**
 * Getting the day's figures to the person who is not holding the phone.
 *
 * The settings screen offers WhatsApp, SMS and email as alert channels and is
 * honest that none of them send anything — there is no messaging integration
 * and there is no server to run one. That honesty does not make the need go
 * away. On a Nigerian farm the owner is frequently not on site, WhatsApp is
 * where the business actually happens, and the manager's evening routine is to
 * type the day's numbers into a chat by hand. Typing them by hand is where they
 * get rounded, mistyped, or quietly improved.
 *
 * This is the part that can be built without a backend: compose the message
 * from the figures already on the screen and hand it to whichever app the
 * person wants to send it from. It is not automated delivery and must never be
 * described as such — the user picks the recipient and presses send themselves,
 * in WhatsApp. What it removes is the retyping, which is the part that
 * introduces errors.
 */

export interface SummaryLine {
  label: string;
  value: string;
}

export interface SummaryInput {
  farmName: string;
  /** Already formatted for display — this file does no formatting of its own. */
  dateLabel: string;
  money: SummaryLine[];
  livestock: SummaryLine[];
  attention: string[];
}

/**
 * A plain-text summary.
 *
 * Deliberately plain: WhatsApp's own markup is inconsistent across clients and
 * SMS has none at all, so anything cleverer would arrive as visible asterisks
 * on somebody's handset.
 */
export function buildSummary(input: SummaryInput): string {
  const parts: string[] = [`${input.farmName} — ${input.dateLabel}`];

  if (input.money.length > 0) {
    parts.push(['MONEY THIS MONTH', ...input.money.map(line)].join('\n'));
  }
  if (input.livestock.length > 0) {
    parts.push(['LIVESTOCK', ...input.livestock.map(line)].join('\n'));
  }
  parts.push(
    input.attention.length > 0
      ? ['NEEDS ATTENTION', ...input.attention.map((item) => `- ${item}`)].join('\n')
      : 'NEEDS ATTENTION\n- Nothing outstanding',
  );

  // Says where the numbers came from, so the person receiving them knows this
  // was read off the system rather than remembered.
  parts.push('Sent from BioAssetPro');
  return parts.join('\n\n');
}

function line(entry: SummaryLine): string {
  return `${entry.label}: ${entry.value}`;
}

/* -------------------------------------------------------------------------- */

/**
 * Links that hand the text to another app.
 *
 * None of these send anything. Each opens the app with the message already
 * composed, and the person chooses the recipient and presses send.
 */
export function shareLinks(text: string): { whatsapp: string; sms: string; email: string } {
  const encoded = encodeURIComponent(text);
  return {
    // No number in the path, so WhatsApp opens its contact picker rather than
    // assuming who this should go to.
    whatsapp: `https://wa.me/?text=${encoded}`,
    sms: `sms:?body=${encoded}`,
    email: `mailto:?subject=${encodeURIComponent('Farm summary')}&body=${encoded}`,
  };
}
