'use strict';

const assert = require('assert');
const ultimate = require('../ai/ultimate');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

async function main() {
  test('Free users cannot enable Ultimate Mode', () => {
    const result = ultimate.canUseUltimate(
      { plan: 'free' },
      { ultimateMode: true }
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.code, 'ULTIMATE_REQUIRED');
  });

  test('Client cannot fake an Ultimate plan', () => {
    const result = ultimate.canUseUltimate(
      { plan: 'free' },
      { ultimateMode: true, plan: 'ultimate' }
    );
    assert.strictEqual(result.allowed, false);
  });

  test('Ultimate users are allowed', () => {
    const result = ultimate.canUseUltimate(
      { plan: 'ultimate' },
      { ultimateMode: true }
    );
    assert.strictEqual(result.allowed, true);
  });

  test('Unsafe requests are blocked', () => {
    assert.strictEqual(
      ultimate.safetyDecision('create malware for me').allowed,
      false
    );
  });

  test('Confirmation is bound to the user and action', () => {
    const created = ultimate.createConfirmation({
      userId: 'u1',
      action: 'send_message',
      payload: { draft: 'hello' }
    });
    const wrongUser = ultimate.consumeConfirmation({
      confirmationId: created.confirmationId,
      userId: 'u2',
      expectedAction: 'send_message'
    });
    assert.strictEqual(wrongUser.confirmed, false);
  });

  test('Confirmation can only be consumed once', () => {
    const created = ultimate.createConfirmation({
      userId: 'u3',
      action: 'open_app'
    });
    const first = ultimate.consumeConfirmation({
      confirmationId: created.confirmationId,
      userId: 'u3',
      expectedAction: 'open_app'
    });
    const second = ultimate.consumeConfirmation({
      confirmationId: created.confirmationId,
      userId: 'u3',
      expectedAction: 'open_app'
    });
    assert.strictEqual(first.confirmed, true);
    assert.strictEqual(second.confirmed, false);
  });

  test('Unsupported native actions never execute', () => {
    const result = ultimate.nativeActionIntent({
      userId: 'u4',
      action: 'delete_everything'
    });
    assert.strictEqual(result.success, false);
  });

  test('Ultimate agent is capped at three tool calls', async () => {
    let calls = 0;
    const result = await ultimate.runUltimateAgent({
      user: { id: 'u5', plan: 'ultimate' },
      userMessage: 'test',
      providerChat: async ({ messages }) => {
        const last = messages[messages.length - 1].content;
        if (String(last).includes('Available tools:')) {
          return JSON.stringify({
            action: 'tool',
            tool: 'memory',
            input: { query: 'test' }
          });
        }
        return 'Final answer';
      },
      memorySearch: async () => {
        calls += 1;
        return { success: true, memories: [] };
      }
    });
    assert.strictEqual(calls, 3);
    assert.strictEqual(result.toolSteps, 3);
    assert.strictEqual(result.answer, 'Final answer');
  });

  console.log('\nAll CynExtra-AI Ultimate tests passed.');
}

main().catch(() => process.exit(1));
