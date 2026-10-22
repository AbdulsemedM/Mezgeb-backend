import { fileURLToPath } from 'node:url';
import type { Language } from '@mezgeb/shared';
import PDFDocument from 'pdfkit';
import { t } from '../i18n/messages.js';
import type { Statement } from './statements.service.js';

/** Noto Sans Ethiopic covers Ge'ez and Latin, so one font prints every language (OFL). */
const FONT = fileURLToPath(
  new URL('../../assets/fonts/NotoSansEthiopic-Regular.ttf', import.meta.url),
);
const FONT_BOLD = fileURLToPath(
  new URL('../../assets/fonts/NotoSansEthiopic-Bold.ttf', import.meta.url),
);

const INK = '#14302a';
const INK2 = '#4b5c57';
const RULE = '#c9d3cf';
const MARGIN_RULE = '#c0392b';

/** Column widths on A4 with 40pt margins (515pt of room). */
const COLUMNS = [
  { key: 'date', width: 82, align: 'left' },
  { key: 'what', width: 185, align: 'left' },
  { key: 'who', width: 78, align: 'left' },
  { key: 'amount', width: 82, align: 'right' },
  { key: 'balance', width: 88, align: 'right' },
] as const;

/** The statement as an A4 PDF: header, opening balance, one row per entry, closing balance. */
export function renderStatementPdf(
  s: Statement,
  money: (santim: number, language: Language) => string,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: s.title } });
  doc.registerFont('body', FONT);
  doc.registerFont('bold', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const lang = s.language;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // Header, with the ledger's red margin rule.
  doc.rect(left - 12, 40, 3, 70).fill(MARGIN_RULE);
  doc.font('bold').fontSize(20).fillColor(INK).text(s.title, left, 40);
  const field = (label: string, value: string) => {
    doc.font('bold').fontSize(10).fillColor(INK2).text(`${label}: `, { continued: true });
    doc.font('body').fillColor(INK).text(value);
  };
  field(t('statement.shop', lang), s.shop);
  field(t('statement.customer', lang), s.customer);
  field(t('statement.period', lang), s.period);
  doc.moveDown(0.8);

  const line = (label: string, santim: number) => {
    const y = doc.y;
    doc
      .font('bold')
      .fontSize(11)
      .fillColor(INK)
      .text(label, left, y, { width: width - 140 });
    doc.text(money(santim, lang), left + width - 140, y, { width: 140, align: 'right' });
    doc.moveDown(0.4);
  };
  line(t('statement.opening', lang), s.opening);

  const header = () => {
    const y = doc.y;
    let x = left;
    doc.font('bold').fontSize(9).fillColor(INK2);
    for (const c of COLUMNS) {
      doc.text(t(`statement.col_${c.key}`, lang), x, y, { width: c.width - 6, align: c.align });
      x += c.width;
    }
    doc.y = y + 16;
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .strokeColor(RULE)
      .stroke();
    doc.y += 4;
  };
  header();

  if (s.rows.length === 0) {
    doc.font('body').fontSize(10).fillColor(INK2).text(t('statement.no_entries', lang), left);
    doc.moveDown();
  }
  for (const row of s.rows) {
    const cells: Record<(typeof COLUMNS)[number]['key'], string> = {
      date: row.date,
      what: row.what,
      who: row.who,
      amount: money(row.amount, lang),
      balance: money(row.balance, lang),
    };
    doc.font('body').fontSize(9);
    const height = Math.max(
      ...COLUMNS.map((c) => doc.heightOfString(cells[c.key], { width: c.width - 6 })),
    );
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    let x = left;
    for (const c of COLUMNS) {
      doc.fillColor(INK).text(cells[c.key], x, y, { width: c.width - 6, align: c.align });
      x += c.width;
    }
    doc.y = y + height + 4;
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    doc.y += 4;
  }

  doc.moveDown(0.6);
  line(t('statement.closing', lang), s.closing);
  doc.moveDown(0.6);
  doc.font('body').fontSize(8).fillColor(INK2);
  if (s.head) {
    doc.text(t('statement.chain', lang, { seq: s.head.seq, hash: s.head.hash }), left, doc.y, {
      width,
    });
  }
  doc.text(s.generated, left, doc.y, { width });
  doc.end();
  return done;
}
