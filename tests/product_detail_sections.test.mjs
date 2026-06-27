import assert from 'node:assert/strict';
import test from 'node:test';

import { getProductDetailSections } from '../utils/productDetailSections.ts';

const normalizeText = (value) => String(value || '').trim();

test('does not show combined usage when usage and composition are empty', () => {
  const sections = getProductDetailSections(
    {
      description: 'Фактичний опис товару.',
      usage: ' ',
      composition: null,
    },
    normalizeText,
  );

  assert.equal(sections.description, 'Фактичний опис товару.');
  assert.equal(sections.usageContraindications, '');
});

test('combines only real usage and contraindications fields', () => {
  const sections = getProductDetailSections(
    {
      description: 'Опис не повинен потрапити до способу застосування.',
      usage: 'Приймати після їжі.',
      composition: 'Не застосовувати при індивідуальній чутливості.',
    },
    normalizeText,
  );

  assert.equal(
    sections.usageContraindications,
    'Приймати після їжі.\n\nНе застосовувати при індивідуальній чутливості.',
  );
  assert.doesNotMatch(sections.usageContraindications, /Опис не повинен/);
});
