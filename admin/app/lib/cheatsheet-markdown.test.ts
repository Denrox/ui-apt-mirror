import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { cheatsheetRehypePlugins, cheatsheetRemarkPlugins } from './cheatsheet-markdown';

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: cheatsheetRemarkPlugins, rehypePlugins: cheatsheetRehypePlugins },
      markdown,
    ),
  );

describe('cheatsheet markdown', () => {
  it('renders inline $$...$$ formulas with KaTeX', () => {
    const html = render('A solution $$x_1 = 3$$ of the system.');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('katex-display');
    expect(html).toContain('A solution');
  });

  it('renders a $$ block on its own lines as display math', () => {
    expect(render('Text\n\n$$\n\\frac{a}{b}\n$$\n')).toContain('katex-display');
  });

  it('leaves single dollars (prices) as text', () => {
    const html = render('Four sandwiches for $8.45 and coffee for $1.20.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$8.45 and coffee for $1.20');
  });

  it('shows the source of a formula KaTeX cannot parse instead of failing', () => {
    const html = render('Bad $$\\notamacro{x}$$ here, then text.');
    expect(html).toContain('notamacro');
    expect(html).toContain('then text');
  });

  it('still renders GFM tables', () => {
    expect(render('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>');
  });
});
