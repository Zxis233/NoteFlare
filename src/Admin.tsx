import { useEffect, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Image,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import type { Settings, Stats } from "../shared/types";
import { MiB, formatBytes } from "../shared/attachments";
import "./attachments.css";

export function Admin({
  settings,
  onSettings,
}: {
  settings: Settings;
  onSettings: (s: Settings) => void;
}) {
  const [form, setForm] = useState(settings);
  const [stats, setStats] = useState<Stats | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const cleanupBusy = useRef(false);
  const refresh = async () => {
    setStats(await api<Stats>("/admin/stats"));
  };
  useEffect(() => {
    setForm(settings);
  }, [settings]);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, []);
  useEffect(() => {
    setPreviewError(false);
  }, [form.backgroundUrl]);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<Settings>("/admin/settings", "PUT", form);
      onSettings(result);
      setMessage("设置已保存。");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cleanup(kind: "expired" | "all") {
    if (cleanupBusy.current) return;
    cleanupBusy.current = true;
    setCleaning(true);
    setMessage("正在清理…");
    let total = 0;
    let cutoff: number | undefined;
    try {
      for (let i = 0; i < 200; i++) {
        const result = await api<{
          deleted: number;
          remaining: number;
          cutoff: number;
          attachments: {
            deleted: number;
            remaining: number;
            actionable: number;
          };
        }>("/admin/cleanup", "POST", { kind, confirmation, cutoff });
        cutoff = result.cutoff;
        total += result.deleted;
        setMessage(`已清理 ${total} 篇，剩余 ${result.remaining} 篇。`);
        if (!result.remaining && !result.attachments.actionable) {
          setMessage(
            `清理完成，共删除 ${total} 篇笔记。${result.attachments.remaining ? `仍有 ${result.attachments.remaining} 个附件等待上传保护期结束或删除重试；每日任务会继续处理。` : "附件回收已完成。"}`,
          );
          break;
        }
        if (i === 199)
          setMessage(`已清理 ${total} 篇，仍有记录待清理，请再次执行。`);
      }
      setConfirm(false);
      setConfirmation("");
    } catch (e) {
      setMessage(`已删除 ${total} 篇。${(e as Error).message}`);
    } finally {
      cleanupBusy.current = false;
      setCleaning(false);
      void refresh().catch(() => {});
    }
  }
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((old) => ({ ...old, [key]: value }));
  const last = stats?.lastCleanup;
  return (
    <section className="admin-workspace">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A QUIET PLACE TO MANAGE</div>
          <h1>
            让一切，井然有序<span>。</span>
          </h1>
          <p>调整空间的模样，照料留下的文字。</p>
        </div>
        <span className="admin-badge">
          <ShieldCheck size={15} /> 管理员
        </span>
      </div>
      {message && (
        <div className="admin-message" role="status">
          {message}
        </div>
      )}
      <div className="stat-grid">
        <div className="stat-card">
          <span>活跃笔记</span>
          <strong>
            {stats?.active ?? "—"}
            <small>篇</small>
          </strong>
          <p>尚未过期的笔记</p>
        </div>
        <div className="stat-card">
          <span>待清理笔记</span>
          <strong>
            {stats?.expired ?? "—"}
            <small>篇</small>
          </strong>
          <p>已过期，无法再访问</p>
        </div>
        <div className="stat-card">
          <span>最近清理</span>
          <strong className="stat-date">
            {last?.ran_at
              ? new Date(last.ran_at).toLocaleString("zh-CN")
              : "尚无记录"}
          </strong>
          <p>
            {last?.ran_at
              ? `最近批次删除 ${last.deleted} 篇 · ${{ complete: "完成", partial: "待继续", failed: "失败" }[last.status || ""] || "未知"}`
              : "每日自动清理过期笔记"}
          </p>
        </div>
      </div>
      <div className="admin-grid">
        <section className="settings-panel">
          <h2>
            <Image size={17} /> 空间外观
          </h2>
          <label htmlFor="background">背景图片地址</label>
          <input
            id="background"
            type="url"
            placeholder="https://images.example.com/background.jpg"
            value={form.backgroundUrl}
            onChange={(e) => set("backgroundUrl", e.target.value)}
          />
          <p className="help">使用 HTTPS 图片直链；留空使用纯暗色背景。</p>
          <div className="range-label">
            <label htmlFor="overlay">深色遮罩强度</label>
            <span>{Math.round(form.overlay * 100)}%</span>
          </div>
          <input
            id="overlay"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={form.overlay}
            onChange={(e) => set("overlay", Number(e.target.value))}
          />
          <div className="background-preview">
            {form.backgroundUrl.startsWith("https://") && !previewError && (
              <img
                src={form.backgroundUrl}
                referrerPolicy="origin"
                alt="背景预览"
                onError={() => setPreviewError(true)}
              />
            )}
            <div
              className="preview-shade"
              style={{ background: `rgba(10,12,16,${form.overlay})` }}
            />
            <div className="preview-caption">
              <Flare />
              <strong>留一片空间，给灵感。</strong>
              <span>
                {previewError ? "图片无法加载，将使用暗色背景" : "背景效果预览"}
              </span>
            </div>
          </div>
        </section>
        <section className="settings-panel">
          <h2>
            <Settings2 size={17} /> 笔记偏好
          </h2>
          <label htmlFor="length">随机链接长度</label>
          <select
            id="length"
            value={form.linkLength}
            onChange={(e) => set("linkLength", Number(e.target.value))}
          >
            {[3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n} 位{n === 8 ? " · 推荐" : ""}
              </option>
            ))}
          </select>
          <p className="help">
            大小写字母与数字，仅影响新建笔记。短链接更容易被猜到。
          </p>
          <label htmlFor="retention">笔记保留天数</label>
          <div className="input-suffix">
            <input
              id="retention"
              type="number"
              min="1"
              max="365"
              value={form.retentionDays}
              onChange={(e) => set("retentionDays", Number(e.target.value))}
            />
            <span>天</span>
          </div>
          <p className="help">
            允许 1–365 天。新建或下次修改保存时生效；仅阅读不续期。
          </p>
          <div className="settings-note">
            <Clock3 size={16} />
            <p>
              每天自动清理已过期笔记。
              <br />
              到期后立即停止访问，无需等待物理删除。
            </p>
          </div>
          <button
            className="button primary save-settings"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void save()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}{" "}
            保存全部设置
          </button>
        </section>
      </div>
      <section className="settings-panel attachment-settings">
        <h2>附件与容量</h2>
        <label className="upload-switch">
          <input
            type="checkbox"
            checked={form.uploadsEnabled}
            onChange={(e) => set("uploadsEnabled", e.target.checked)}
          />
          允许上传新附件
        </label>
        <div className="attachment-usage">
          <span>已存附件 {stats?.attachments?.count ?? "—"} 个</span>
          <span>已用 {formatBytes(stats?.attachments?.usedBytes ?? 0)}</span>
          <span>
            上传预留 {formatBytes(stats?.attachments?.reservedBytes ?? 0)}
          </span>
          <span>
            待回收 {formatBytes(stats?.attachments?.deletingBytes ?? 0)}（
            {stats?.attachments?.deletingCount ?? 0} 个）
          </span>
          <span>删除失败 {stats?.attachments?.failedCount ?? 0} 个</span>
          <span>
            剩余{" "}
            {formatBytes(
              Math.max(
                0,
                form.maxTotalBytes -
                  (stats?.attachments?.usedBytes ?? 0) -
                  (stats?.attachments?.reservedBytes ?? 0) -
                  (stats?.attachments?.deletingBytes ?? 0),
              ),
            )}
          </span>
        </div>
        <div className="attachment-settings-grid">
          <div>
            <label htmlFor="max-file">单文件上限（MiB，1–50）</label>
            <input
              id="max-file"
              type="number"
              min="1"
              max="50"
              value={form.maxFileBytes / MiB}
              onChange={(e) =>
                set("maxFileBytes", Number(e.target.value) * MiB)
              }
            />
          </div>
          <div>
            <label htmlFor="max-count">每篇附件数量（1–100）</label>
            <input
              id="max-count"
              type="number"
              min="1"
              max="100"
              value={form.maxNoteFiles}
              onChange={(e) => set("maxNoteFiles", Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="max-note">每篇总容量（MiB，最大 1024）</label>
            <input
              id="max-note"
              type="number"
              min="1"
              max="1024"
              value={form.maxNoteBytes / MiB}
              onChange={(e) =>
                set("maxNoteBytes", Number(e.target.value) * MiB)
              }
            />
          </div>
          <div>
            <label htmlFor="max-total">全站总容量（MiB，1024 = 1 GiB）</label>
            <input
              id="max-total"
              type="number"
              min="1"
              max="102400"
              value={form.maxTotalBytes / MiB}
              onChange={(e) =>
                set("maxTotalBytes", Number(e.target.value) * MiB)
              }
            />
          </div>
        </div>
        <p className="help">
          容量需满足单文件 ≤ 每篇 ≤
          全站。调低上限不删除已有文件；关闭上传不影响已有附件下载和删除。临时上传超过
          24 小时后，由每日清理任务回收，实际可能保留接近 48 小时。
        </p>
        <button
          className="button primary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void save()}
        >
          <Save size={15} />
          保存附件设置
        </button>
      </section>
      <section className="cleanup-panel">
        <div>
          <h2>
            <Trash2 size={17} /> 数据清理
          </h2>
          <p>同时清理附件及失败上传。删除失败会重试，网站设置不会被删除。</p>
        </div>
        <div className="cleanup-actions">
          <button
            className="icon-button"
            disabled={cleaning}
            aria-label="刷新统计"
            onClick={() => void refresh().catch((e) => setMessage(e.message))}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="button secondary"
            disabled={cleaning || !stats}
            onClick={() => void cleanup("expired")}
            aria-busy={cleaning}
          >
            {cleaning ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Trash2 size={15} />
            )}{" "}
            清理过期笔记
          </button>
          <button
            className="button danger"
            disabled={cleaning || !stats}
            onClick={() => {
              setConfirm(true);
              setConfirmation("");
            }}
          >
            清空全部笔记
          </button>
        </div>
      </section>
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="danger-icon">
              <Trash2 size={23} />
            </div>
            <h2 id="confirm-title">清空全部笔记？</h2>
            <p>
              将删除当前所有笔记（当前统计{" "}
              {(stats?.active ?? 0) + (stats?.expired ?? 0)}{" "}
              篇），包括未过期内容。操作无法撤销。
            </p>
            <label htmlFor="confirmation">请输入“清空全部”确认</label>
            <input
              id="confirmation"
              autoFocus
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={cleaning}
                onClick={() => setConfirm(false)}
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={confirmation !== "清空全部" || cleaning}
                aria-busy={cleaning}
                onClick={() => void cleanup("all")}
              >
                {cleaning ? "正在清空…" : "确认清空"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function Flare() {
  return (
    <span className="preview-flare">
      <Check size={17} />
    </span>
  );
}
