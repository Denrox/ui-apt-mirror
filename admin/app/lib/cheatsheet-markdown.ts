import type { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Formulas are $$...$$ (inline, or a block on lines of their own). Single
// dollars stay text, so prices in a page never turn into math.
export const cheatsheetRemarkPlugins: Options['remarkPlugins'] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];

// A formula KaTeX cannot parse shows its TeX source instead of breaking the page.
export const cheatsheetRehypePlugins: Options['rehypePlugins'] = [[rehypeKatex, { throwOnError: false }]];
