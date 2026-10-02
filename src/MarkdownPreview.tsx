import { useEffect, useRef, type MouseEvent } from "react";

export function MarkdownPreview({ html }: { html: string }) {
  const timers = useRef(
    new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>(),
  );
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [html]);

  async function copyCode(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>(".code-block-copy");
    const article = event.currentTarget;
    if (!button || button.disabled || !article.contains(button)) return;
    const code = button.closest(".code-block")?.querySelector("pre > code");
    if (!code) return;
    const previous = timers.current.get(button);
    if (previous) clearTimeout(previous);
    timers.current.delete(button);
    button.disabled = true;
    let success = false;
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      success = true;
    } catch {
      /* Report permission/network-context restrictions on the button. */
    }
    if (!article.contains(button) || !button.isConnected) return;
    button.disabled = false;
    button.textContent = success ? "已复制" : "复制失败";
    button.setAttribute(
      "aria-label",
      success ? "代码已复制" : "代码复制失败，请手动选择复制",
    );
    button.title = success
      ? "已复制代码"
      : "无法访问剪贴板，请允许浏览器访问，或手动选择代码复制。";
    button.dataset.state = success ? "success" : "error";
    timers.current.set(
      button,
      setTimeout(
        () => {
          if (button.isConnected) {
            button.textContent = "复制";
            button.setAttribute("aria-label", "复制代码");
            button.title = "复制代码";
            delete button.dataset.state;
          }
          timers.current.delete(button);
        },
        success ? 1800 : 3500,
      ),
    );
  }

  // html has already been sanitized by DOMPurify in Editor.
  return (
    <article
      className="markdown-body"
      onClick={copyCode}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
