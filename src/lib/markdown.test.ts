import { describe, expect, it } from "vitest";
import { markdownParser } from "./markdown";

const samples: [string, string][] = [
  ["Verilog", "module demo(input clk); endmodule"],
  ["SystemVerilog", "logic ready; always_ff @(posedge clk) ready <= 1'b1;"],
  ["Json", '{"ready": true}'],
  ["bash", 'echo "$HOME"'],
  ["yaml", "ready: true"],
  ["toml", '[app]\nname = "NoteFlare"'],
  ["c", "int main(void) { return 0; }"],
  ["cpp", "class Note { public: bool ready = true; };"],
  ["python", "def hello():\n    return True"],
  ["ini", "[app]\nport=8787"],
  ["js", 'const name = "NoteFlare";'],
  ["html", '<div class="note">Hello</div>'],
  ["css", ".note { color: red; }"],
  ["Tcl", 'set name "NoteFlare"\nputs $name'],
  ["diff", "-old value\n+new value"],
  ["makefile", "all: build\n\t$(CC) main.c -o app"],
  ["PowerShell", '$name = "NoteFlare"\nWrite-Host $name'],
];
const renderCode = (language: string, code: string) =>
  markdownParser.render(`\`\`\`${language}\n${code}\n\`\`\``);

describe("Markdown preview highlighting", () => {
  it.each(samples)(
    "highlights %s, including case-insensitive names",
    (language, code) => {
      expect(renderCode(language, code)).toContain('class="hljs-');
    },
  );
  it.each(["sv", "svh", "sh", "yml", "py", "javascript", "c++", "htm"])(
    "supports alias %s",
    (language) => {
      const source =
        '<div>hi</div>\nclass Note;\nalways_ff @(posedge clk) ready <= 1;\necho "hello"\nname: true\ndef foo(): return 1\nconst x = 1;';
      expect(renderCode(language, source)).toContain('class="hljs-');
    },
  );
  it.each(["", "unknown", "rust", "__proto__"])(
    "escapes unhighlighted blocks (%s)",
    (language) => {
      const html = renderCode(language, '<script>alert("x")</script>');
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain('class="hljs-');
    },
  );
  it.each([
    ["tk", "tcl", 'puts "hello"'],
    ["patch", "diff", "-before\n+after"],
    ["make", "makefile", "all:\n\t$(CC) main.c"],
    ["mk", "makefile", "all:\n\t$(CC) main.c"],
    ["mak", "makefile", "all:\n\t$(CC) main.c"],
    ["ps1", "powershell", 'Write-Host "hello"'],
    ["ps", "powershell", 'Write-Host "hello"'],
  ])("renders %s like %s", (alias, language, source) => {
    expect(
      renderCode(alias, source).replace(
        `language-${alias}`,
        `language-${language}`,
      ),
    ).toBe(renderCode(language, source));
  });
  it("distinguishes added and removed lines in a diff", () => {
    const html = renderCode("diff", "-before\n+after");
    expect(html).toContain('class="hljs-deletion"');
    expect(html).toContain('class="hljs-addition"');
  });
  it("keeps HTML code inert and raw HTML disabled", () => {
    expect(renderCode("html", '<script>alert("x")</script>')).not.toContain(
      "<script>",
    );
    expect(
      markdownParser.render('<img src=x onerror="alert(1)">'),
    ).not.toContain("<img");
  });
});
