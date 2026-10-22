import { describe, expect, it } from 'vitest';
import { planSync } from './sync';

const base = { remote: 't2', knownRemote: 't2', dirty: false, localEmpty: false };

describe('planSync', () => {
  it('does nothing when both sides agree', () => {
    expect(planSync(base)).toBe('none');
  });
  it('pushes local changes when the cloud has not moved', () => {
    expect(planSync({ ...base, dirty: true })).toBe('push');
  });
  it('pulls when only the cloud moved', () => {
    expect(planSync({ ...base, knownRemote: 't1' })).toBe('pull');
  });
  it('flags a conflict when both moved', () => {
    expect(planSync({ ...base, knownRemote: 't1', dirty: true })).toBe('conflict');
  });
  it('creates the cloud copy from a phone that has data', () => {
    expect(planSync({ remote: null, knownRemote: null, dirty: true, localEmpty: false })).toBe('push');
    expect(planSync({ remote: null, knownRemote: null, dirty: true, localEmpty: true })).toBe('none');
  });
  it('a fresh device adopts the cloud copy', () => {
    expect(planSync({ remote: 't2', knownRemote: null, dirty: true, localEmpty: true })).toBe('pull');
  });
  it('an existing phone meeting an existing cloud copy for the first time must ask', () => {
    expect(planSync({ remote: 't2', knownRemote: null, dirty: true, localEmpty: false })).toBe('conflict');
  });
});
