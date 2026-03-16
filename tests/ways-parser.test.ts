import { describe, expect, it } from 'vitest';
import { isRuntimeOnlyWaysMessage } from '../parsers/ways-parser';

describe('isRuntimeOnlyWaysMessage', () => {
  it('treats bare placeholders as runtime-only', () => {
    expect(isRuntimeOnlyWaysMessage('{createdAt}')).toBe(true);
  });

  it('treats Intl formatter messages as runtime-only', () => {
    expect(isRuntimeOnlyWaysMessage('{createdAt, date, dateStyle:short}')).toBe(true);
    expect(isRuntimeOnlyWaysMessage('{amount, money}')).toBe(true);
  });

  it('treats plural and select blocks as runtime-only only when their branches are runtime-only', () => {
    expect(
      isRuntimeOnlyWaysMessage(
        '{count, plural, =0{{count}} other{{count, number, maximumFractionDigits:0}}}'
      )
    ).toBe(true);
    expect(
      isRuntimeOnlyWaysMessage('{isMember, select, true{{name}} false{{fallback}} other{{name}}}')
    ).toBe(true);
  });

  it('rejects messages that contain literal text', () => {
    expect(isRuntimeOnlyWaysMessage('Hello {name}')).toBe(false);
    expect(
      isRuntimeOnlyWaysMessage('{count, plural, =0{No messages} other{{count} messages}}')
    ).toBe(false);
    expect(
      isRuntimeOnlyWaysMessage(
        '{isMember, select, true{Welcome back} false{{fallback}} other{{name}}}'
      )
    ).toBe(false);
  });
});
