import { expect, it } from 'vitest';
import {
  mentionQuery,
  consumeMention,
} from '../apps/web/src/features/chat/chat-mentions';

it('searches names containing spaces at the caret, without treating email as a mention', () => {
  expect(mentionQuery('@AI 探', 5)?.query).toBe('AI 探');
  expect(mentionQuery('你好@AI', 5)?.query).toBe('AI');
  expect(mentionQuery('hello a@b.com', 13)).toBeNull();
  expect(mentionQuery('hello @AI\nnext', 14)).toBeNull();
});
it('consumes only the active query and preserves the message on both sides of the caret', () => {
  const text = '请 @AI 看看这里';
  const query = mentionQuery(text, 5)!;
  expect(consumeMention(text, query.start, query.end)).toEqual({
    text: '请  看看这里',
    caret: 2,
  });
});
it('does not remove a previous mention when choosing another recipient', () => {
  const text = '@Alice 你好 @Bo';
  const query = mentionQuery(text, text.length)!;
  expect(consumeMention(text, query.start, query.end)).toEqual({
    text: '@Alice 你好 ',
    caret: 10,
  });
});
it('consumes a standalone mention without leaving a name in the body', () => {
  const text = '@AI 探索者';
  const query = mentionQuery(text, text.length)!;
  expect(consumeMention(text, query.start, query.end)).toEqual({
    text: '',
    caret: 0,
  });
});
