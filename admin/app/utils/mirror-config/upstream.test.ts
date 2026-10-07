import { describe, expect, it } from 'vitest';
import { filtersCombine } from './upstream';

describe('filtersCombine', () => {
  it('accepts filters that differ in one include list only', () => {
    expect(filtersCombine([{ include_binary_packages: ['hello'] }, { include_binary_packages: ['sl', 'hello'] }])).toBe(true);
    expect(
      filtersCombine([
        { include_source_name: ['a'], include_sections: ['games'] },
        { include_source_name: ['b'], include_sections: ['games'] },
        { include_source_name: ['c'], include_sections: ['games'] },
      ]),
    ).toBe(true);
    expect(filtersCombine([{ exclude_binary_packages: ['x', 'y'] }, { exclude_binary_packages: ['y', 'x'] }])).toBe(true);
  });

  it('refuses different kinds of filters', () => {
    expect(filtersCombine([{ include_binary_packages: ['hello', 'sl'] }, { include_source_name: ['hello'] }])).toBe(false);
    expect(filtersCombine([{ include_binary_packages: ['hello'] }, { include_sections: ['games'] }])).toBe(false);
    expect(
      filtersCombine([{ include_binary_packages: ['hello'] }, { include_binary_packages: ['sl'], exclude_binary_packages: ['hello'] }]),
    ).toBe(false);
  });

  it('refuses filters that differ in more than one list, or in an exclude list', () => {
    expect(
      filtersCombine([
        { include_binary_packages: ['a'], include_sections: ['games'] },
        { include_binary_packages: ['b'], include_sections: ['libs'] },
      ]),
    ).toBe(false);
    expect(filtersCombine([{ exclude_binary_packages: ['a'] }, { exclude_binary_packages: ['b'] }])).toBe(false);
  });
});
