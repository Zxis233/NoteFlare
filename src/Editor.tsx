import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { markdownParser } from "./lib/markdown";
import { MarkdownPreview } from "./MarkdownPreview";
import "./highlight.css";
import DOMPurify from "dompurify";
import {
  Check,
  Circle,
  Cloud,
  CloudOff,
  Columns2,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  PanelRightClose,
  Save,
  WrapText,
} from "lucide-react";
import { api, ApiError, storage } from "./api";
import { MAX_BYTES, type Note, type Settings } from "../shared/types";

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "#d8dce4",
      fontSize: "14px",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.85",
      overflow: "auto",
    },
    ".cm-content": { padding: "24px 0", minHeight: "100%" },
    ".cm-line": { padding: "0 24px 0 12px" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "#505764",
      padding: "0 8px 0 16px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#c4a887",
    },
    ".cm-activeLine": { backgroundColor: "#ffffff03" },
    ".cm-cursor": { borderLeftColor: "#eda96b" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#e5ac7330",
    },
  },
  { dark: true },
);

function date(value: number) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Editor({
  id,
  settings,
  onNew,
}: {
  id: string;
  settings: Settings;
  onNew: () => void;
}) {
  const [content, setContent] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<
    "new" | "dirty" | "saving" | "saved" | "error"
  >("new");
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied">(
    "idle",
  );
  const [preview, setPreview] = useState(storage.get("nf:preview") !== "off");
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [wrap, setWrap] = useState(true);
  const current = useRef("");
  const saved = useRef("");
  const saving = useRef(false);
  const mounted = useRef(true);
  const token = useRef(storage.get(`nf:create:${id}`));
  const dirty = useRef(false);
  const draftKey = `nf:draft:${id}`;
  const bytes = new TextEncoder().encode(content).length;
  const tooLarge = bytes > MAX_BYTES;

  useEffect(() => {
    mounted.current = true;
    async function load() {
      let remote: Note | null = null;
      try {
        remote = await api<Note>(`/notes/${id}`);
      } catch (e) {
        if (!mounted.current) return;
        if ((e as ApiError).status === 404 && token.current) {
          /* Unsaved, locally-created note. */
        } else {
          setMissing(true);
          setMessage((e as Error).message);
          const draft = storage.get(draftKey);
          if (draft !== null) {
            current.current = draft;
            setContent(draft);
          }
          setLoaded(true);
          return;
        }
      }
      if (!mounted.current) return;
      if (remote) {
        token.current = null;
        storage.remove(`nf:create:${id}`);
        setNote(remote);
      }
      saved.current = remote?.content ?? "";
      const draft = storage.get(draftKey);
      current.current = draft ?? saved.current;
      setContent(current.current);
      dirty.current = current.current !== saved.current;
      if (dirty.current) {
        setMessage("已恢复此设备上的未保存草稿。");
        setStatus("dirty");
      } else {
        setStatus(remote ? "saved" : "new");
      }
      setLoaded(true);
    }
    void load();
    return () => {
      mounted.current = false;
    };
  }, [id]);

  const save = useCallback(async () => {
    if (!loaded || missing || saving.current || !dirty.current) return;
    const text = current.current;
    if (new TextEncoder().encode(text).length > MAX_BYTES) {
      setStatus("error");
      setMessage("正文超过 200 KB，请精简后再保存。本地草稿仍然保留。");
      return;
    }
    if (token.current && !text.trim()) return;
    saving.current = true;
    setStatus("saving");
    try {
      const result = await api<Note>(`/notes/${id}`, "PUT", {
        content: text,
        ...(token.current ? { createToken: token.current } : {}),
      });
      token.current = null;
      storage.remove(`nf:create:${id}`);
      saved.current = text;
      dirty.current = current.current !== text;
      if (!dirty.current && storage.get(draftKey) === text)
        storage.remove(draftKey);
      if (mounted.current) {
        setNote(result);
        setStatus(dirty.current ? "dirty" : "saved");
        setMessage("");
      }
    } catch (e) {
      if (mounted.current) {
        setStatus("error");
        setMessage((e as Error).message);
      }
    } finally {
      saving.current = false;
    }
  }, [id, loaded, missing]);

  useEffect(() => {
    const timer = setInterval(() => void save(), 30_000);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const online = () => {
      void save();
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("online", online);
    };
  }, [save]);

  const onChange = (value: string) => {
    current.current = value;
    setContent(value);
    dirty.current = value !== saved.current;
    if (!storage.set(draftKey, value))
      setMessage("本地草稿保存失败，浏览器存储可能已满。请及时下载备份。");
    setStatus(dirty.current ? "dirty" : note ? "saved" : "new");
  };
  const previewContent = useDeferredValue(content);
  const html = useMemo(
    () =>
      DOMPurify.sanitize(markdownParser.render(previewContent), {
        USE_PROFILES: { html: true },
      }),
    [previewContent],
  );
  const extensions = useMemo(
    () => [
      markdown(),
      Prec.highest(theme),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [wrap],
  );
  const togglePreview = () => {
    setPreview(!preview);
    storage.set("nf:preview", preview ? "off" : "on");
  };
  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  async function copyContent() {
    if (copyStatus === "copying") return;
    setCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(current.current);
      if (mounted.current) setCopyStatus("copied");
    } catch {
      if (mounted.current) {
        setCopyStatus("idle");
        setMessage(
          "无法复制内容，请允许浏览器访问剪贴板，或在编辑区手动选择并复制。",
        );
      }
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([current.current], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `noteflare-${id}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const statusLabels = {
    new: "尚未保存",
    dirty: "等待保存",
    saving: "正在保存",
    saved: "已保存至云端",
    error: "保存失败",
  };
  return (
    <section className="workspace">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EVERYDAY SCRATCHPAD</div>
          <h1>
            让想法<span>，</span>随时落笔<span>。</span>
          </h1>
          <p>一段文字，一个链接。留住此刻的灵感。</p>
        </div>
        <div className="note-badge">
          <FileText size={14} />
          <span>{id}</span>
        </div>
      </div>
      <div
        className={`editor-card ${preview ? "with-preview" : ""} mobile-${mobileTab}`}
      >
        <div className="editor-toolbar">
          <div className="toolbar-title">
            <span className="tiny-square" /> <span>笔记内容</span>
            <span className="format-badge">Markdown</span>
          </div>
          <div className="toolbar-actions">
            <button
              className="icon-button desktop-only"
              onClick={() => setWrap(!wrap)}
              title="自动换行"
              aria-label="自动换行"
              aria-pressed={wrap}
            >
              <WrapText size={17} />
            </button>
            <button
              className="icon-button"
              onClick={download}
              title="下载 Markdown"
              aria-label="下载 Markdown"
            >
              <Download size={17} />
            </button>
            <button
              className="icon-button"
              onClick={() => void copyContent()}
              disabled={!loaded || !content || copyStatus === "copying"}
              title={copyStatus === "copied" ? "已复制" : "复制 Markdown"}
              aria-label={
                copyStatus === "copied" ? "已复制 Markdown" : "复制 Markdown"
              }
              aria-live="polite"
            >
              {copyStatus === "copied" ? (
                <Check size={17} />
              ) : (
                <Copy size={17} />
              )}
            </button>
            <span className="toolbar-divider" />
            <button
              className="button ghost desktop-only"
              onClick={togglePreview}
            >
              {preview ? <PanelRightClose size={16} /> : <Columns2 size={16} />}
              {preview ? "关闭预览" : "打开预览"}
            </button>
            <button
              className="button ghost mobile-only"
              onClick={() =>
                setMobileTab(mobileTab === "edit" ? "preview" : "edit")
              }
            >
              <Columns2 size={16} />
              {mobileTab === "edit" ? "预览" : "编辑"}
            </button>
          </div>
        </div>
        {message && (
          <div
            className={`editor-message ${status === "error" || missing ? "error" : ""}`}
            role="status"
          >
            {message}
            {missing && <button onClick={onNew}>新建笔记</button>}
          </div>
        )}
        <div className="panes">
          <div className="edit-pane">
            {!loaded ? (
              <div className="pane-loading">
                <LoaderCircle className="spin" /> 正在读取笔记…
              </div>
            ) : (
              <CodeMirror
                value={content}
                onChange={onChange}
                extensions={extensions}
                theme="dark"
                editable={!missing}
                height="100%"
                placeholder={
                  "# 从这里开始\n\n写点什么吧…\n支持 Markdown，每 30 秒自动保存。"
                }
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                  autocompletion: false,
                }}
                aria-label="笔记编辑器"
              />
            )}
          </div>
          <div className="preview-pane">
            <div className="pane-label">
              预览 <span>PREVIEW</span>
            </div>
            {content ? (
              <MarkdownPreview html={html} />
            ) : (
              <div className="preview-empty">
                <div className="preview-icon">
                  <FileText size={27} strokeWidth={1.2} />
                </div>
                <h2>文字的另一种模样</h2>
                <p>
                  在左侧开始书写，
                  <br />
                  Markdown 会在这里实时呈现。
                </p>
                <span>灵感不必等待格式。</span>
              </div>
            )}
          </div>
        </div>
        <div className="editor-statusbar">
          <div className={`save-state ${status}`} aria-live="polite">
            {status === "saving" ? (
              <LoaderCircle className="spin" size={13} />
            ) : status === "saved" ? (
              <Check size={13} />
            ) : status === "error" ? (
              <CloudOff size={13} />
            ) : (
              <Circle size={9} />
            )}
            <span>{statusLabels[status]}</span>
            <span className="status-detail">· 每 30 秒自动保存</span>
          </div>
          <div className="editor-count">
            <span className={tooLarge ? "danger-text" : ""}>
              {(bytes / 1024).toFixed(1)} / 200 KB
            </span>
            <span className="status-detail">{content.length} 字符</span>
            <button
              onClick={() => void save()}
              disabled={
                !loaded ||
                missing ||
                status === "saving" ||
                tooLarge ||
                !dirty.current
              }
              title="保存 (Ctrl / ⌘ + S)"
              aria-label="保存笔记"
            >
              <Save size={14} />
            </button>
          </div>
        </div>
      </div>
      <div className="workspace-footnote">
        <span>
          <Cloud size={14} />
          {note
            ? `到期时间 ${date(note.expiresAt)}，修改保存后续期`
            : `首次保存后保留 ${settings.retentionDays} 天，修改后续期`}
        </span>
        <span>持有链接即可读写，请妥善分享。</span>
      </div>
    </section>
  );
}
