import assert from 'node:assert/strict';
import test from 'node:test';
import { describeError, tlsCauseHint } from '../errors.js';

test('普通 Error 原样返回 message', () => {
  assert.equal(describeError(new Error('上游接口 500')), '上游接口 500');
});

test('fetch failed 展开 cause 链：暴露 ECONNREFUSED 等真实原因', () => {
  const network = Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:8899') });
  const s = describeError(network);
  assert.ok(s.includes('fetch failed'));
  assert.ok(s.includes('connect ECONNREFUSED 127.0.0.1:8899'));
});

test('多层 cause 链展开到最内层', () => {
  const inner = new Error('getaddrinfo ENOTFOUND api.openverse.org');
  const mid = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { cause: inner });
  const top = Object.assign(new TypeError('fetch failed'), { cause: mid });
  const s = describeError(top);
  assert.ok(s.includes('getaddrinfo ENOTFOUND api.openverse.org'));
  assert.ok(s.includes('connect ECONNREFUSED'));
  assert.ok(s.includes('fetch failed'));
});

test('TimeOutError/AbortError 归一化为超时描述', () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.equal(describeError(timeout), '请求超时或已中止');
  const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  assert.equal(describeError(aborted), '请求超时或已中止');
});

test('cause 循环引用不死循环；重复消息不重复拼接', () => {
  const cyc: Error & { cause?: unknown } = new Error('loop');
  cyc.cause = cyc;
  assert.equal(describeError(cyc), 'loop');
  const dup = Object.assign(new TypeError('fetch failed'), { cause: new Error('fetch failed') });
  assert.equal(describeError(dup), 'fetch failed');
});

test('非 Error 值安全转换', () => {
  assert.equal(describeError('boom'), 'boom');
  assert.equal(describeError(undefined), 'undefined');
  assert.equal(describeError(null), 'null');
  assert.equal(describeError({ code: 500 }), JSON.stringify({ code: 500 }));
});

test('tlsCauseHint：证书类失败（含 cause 链）返回可操作提示', () => {
  const selfSigned = Object.assign(new TypeError('fetch failed'), {
    cause: new Error('unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca'),
  });
  const hint = tlsCauseHint(selfSigned);
  assert.ok(hint.includes('--use-system-ca'));
  assert.ok(hint.includes('NODE_EXTRA_CA_CERTS'));
  assert.ok(hint.includes('NODE_TLS_REJECT_UNAUTHORIZED'));

  const cas = Object.assign(new TypeError('fetch failed'), { cause: new Error('self-signed certificate in certificate chain') });
  assert.ok(tlsCauseHint(cas).includes('NODE_OPTIONS'));
});

test('tlsCauseHint：非证书失败返回空串', () => {
  assert.equal(tlsCauseHint(new Error('connect ECONNREFUSED 127.0.0.1:9')), '');
  assert.equal(tlsCauseHint(Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND api.example.com') })), '');
  assert.equal(tlsCauseHint(new Error('HTTP 500')), '');
});