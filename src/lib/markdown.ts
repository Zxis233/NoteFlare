import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import verilog from "highlight.js/lib/languages/verilog";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import tcl from "highlight.js/lib/languages/tcl";
import diff from "highlight.js/lib/languages/diff";
import makefile from "highlight.js/lib/languages/makefile";
import powershell from "highlight.js/lib/languages/powershell";

// Import only the requested grammars, never the full/common bundle.
// Verilog includes SystemVerilog; INI includes TOML; XML includes HTML.
for (const [name, grammar] of Object.entries({
  verilog,
  json,
  bash,
  yaml,
  ini,
  c,
  cpp,
  python,
  javascript,
  xml,
  css,
  tcl,
  diff,
  makefile,
  powershell,
})) {
  hljs.registerLanguage(name, grammar);
}

const languages = new Map<string, string>([
  ["verilog", "verilog"],
  ["v", "verilog"],
  ["systemverilog", "verilog"],
  ["sv", "verilog"],
  ["svh", "verilog"],
  ["json", "json"],
  ["bash", "bash"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "ini"],
  ["ini", "ini"],
  ["c", "c"],
  ["h", "c"],
  ["cpp", "cpp"],
  ["c++", "cpp"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["hpp", "cpp"],
  ["python", "python"],
  ["py", "python"],
  ["js", "javascript"],
  ["javascript", "javascript"],
  ["html", "xml"],
  ["htm", "xml"],
  ["css", "css"],
  ["tcl", "tcl"],
  ["tk", "tcl"],
  ["diff", "diff"],
  ["patch", "diff"],
  ["makefile", "makefile"],
  ["make", "makefile"],
  ["mk", "makefile"],
  ["mak", "makefile"],
  ["powershell", "powershell"],
  ["ps1", "powershell"],
  ["ps", "powershell"],
]);

export const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(source, name) {
    const language = languages.get(name.toLowerCase());
    // Empty return value asks markdown-it to escape as plain text.
    // Do not auto-detect languages: it adds work and guesses incorrectly.
    if (!language) return "";
    try {
      return hljs.highlight(source, { language, ignoreIllegals: true }).value;
    } catch {
      return "";
    }
  },
});

// Wrap both fenced and indented blocks; keep the code element untouched so
// textContent remains the decoded source, without the copy button's label.
for (const rule of ["fence", "code_block"] as const) {
  const render = markdownParser.renderer.rules[rule]!;
  markdownParser.renderer.rules[rule] = (...args) =>
    '<div class="code-block"><div class="code-block-toolbar">' +
    '<button type="button" class="code-block-copy" aria-label="复制代码" aria-live="polite" title="复制代码">复制</button>' +
    "</div>" +
    render(...args) +
    "</div>\n";
}
