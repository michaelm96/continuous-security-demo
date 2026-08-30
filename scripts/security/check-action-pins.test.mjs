import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWorkflow, inspectWorkflowFiles } from './check-action-pins.mjs';

test('blocks owner/repo without SHA', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
  assert.equal(result.pinned.length, 0);
});

test('passes owner/repo@sha256:hex', () => {
  const sha = 'a'.repeat(64);
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@sha256:${sha}`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
  assert.ok(result.pinned.length >= 1);
});

test('passes full SHA commit (40 hex chars)', () => {
  const sha = 'deadbeef1234567890abcdef1234567890abcdef';
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${sha}`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
  assert.ok(result.pinned.length >= 1);
});

test('short SHA is mutable', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@main`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('branch name is mutable', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@develop`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('tag is mutable', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v1.2.3`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('local action is allowed', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./local-action`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
  assert.equal(result.pinned.length, 0);
});

test('docker image with sha256 digest passes', () => {
  const sha = 'a'.repeat(64);
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker://node:20@sha256:${sha}`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
});

test('docker image without digest fails', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker://node:20`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('docker image with mutable tag fails', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker://node:latest`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('commented uses line is ignored', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      # - uses: actions/checkout@v4`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
});

test('quoted uses is parsed correctly', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: \"actions/checkout@v4\"`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('diagnostic contains file and line', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4`;
  const result = inspectWorkflow(source, 'workflow.yml');
  assert.ok(result.mutable.length >= 1);
  const item = result.mutable[0];
  assert.equal(item.file, 'workflow.yml');
  assert.ok(item.line > 0);
});

test('mixed pinned and mutable actions', () => {
  const sha = 'a'.repeat(40);
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${sha}\n      - uses: actions/setup-node@v4`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 1);
  assert.ok(result.pinned.length >= 1);
});

test('returns mutable and pinned arrays', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(Array.isArray(result.mutable));
  assert.ok(Array.isArray(result.pinned));
});

test('uppercase SHA is accepted', () => {
  const sha = 'DEADBEEF1234567890ABCDEF1234567890ABCDEF';
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${sha}`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
});

test('expression in uses fails', () => {
  const actionExpr = "${{ github.event.inputs.action || 'v1' }}";
  const source = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ${actionExpr}`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.ok(result.mutable.length >= 1);
});

test('empty source returns empty arrays', () => {
  const result = inspectWorkflow('', 'empty.yml');
  assert.equal(result.mutable.length, 0);
  assert.equal(result.pinned.length, 0);
});

test('no uses statements returns empty arrays', () => {
  const source = `jobs:\n  build:\n    runs-on: ubuntu-latest`;
  const result = inspectWorkflow(source, 'test.yml');
  assert.equal(result.mutable.length, 0);
  assert.equal(result.pinned.length, 0);
});
