import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnableLambda } from '@langchain/core/runnables';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { createGenerator } from '../server/generate.js';
import { createReranker } from '../server/rerank.js';

function recordingModel(responses) {
  const model = new FakeListChatModel({ responses });
  const seen = [];
  const invoke = model.invoke.bind(model);
  model.invoke = async (input, options) => {
    seen.push(input.toChatMessages());
    return invoke(input, options);
  };
  return { model, seen };
}

test('answer: sources are numbered and history keeps speaker roles', async () => {
  const { model: chat, seen } = recordingModel(['Inception [1].']);
  const generator = createGenerator({ models: { chat, rewriter: chat } });

  const reply = await generator.answer({
    message: 'a heist film with {braces}',
    history: [
      { role: 'user', content: 'something like {this}' },
      { role: 'assistant', content: 'Try Heat [1].' },
    ],
    sources: [{ content: 'Inception (2010)' }, { content: 'Heat (1995)' }],
  });

  assert.equal(reply, 'Inception [1].');
  const [system, user, ai, question] = seen[0];
  assert.equal(system._getType(), 'system');
  assert.deepEqual([user._getType(), user.content], ['human', 'something like {this}']);
  assert.deepEqual([ai._getType(), ai.content], ['ai', 'Try Heat [1].']);
  assert.match(question.content, /\[1\] Inception \(2010\)\n\[2\] Heat \(1995\)/);
  assert.match(question.content, /Question: a heist film with \{braces\}$/);
});

test('rewrite: falls back to the original message on an empty rewrite', async () => {
  const { model: rewriter } = recordingModel(['  ']);
  const generator = createGenerator({ models: { chat: rewriter, rewriter } });
  assert.equal(await generator.rewrite('the second one?', [{ role: 'user', content: 'x' }]), 'the second one?');
});

test('rerank: maps structured scores back to candidates and sorts by score', async () => {
  let options;
  const ranker = {
    withStructuredOutput: (_schema, opts) => {
      options = opts;
      return RunnableLambda.from(() => ({ scores: [{ id: 1, score: 3 }, { id: 2, score: 9 }] }));
    },
  };
  const rerank = createReranker({ models: { ranker } });
  const out = await rerank('space', [
    { id: 10, title: 'Superbad', year: 2007, content: 'comedy' },
    { id: 11, title: 'Interstellar', year: 2014, content: 'space' },
    { id: 12, title: 'Up', year: 2009, content: 'balloons' },
  ]);

  assert.equal(options.strict, true);
  assert.deepEqual(out.map((c) => [c.title, c.rerankScore]), [['Interstellar', 9], ['Superbad', 3], ['Up', 0]]);
});
