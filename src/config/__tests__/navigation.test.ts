import { describe, it, expect } from 'vitest';
import {
  VIEW_IDS,
  WORKSPACE_NAV,
  MOBILE_TAB_BAR,
  MOBILE_MORE_VIEWS,
  RAIL_WIDTH_PX,
  MOBILE_BOTTOM_NAV_HEIGHT_PX,
} from '../navigation';
import type { ViewId } from '../navigation';

describe('navigation config', () => {
  describe('VIEW_IDS', () => {
    it('contains all expected view identifiers', () => {
      const expected: ViewId[] = ['MainHub', 'FocusMode', 'Communications', 'Integrations', 'Settings'];
      expect([...VIEW_IDS]).toEqual(expect.arrayContaining(expected));
      expect(VIEW_IDS).toHaveLength(expected.length);
    });
  });

  describe('WORKSPACE_NAV', () => {
    it('contains 4 workspace views', () => {
      expect(WORKSPACE_NAV).toHaveLength(4);
    });

    it('each item has id, label, and icon', () => {
      for (const item of WORKSPACE_NAV) {
        expect(typeof item.id).toBe('string');
        expect(typeof item.label).toBe('string');
        expect(typeof item.icon).toBe('string');
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.icon.length).toBeGreaterThan(0);
      }
    });

    it('all ids are valid ViewIds', () => {
      for (const item of WORKSPACE_NAV) {
        expect(VIEW_IDS).toContain(item.id);
      }
    });

    it('starts with MainHub', () => {
      expect(WORKSPACE_NAV[0]?.id).toBe('MainHub');
    });
  });

  describe('MOBILE_TAB_BAR', () => {
    it('contains 3 items', () => {
      expect(MOBILE_TAB_BAR).toHaveLength(3);
    });

    it('all ids are valid ViewIds', () => {
      for (const item of MOBILE_TAB_BAR) {
        expect(VIEW_IDS).toContain(item.id);
      }
    });
  });

  describe('MOBILE_MORE_VIEWS', () => {
    it('contains at least one item', () => {
      expect(MOBILE_MORE_VIEWS.length).toBeGreaterThan(0);
    });

    it('all ids are valid ViewIds', () => {
      for (const item of MOBILE_MORE_VIEWS) {
        expect(VIEW_IDS).toContain(item.id);
      }
    });
  });

  describe('pixel constants', () => {
    it('RAIL_WIDTH_PX is a positive number', () => {
      expect(RAIL_WIDTH_PX).toBeGreaterThan(0);
    });

    it('MOBILE_BOTTOM_NAV_HEIGHT_PX is a positive number', () => {
      expect(MOBILE_BOTTOM_NAV_HEIGHT_PX).toBeGreaterThan(0);
    });
  });
});
