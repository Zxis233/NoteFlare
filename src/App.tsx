import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  Check,
  Clipboard,
  Flame,
  LoaderCircle,
  Plus,
  Settings2,
} from "lucide-react";
import { api, storage } from "./api";
import type { Settings } from "../shared/types";

const Editor = lazy(() =>
  import("./Editor").then((module) => ({ default: module.Editor })),
);
const Admin = lazy(() =>
  import("./Admin").then((module) => ({ default: module.Admin })),
);

const defaults: Settings = {
  backgroundUrl: "",
  overlay: 0.75,
  linkLength: 8,
  retentionDays: 30,
};

export function App() {
  const [config, setConfig] = useState(defaults);
  const [path, setPath] = useState(location.pathname);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const creatingRef = useRef(false);
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const match = /^\/n\/([A-Za-z0-9]{3,8})$/.exec(path);

  const navigate = (to: string, replace = false) => {
    history[replace ? "replaceState" : "pushState"](null, "", to);
    setPath(to);
  };
  async function newNote(replace = false) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const result = await api<{ id: string; createToken: string }>(
        "/new",
        "POST",
        {},
      );
      if (!storage.set(`nf:create:${result.id}`, result.createToken))
        throw new Error(
          "浏览器存储不可用，无法保留新建凭证。请允许此站点使用本地存储。",
        );
      navigate(`/n/${result.id}`, replace);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
      creatingRef.current = false;
    }
  }
  useEffect(() => {
    api<Settings>("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (path === "/") void newNote(true);
  }, [path]);
  useEffect(() => {
    setBackgroundFailed(false);
  }, [config.backgroundUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("无法访问剪贴板，请从地址栏复制链接。");
    }
  }
  return (
    <div className={`app ${isAdmin ? "admin-app" : ""}`}>
      {config.backgroundUrl && !backgroundFailed && (
        <div className="background" aria-hidden="true">
          <img
            src={config.backgroundUrl}
            alt=""
            referrerPolicy="origin"
            onError={() => setBackgroundFailed(true)}
          />
          <div
            style={
              {
                background: `rgba(10, 12, 16, ${config.overlay})`,
              } as CSSProperties
            }
          />
        </div>
      )}
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            void newNote();
          }}
          aria-label="NoteFlare 新建笔记"
        >
          <span className="brand-mark">
            <Flame size={21} fill="currentColor" />
          </span>
          <span>
            Note<span className="brand-light">Flare</span>
          </span>
        </a>
        <span className="topbar-divider" />
        <span className="tagline">
          {isAdmin ? "控制面板" : "随手记，随处见。"}
        </span>
        <nav>
          {isAdmin ? (
            <button className="button ghost" onClick={() => void newNote()}>
              <ArrowLeft size={15} /> 返回编辑器
            </button>
          ) : (
            <>
              <button
                className="button ghost"
                onClick={() => void newNote()}
                disabled={creating}
                aria-busy={creating}
              >
                {creating ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Plus size={15} />
                )}
                <span>新建笔记</span>
              </button>
              <button
                className="button share"
                onClick={copyLink}
                disabled={!match}
              >
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
                <span>{copied ? "已复制" : "复制链接"}</span>
              </button>
              <a
                className="icon-button"
                href="/admin"
                aria-label="管理面板"
                title="管理面板"
              >
                <Settings2 size={18} />
              </a>
            </>
          )}
        </nav>
      </header>
      {error && (
        <div className="global-message" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
      <main>
        <Suspense
          fallback={
            <div className="empty-state">
              <LoaderCircle className="spin" />
              正在加载…
            </div>
          }
        >
          {isAdmin ? (
            <Admin settings={config} onSettings={setConfig} />
          ) : match ? (
            <Editor
              key={match[1]}
              id={match[1]}
              settings={config}
              onNew={() => void newNote()}
            />
          ) : (
            <div className="empty-state">
              {path === "/" && creating ? (
                <>
                  <LoaderCircle className="spin" />
                  <h1>准备你的空白笔记…</h1>
                </>
              ) : (
                <>
                  <Flame size={32} />
                  <h1>{path === "/" ? "开始记录" : "这个页面不存在"}</h1>
                  <button
                    className="button primary"
                    onClick={() => void newNote()}
                  >
                    新建一篇笔记
                  </button>
                </>
              )}
            </div>
          )}
        </Suspense>
      </main>
      <footer className="site-footer">
        <span>
          <span className="status-dot" /> 简单记录，自由流动
        </span>
        <span>
          NoteFlare <span className="footer-separator">/</span> 轻量在线剪贴板
        </span>
      </footer>
    </div>
  );
}
