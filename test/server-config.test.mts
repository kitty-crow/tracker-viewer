import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listenerConfig } from '../scripts/server-config.mts';

test('defaults to loopback and the standard port', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-listen-default-'));
  try {
    expect(listenerConfig({ appRoot: root, cwd: root, environment: {} })).toEqual({
      ip: '127.0.0.1', port: 59413, browserUrl: 'http://127.0.0.1:59413/',
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reads IP and PORT beside the EXE without rebuilding', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-listen-custom-'));
  try {
    const release = join(root, 'release');
    mkdirSync(release);
    writeFileSync(join(root, '.env'), 'IP=127.0.0.1\nPORT=59413\n');
    writeFileSync(join(release, '.env'), 'IP="192.168.1.42"\nPORT=60123\n');
    expect(listenerConfig({ exeDir: release, appRoot: root, environment: {} })).toEqual({
      ip: '192.168.1.42', port: 60123, browserUrl: 'http://192.168.1.42:60123/',
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('wildcard binding uses loopback for the browser shortcut', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-listen-wildcard-'));
  try {
    writeFileSync(join(root, '.env'), 'IP=0.0.0.0\nPORT=60500\n');
    expect(listenerConfig({ appRoot: root, cwd: root, environment: {} })).toEqual({
      ip: '0.0.0.0', port: 60500, browserUrl: 'http://127.0.0.1:60500/',
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects invalid IP addresses and ports', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-listen-invalid-'));
  try {
    writeFileSync(join(root, '.env'), 'IP=example.com\nPORT=59413\n');
    expect(() => listenerConfig({ appRoot: root, cwd: root, environment: {} })).toThrow('Invalid IP');
    writeFileSync(join(root, '.env'), 'IP=127.0.0.1\nPORT=79413\n');
    expect(() => listenerConfig({ appRoot: root, cwd: root, environment: {} })).toThrow('PORT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release executable reads the parent project .env', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-parent-env-'));
  try {
    const release = join(root, 'release');
    mkdirSync(release);
    writeFileSync(join(root, '.env'), ['IP=0.0.0.0', 'PORT=59413', 'TRACKER_FOLDER="./public"', ''].join('\n'));
    expect(listenerConfig({ exeDir: release, appRoot: release, cwd: release, environment: {} })).toEqual({
      ip: '0.0.0.0', port: 59413, browserUrl: 'http://127.0.0.1:59413/',
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
