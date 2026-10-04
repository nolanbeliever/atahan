import { describe, expect, it } from 'vitest';
import { KEY, moveDirection } from '../../shared/physics';
import { STICK_DEAD_ZONE, stickKeys } from '../../client/src/game/stick';

describe('touch joystick', () => {
  it('ignores small deflections', () => {
    expect(stickKeys(0, 0, false)).toBe(0);
    expect(stickKeys(STICK_DEAD_ZONE * 0.9, 0, false)).toBe(0);
  });

  it('maps the four axes and the diagonals like WASD', () => {
    expect(stickKeys(0, -0.6, false)).toBe(KEY.FORWARD);
    expect(stickKeys(0, 0.6, false)).toBe(KEY.BACK);
    expect(stickKeys(-0.6, 0, false)).toBe(KEY.LEFT);
    expect(stickKeys(0.6, 0, false)).toBe(KEY.RIGHT);
    expect(stickKeys(0.45, -0.45, false)).toBe(KEY.FORWARD | KEY.RIGHT);
    expect(stickKeys(-0.45, 0.45, false)).toBe(KEY.BACK | KEY.LEFT);
  });

  it('never presses opposite keys and always yields a walking direction', () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
      const k = stickKeys(Math.cos(a) * 0.7, Math.sin(a) * 0.7, false);
      expect(k & KEY.FORWARD && k & KEY.BACK).toBeFalsy();
      expect(k & KEY.LEFT && k & KEY.RIGHT).toBeFalsy();
      expect(moveDirection(k, 0)).not.toBeNull();
    }
  });

  it('sprints at full deflection on foot but not while driving', () => {
    expect(stickKeys(0, -1, false)).toBe(KEY.FORWARD | KEY.SPRINT);
    expect(stickKeys(0, -1, true)).toBe(KEY.FORWARD);
    expect(stickKeys(0, -0.6, false) & KEY.SPRINT).toBe(0);
  });
});
